import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, normalizeData, addItem, updateItem, removeItem, finishShopping, setEquivalence, removeEquivalence, visibleItems } from '../js/data.js';
import { mergeData, sameContent } from '../js/merge.js';

const T1 = '2026-11-01T10:00:00Z', T2 = '2026-11-02T10:00:00Z', T3 = '2026-11-03T10:00:00Z';

test('ajout, modification, suppression logique', () => {
  let d = addItem(emptyData(), { label: '  Riz ', category: 'fresh', qty: 3, kind: 'oneoff' }, { now: T1, id: 'a', user: 'n@x' });
  assert.equal(d.shopping_list[0].label, 'Riz');
  assert.equal(d.shopping_list[0].category, 'fresh');
  assert.equal(d.updated_by, 'n@x');
  assert.equal(addItem(d, { label: '  ' }), d);
  d = updateItem(d, 'a', { checked: true }, { now: T2 });
  assert.equal(d.shopping_list[0].checked, true);
  d = removeItem(d, 'a', { now: T3 });
  assert.equal(visibleItems(d).length, 0);
  assert.equal(d.shopping_list[0].deleted, true);
});

test('fin des courses : ponctuels cochés supprimés, habituels décochés', () => {
  let d = emptyData();
  d = addItem(d, { label: 'a', kind: 'recurring' }, { id: 'a', now: T1 });
  d = addItem(d, { label: 'b', kind: 'oneoff' }, { id: 'b', now: T1 });
  d = addItem(d, { label: 'c', kind: 'oneoff' }, { id: 'c', now: T1 });
  d = updateItem(d, 'a', { checked: true });
  d = updateItem(d, 'b', { checked: true });
  d = finishShopping(d, { now: T2 });
  const by = Object.fromEntries(d.shopping_list.map((i) => [i.id, i]));
  assert.equal(by.a.checked, false);
  assert.equal(by.b.deleted, true);
  assert.equal(by.c.deleted, undefined);
});

test('équivalences : remplacement et suppression', () => {
  const item = { id: 'a', label: 'riz' };
  let d = setEquivalence(emptyData(), item, { lafourche: 'X', biocoop: 'Y' }, { user: 'n@x', now: T1 });
  d = setEquivalence(d, item, { lafourche: 'Z', biocoop: 'Y' }, { now: T2 });
  assert.equal(d.equivalences.length, 1);
  assert.equal(d.equivalences[0].preferred.lafourche, 'Z');
  assert.equal(d.equivalences[0].preferred.auchan, null);
  assert.equal(removeEquivalence(d, item).equivalences.length, 0);
});

test('normalizeData tolère un fichier partiel', () => {
  const d = normalizeData({ shopping_list: [{ id: '1' }] });
  assert.deepEqual(d.equivalences, []);
  assert.equal(d.settings.auchan_enabled, true);
  assert.equal(normalizeData(null).version, 1);
});

test('fusion : union par id, le plus récent gagne par article', () => {
  const base = addItem(addItem(emptyData(), { label: 'a' }, { id: 'a', now: T1 }), { label: 'b' }, { id: 'b', now: T1 });
  const local = updateItem(base, 'a', { qty: 5 }, { now: T3 });
  const remote = updateItem(addItem(base, { label: 'c' }, { id: 'c', now: T2 }), 'a', { qty: 2 }, { now: T2 });
  const m = mergeData(local, remote, T3);
  const by = Object.fromEntries(m.shopping_list.map((i) => [i.id, i]));
  assert.equal(by.a.qty, 5);
  assert.ok(by.b && by.c);
  assert.equal(m.shopping_list.length, 3);
});

test('fusion : une suppression plus récente n\'est pas ressuscitée', () => {
  const base = addItem(emptyData(), { label: 'a' }, { id: 'a', now: T1 });
  const local = removeItem(base, 'a', { now: T3 });
  const m = mergeData(local, base, T3);
  assert.equal(visibleItems(m).length, 0);
  const m2 = mergeData(base, local, T3);
  assert.equal(visibleItems(m2).length, 0);
});

test('fusion : tombstones purgés après 30 jours, équivalences les plus récentes', () => {
  const base = addItem(emptyData(), { label: 'a' }, { id: 'a', now: T1 });
  const gone = removeItem(base, 'a', { now: T1 });
  const m = mergeData(gone, emptyData(), '2026-12-15T00:00:00Z');
  assert.equal(m.shopping_list.length, 0);
  const item = { id: 'a', label: 'a' };
  const l = setEquivalence(emptyData(), item, { lafourche: 'OLD' }, { now: T1 });
  const r = setEquivalence(emptyData(), item, { lafourche: 'NEW' }, { now: T2 });
  assert.equal(mergeData(l, r).equivalences[0].preferred.lafourche, 'NEW');
  assert.equal(mergeData(r, l).equivalences[0].preferred.lafourche, 'NEW');
});

test('sameContent ignore updated_at/updated_by et l\'ordre', () => {
  const a = addItem(addItem(emptyData(), { label: 'a' }, { id: 'a', now: T1 }), { label: 'b' }, { id: 'b', now: T1 });
  const b = { ...a, updated_at: T3, updated_by: 'x', shopping_list: [...a.shopping_list].reverse() };
  assert.equal(sameContent(a, b), true);
  assert.equal(sameContent(a, updateItem(a, 'a', { qty: 9 })), false);
});
