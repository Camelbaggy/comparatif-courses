import { html, render, useState, useEffect, useRef, useMemo } from './js/ui/lib.js';
import { CONFIG, driveConfigured } from './config.js';
import * as D from './js/data.js';
import { decideAll, buildBaskets, buildSearchRequest } from './js/compare.js';
import { mergeData, sameContent } from './js/merge.js';
import { createDriveClient } from './js/drive.js';
import { createGithubClient, makeRunId } from './js/github.js';
import { load, save } from './js/storage.js';
import { ListView } from './js/ui/list.js';
import { ResultsView } from './js/ui/results.js';
import { BasketsView } from './js/ui/baskets.js';
import { SettingsView } from './js/ui/settings.js';

const K = { data: 'courses.data', results: 'courses.results', file: 'courses.driveFileId', gh: 'courses.ghToken', user: 'courses.user', tab: 'courses.tab' };
const TABS = [['list', 'Liste'], ['results', 'Comparaison'], ['baskets', 'Paniers'], ['settings', 'Réglages']];
const forceDemo = new URLSearchParams(location.search).get('demo') === '1';

function App() {
  const [data, setData] = useState(() => D.normalizeData(load(K.data)));
  const [run, setRun] = useState(() => load(K.results));
  const [tab, setTab] = useState(() => load(K.tab, 'list'));
  const [user, setUserState] = useState(() => load(K.user, ''));
  const [ghToken, setGhTokenState] = useState(() => load(K.gh, ''));
  const [fileId, setFileId] = useState(() => load(K.file));
  const [connected, setConnected] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [search, setSearch] = useState({ busy: false, status: '' });
  const [notice, setNotice] = useState(null);

  const dataRef = useRef(data);
  const userRef = useRef(user);
  const fileRef = useRef(fileId);
  const timer = useRef(null);
  userRef.current = user;
  fileRef.current = fileId;

  const drive = useMemo(() => (driveConfigured() ? createDriveClient({ config: CONFIG.google }) : null), []);
  const demo = forceDemo || !ghToken;

  const persist = (next) => { dataRef.current = next; setData(next); save(K.data, next); };

  async function sync() {
    if (!drive || !fileRef.current || !connected) return;
    setSyncMsg('Synchronisation…');
    try {
      const remote = D.normalizeData(await drive.read(fileRef.current));
      const merged = mergeData(dataRef.current, remote);
      persist(merged);
      if (!sameContent(merged, remote)) await drive.write(fileRef.current, merged);
      setSyncMsg('Synchronisé à ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      setSyncMsg('Erreur Drive : ' + e.message);
    }
  }
  const syncSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(sync, 1500); };
  const commit = (fn) => { persist(fn(dataRef.current, { user: userRef.current || undefined })); syncSoon(); };

  useEffect(() => { save(K.tab, tab); }, [tab]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && connected && sync();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [connected]);

  const actions = {
    add: (f) => commit((d, o) => D.addItem(d, f, o)),
    update: (id, patch) => commit((d, o) => D.updateItem(d, id, patch, o)),
    remove: (id) => commit((d, o) => D.removeItem(d, id, o)),
    validate: (item, sel) => {
      commit((d, o) => D.setEquivalence(d, item, sel, o));
      setNotice(`Équivalence mémorisée pour « ${item.label} ».`);
    },
    forget: (item) => commit((d, o) => D.removeEquivalence(d, item, o)),
  };

  const decisions = useMemo(() => decideAll(data, run), [data, run]);
  const baskets = useMemo(() => buildBaskets(decisions), [decisions]);
  const toValidate = decisions.filter((d) => d.needsValidation).length;

  async function onSearch() {
    const req = buildSearchRequest(dataRef.current);
    if (!req.queries.length) return;
    setNotice(null);
    setSearch({ busy: true, status: 'Lancement…' });
    try {
      let results;
      if (demo) {
        results = await (await fetch(CONFIG.sampleResults)).json();
      } else {
        const gh = createGithubClient({ config: CONFIG.github, token: ghToken });
        const runId = makeRunId();
        const { dispatchedAt } = await gh.dispatchSearch({ ...req, runId });
        results = await gh.waitForResults({ runId, dispatchedAt, onStatus: (s) => setSearch({ busy: true, status: s }) });
      }
      setRun(results);
      save(K.results, results);
      setSearch({ busy: false, status: '' });
      setTab('results');
    } catch (e) {
      setSearch({ busy: false, status: '' });
      setNotice({ error: e.message });
    }
  }

  async function loadSample() {
    persist(D.normalizeData(await (await fetch(CONFIG.sampleData)).json()));
  }

  const driveCtl = {
    fileId,
    connected,
    async connect() {
      if (connected) return sync();
      try {
        await drive.signIn();
        setConnected(true);
        const email = await drive.whoami();
        if (email && !userRef.current) { setUserState(email); save(K.user, email); }
        setSyncMsg('Connecté à Google');
        if (fileRef.current) setTimeout(sync, 0);
      } catch (e) { setNotice({ error: e.message }); }
    },
    async create() {
      try {
        const id = await drive.create(dataRef.current);
        save(K.file, id); setFileId(id); fileRef.current = id;
        setNotice('Fichier créé dans Mon Drive. Partagez-le avec l\'autre compte depuis Drive.');
      } catch (e) { setNotice({ error: e.message }); }
    },
    async pick() {
      try {
        const id = await drive.pick();
        if (!id) return;
        save(K.file, id); setFileId(id); fileRef.current = id;
        setTimeout(sync, 0);
      } catch (e) { setNotice({ error: e.message }); }
    },
    unlink() { save(K.file, null); setFileId(null); fileRef.current = null; setSyncMsg(''); },
  };
  const ghCtl = {
    token: ghToken,
    setToken: (t) => { save(K.gh, t || null); setGhTokenState(t); },
  };

  return html`
    <header class="top">
      <h1>🛒 Comparatif courses</h1>
      <div class="sync">${syncMsg || (fileId && !connected ? 'Drive : non connecté' : drive ? '' : 'Mode local')}</div>
    </header>
    ${notice ? html`<p class=${'msg ' + (notice.error ? 'error' : 'info')} onClick=${() => setNotice(null)}>${notice.error ?? notice}</p>` : null}
    ${fileId && !connected && drive
      ? html`<p class="msg">Liste partagée non synchronisée. <button class="link" onClick=${driveCtl.connect}>Se connecter à Google</button></p>` : null}
    ${tab === 'list' ? html`<${ListView} data=${data} actions=${actions} search=${search} demo=${demo}
        onSearch=${onSearch} onLoadSample=${loadSample}
        onFinish=${() => commit((d, o) => D.finishShopping(d, o))} />` : null}
    ${tab === 'results' ? html`<${ResultsView} decisions=${decisions} run=${run} actions=${actions} />` : null}
    ${tab === 'baskets' ? html`<${BasketsView} baskets=${baskets} />` : null}
    ${tab === 'settings' ? html`<${SettingsView} data=${data} drive=${driveCtl} github=${ghCtl} user=${user}
        setUser=${(u) => { setUserState(u); save(K.user, u); }}
        onSettings=${(p) => commit((d, o) => D.updateSettings(d, p, o))} />` : null}
    <nav class="tabs">
      ${TABS.map(([id, label]) => html`<button aria-current=${tab === id ? 'page' : null} onClick=${() => setTab(id)}>
        ${label}${id === 'results' && toValidate ? ` (${toValidate})` : ''}</button>`)}
    </nav>`;
}

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
