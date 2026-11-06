import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveClient, DriveError } from '../js/drive.js';
import { createGithubClient, makeRunId, GithubError } from '../js/github.js';

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('drive : lecture, écriture et création avec jeton Bearer', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return res(200, { id: 'F1', k: 1 }); };
  const c = createDriveClient({ config: { fileName: 'courses-data.json' }, getToken: async () => 'TOK', fetchImpl });
  assert.deepEqual(await c.read('F1'), { id: 'F1', k: 1 });
  assert.match(calls[0].url, /files\/F1\?alt=media/);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer TOK');
  await c.write('F1', { a: 1 });
  assert.equal(calls[1].init.method, 'PATCH');
  assert.match(calls[1].url, /upload\/drive\/v3\/files\/F1\?uploadType=media/);
  assert.equal(await c.create({ a: 1 }), 'F1');
  assert.match(calls[2].init.headers['Content-Type'], /multipart\/related/);
  assert.match(calls[2].init.body, /"name":"courses-data.json"/);
});

test('drive : 401 => nouveau jeton une fois ; 404 => message explicite', async () => {
  let n = 0;
  const tokens = [];
  const fetchImpl = async () => (++n === 1 ? res(401, {}) : res(200, { ok: true }));
  const c = createDriveClient({ config: {}, getToken: async (o) => { tokens.push(o?.force); return 'T'; }, fetchImpl });
  assert.deepEqual(await c.read('x'), { ok: true });
  assert.deepEqual(tokens, [undefined, true, undefined]); // le 3e appel relit le jeton en cache
  const c404 = createDriveClient({ config: {}, getToken: async () => 'T', fetchImpl: async () => res(404, {}) });
  await assert.rejects(c404.read('x'), (e) => e instanceof DriveError && e.status === 404 && /Picker|partagé/.test(e.message));
});

test('github : run_id et déclenchement du workflow', async () => {
  assert.equal(makeRunId(new Date('2026-11-06T05:30:00.123Z')), '20261106T053000Z');
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: 204, ok: true }; };
  const gh = createGithubClient({ config: { owner: 'O', repo: 'R', workflow: 'search.yml', ref: 'main', resultsBase: './r/' }, token: 'T', fetchImpl });
  const r = await gh.dispatchSearch({ queries: ['a', 'b'], stores: ['biocoop', 'lafourche'], runId: 'RID' });
  assert.equal(r.runId, 'RID');
  assert.equal(calls[0].url, 'https://api.github.com/repos/O/R/actions/workflows/search.yml/dispatches');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { ref: 'main', inputs: { queries: '["a","b"]', stores: 'biocoop,lafourche', run_id: 'RID' } });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer T');
});

test('github : refus et jeton manquant', async () => {
  const cfg = { owner: 'O', repo: 'R', workflow: 'w', ref: 'main', resultsBase: './r/' };
  await assert.rejects(createGithubClient({ config: cfg }).dispatchSearch({ queries: [], stores: [] }), GithubError);
  const gh = createGithubClient({ config: cfg, token: 'T', fetchImpl: async () => ({ status: 403, ok: false }) });
  await assert.rejects(gh.dispatchSearch({ queries: [], stores: [] }), /403/);
});

test('github : attente des résultats jusqu\'à publication', async () => {
  const cfg = { owner: 'O', repo: 'R', workflow: 'w', ref: 'main', resultsBase: './r/' };
  let polls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('api.github.com')) return res(200, { workflow_runs: [{ created_at: new Date().toISOString(), status: 'in_progress' }] });
    return ++polls < 3 ? res(404, {}) : res(200, { run_id: 'RID', queries: {} });
  };
  const statuses = [];
  const gh = createGithubClient({ config: cfg, token: 'T', fetchImpl, sleepImpl: async () => {} });
  const out = await gh.waitForResults({ runId: 'RID', dispatchedAt: new Date().toISOString(), onStatus: (s) => statuses.push(s) });
  assert.equal(out.run_id, 'RID');
  assert.ok(statuses.includes('Recherche en cours…'));
});

test('github : échec du workflow remonté', async () => {
  const cfg = { owner: 'O', repo: 'R', workflow: 'w', ref: 'main', resultsBase: './r/' };
  const fetchImpl = async (url) =>
    url.includes('api.github.com')
      ? res(200, { workflow_runs: [{ created_at: new Date().toISOString(), status: 'completed', conclusion: 'failure' }] })
      : res(404, {});
  const gh = createGithubClient({ config: cfg, token: 'T', fetchImpl, sleepImpl: async () => {} });
  await assert.rejects(gh.waitForResults({ runId: 'R', dispatchedAt: new Date().toISOString() }), /échoué/);
});
