import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideItem, decideAll, buildBaskets, manualToProduct, isStale, findManual, auchanSearchUrl, round2 } from '../js/compare.js';
import { emptyData, addItem, setManualProduct, removeManualProduct, normalizeData } from '../js/data.js';
import { mergeData, sameContent } from '../js/merge.js';

const run = JSON.parse(readFileSync(new URL('../data/sample-results.json', import.meta.url)));
const settings = { auchan_enabled: true, auchan_threshold_eur_per_kg: null };
const T1 = '2026-11-01T10:00:00Z', T2 = '2026-11-02T10:00:00Z';
const mk = (label, extra = {}) => ({ id: 'i-' + label, label, category: 'normal', qty: 1, ...extra });

test('saisie manuelle : €/kg ou €/L calculé, valeurs invalides refusées', () => {
  const item = mk('sel');
  let d = setManualProduct(emptyData(), item, { price: '1,80', pack_qty: '500', pack_unit: 'g', name: 'Sel fin' }, { now: T1, user: 'n@x' });
  const m = d.manual_products[0];
  assert.equal(m.price, 1.8);
  assert.equal(m.entered_by, 'n@x');
  const p = manualToProduct(m);
  assert.equal(p.unit_price, 3.6);
  assert.equal(p.unit_price_basis, 'kg');
  assert.equal(p.manual, true);
  assert.equal(manualToProduct({ ...m, pack_unit: 'cl', pack_qty: 75, price: 7.5 }).unit_price, 10);
  const e = emptyData();
  assert.equal(setManualProduct(e, item, { price: 0, pack_qty: 1, pack_unit: 'g' }), e);
  assert.equal(setManualProduct(d, item, { price: 2, pack_qty: 1, pack_unit: 'xx' }), d);
  assert.equal(setManualProduct(d, item, { price: 2, pack_qty: -1, pack_unit: 'g' }), d);
});

test('une nouvelle saisie remplace l\'ancienne ; suppression logique', () => {
  const item = mk('sel');
  let d = setManualProduct(emptyData(), item, { price: 2, pack_qty: 1, pack_unit: 'kg' }, { now: T1 });
  d = setManualProduct(d, item, { price: 3, pack_qty: 1, pack_unit: 'kg' }, { now: T2 });
  assert.equal(d.manual_products.length, 1);
  assert.equal(findManual(d.manual_products, item).price, 3);
  d = removeManualProduct(d, item, { now: T2 });
  assert.equal(findManual(d.manual_products, item), null);
  assert.equal(normalizeData({}).manual_products.length, 0);
});

test('introuvable ailleurs : demande de saisie Auchan, puis affectation à Auchan avec le total', () => {
  const item = mk('beurre salé');
  const emptyRun = { queries: { 'beurre salé': { lafourche: [], biocoop: [], auchan: [] } } };
  const before = decideItem(item, emptyRun, [], settings, []);
  assert.equal(before.status, 'unfound');
  assert.equal(before.needsManualAuchan, true);
  assert.equal(decideItem(item, emptyRun, [], { ...settings, auchan_enabled: false }, []).needsManualAuchan, false);

  const d = setManualProduct(emptyData(), item, { price: 2.4, pack_qty: 250, pack_unit: 'g' }, { now: T1 });
  const after = decideItem({ ...item, qty: 2 }, emptyRun, [], settings, d.manual_products);
  assert.equal(after.status, 'assigned');
  assert.equal(after.store, 'auchan');
  assert.equal(after.lineTotal, 4.8);
  assert.equal(round2(after.unit.value), 9.6);
  assert.equal(after.needsManualAuchan, false);
});

test('produit frais absent de Biocoop : repli Auchan via saisie manuelle', () => {
  const item = mk('crème', { category: 'fresh' });
  const r = { queries: { 'crème': { biocoop: [], auchan: [] } } };
  assert.equal(decideItem(item, r, [], settings, []).needsManualAuchan, true);
  const d = setManualProduct(emptyData(), item, { price: 1.5, pack_qty: 20, pack_unit: 'cl' }, { now: T1 });
  assert.equal(decideItem(item, r, [], settings, d.manual_products).store, 'auchan');
});

test('want_auchan : la saisie manuelle entre en concurrence ; sans saisie, la demande reste visible', () => {
  const item = mk("huile d'olive", { want_auchan: true });
  const pre = decideItem({ ...item, query: undefined }, { queries: { "huile d'olive": { ...run.queries["huile d'olive"], auchan: [] } } }, [], settings, []);
  assert.equal(pre.store, 'lafourche');
  assert.equal(pre.needsManualAuchan, true);
  const d = setManualProduct(emptyData(), item, { price: 6, pack_qty: 1, pack_unit: 'l' }, { now: T1 });
  const post = decideItem(item, { queries: { "huile d'olive": { ...run.queries["huile d'olive"], auchan: [] } } }, [], settings, d.manual_products);
  assert.equal(post.store, 'auchan'); // 6 €/L < 10,60 €/L
  assert.equal(post.saving.versus, 'lafourche');
  // sans want_auchan, la saisie n'est jamais retenue quand d'autres enseignes ont le produit
  const quiet = decideItem({ ...item, want_auchan: false }, { queries: { "huile d'olive": { ...run.queries["huile d'olive"], auchan: [] } } }, [], settings, d.manual_products);
  assert.equal(quiet.store, 'lafourche');
});

test('prix ancien après 28 jours', () => {
  const p = manualToProduct({ item_id_or_label: 'x', pack_qty: 1, pack_unit: 'kg', price: 1, entered_at: '2026-10-01T00:00:00Z' });
  assert.equal(isStale(p, Date.parse('2026-10-20T00:00:00Z')), false);
  assert.equal(isStale(p, Date.parse('2026-11-06T00:00:00Z')), true);
  assert.equal(isStale({ fetched_at: '2020-01-01' }), false); // produit scrapé : jamais « ancien » ici
});

test('paniers : la ligne Auchan manuelle compte dans les totaux', () => {
  const item = mk('beurre salé');
  const r = { queries: { 'beurre salé': { lafourche: [], biocoop: [], auchan: [] } } };
  const d = setManualProduct(addItem(emptyData(), { label: 'beurre salé' }, { id: item.id }), item, { price: 2.4, pack_qty: 250, pack_unit: 'g' }, { now: T1 });
  const b = buildBaskets(decideAll(d, r));
  assert.equal(b.stores.auchan.lines.length, 1);
  assert.equal(b.stores.auchan.total, 2.4);
  assert.equal(b.total, 2.4);
});

test('fusion : la saisie la plus récente gagne, la suppression aussi', () => {
  const item = mk('sel');
  const a = setManualProduct(emptyData(), item, { price: 1, pack_qty: 1, pack_unit: 'kg' }, { now: T1 });
  const b = setManualProduct(emptyData(), item, { price: 2, pack_qty: 1, pack_unit: 'kg' }, { now: T2 });
  assert.equal(mergeData(a, b).manual_products[0].price, 2);
  assert.equal(mergeData(b, a).manual_products[0].price, 2);
  const gone = removeManualProduct(b, item, { now: '2026-11-03T00:00:00Z' });
  assert.equal(findManual(mergeData(b, gone).manual_products, item), null);
  assert.equal(sameContent(a, { ...a, manual_products: [...a.manual_products] }), true);
  assert.equal(sameContent(a, b), false);
});

test('lien de recherche Auchan', () => {
  assert.equal(auchanSearchUrl("lait d'avoine"), "https://www.auchan.fr/recherche?text=lait%20d'avoine");
});
