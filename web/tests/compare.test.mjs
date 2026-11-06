import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  unitPrice, packSize, paidPrice, rankProducts, decideItem, decideAll, buildBaskets,
  buildSearchRequest, candidatesFor, normalizeLabel, round2,
} from '../js/compare.js';
import { emptyData, addItem } from '../js/data.js';

const run = JSON.parse(readFileSync(new URL('../data/sample-results.json', import.meta.url)));
const data = JSON.parse(readFileSync(new URL('../data/sample-courses.json', import.meta.url)));
const item = (label) => data.shopping_list.find((i) => i.label === label);
const settings = { auchan_enabled: true, auchan_threshold_eur_per_kg: null };

test('conversion d\'unités et prix unitaire', () => {
  assert.deepEqual(packSize({ pack_qty: 500, pack_unit: 'g' }), { amount: 0.5, basis: 'kg' });
  assert.deepEqual(packSize({ pack_qty: 75, pack_unit: 'cl' }), { amount: 0.75, basis: 'l' });
  assert.equal(packSize({ pack_qty: null, pack_unit: 'g' }), null);
  const u = unitPrice({ price: 1.45, pack_qty: 500, pack_unit: 'g' });
  assert.equal(round2(u.value), 2.9);
  assert.equal(u.basis, 'kg');
});

test('la promo prime sur le prix normal', () => {
  const p = { price: 1.89, promo_price: 1.69, pack_qty: 1, pack_unit: 'l' };
  assert.equal(paidPrice(p), 1.69);
  assert.equal(unitPrice(p).value, 1.69);
  assert.equal(paidPrice({ price: 2, promo_price: 2.5 }), 2);
});

test('repli sur le prix unitaire du site si conditionnement inconnu, null sinon', () => {
  const site = { price: 4, promo_price: 2, pack_qty: null, pack_unit: 'g', unit_price: 8, unit_price_basis: 'kg' };
  assert.equal(unitPrice(site).value, 4);
  assert.equal(unitPrice({ price: 3, pack_qty: null, pack_unit: 'g' }), null);
});

test('classement : disponibles d\'abord, prix croissant, « à vérifier » en dernier', () => {
  const ranked = rankProducts(
    [
      { id: 'a', name: 'a', price: 5, pack_qty: 1, pack_unit: 'kg' },
      { id: 'b', name: 'b', price: 3, pack_qty: 1, pack_unit: 'kg', in_stock: false },
      { id: 'c', name: 'c', price: 4, pack_qty: null, pack_unit: 'g' },
      { id: 'd', name: 'd', price: 2, pack_qty: 1, pack_unit: 'kg' },
      { id: 'e', name: 'e', price: 1, pack_qty: 1, pack_unit: 'l' },
    ],
    'kg',
  );
  assert.deepEqual(ranked.map((r) => r.product.id), ['d', 'a', 'b', 'c', 'e']);
  assert.equal(ranked.find((r) => r.product.id === 'c').toCheck, true);
});

test('recherche des candidats insensible à la casse et aux accents', () => {
  assert.equal(candidatesFor(item('farine de blé T65'), run, 'biocoop').length, 2);
  assert.equal(candidatesFor({ label: 'inconnu' }, run, 'biocoop'), null);
  assert.equal(normalizeLabel("Lait d'Avoine"), 'lait d avoine');
});

test('€/kg : La Fourche gagne pour les flocons, avec économie calculée', () => {
  const d = decideItem(item("flocons d'avoine"), run, [], settings);
  // LF 2.90 €/kg, Biocoop vrac 2.60 €/kg -> Biocoop moins cher
  assert.equal(d.store, 'biocoop');
  assert.equal(d.product.id, 'BC-FLO-V');
  // 2 paquets de 1 kg : (2.99 - ... ) vérifie l'économie vs La Fourche (2.90 - 2.60) * 1 kg * 2
  assert.equal(d.saving.versus, 'lafourche');
  assert.equal(d.saving.amount, 0.6);
  assert.equal(d.lineTotal, 5.2);
});

test('formats différents : le prix au litre départage (promo incluse)', () => {
  const d = decideItem(item("lait d'avoine"), run, [], settings);
  assert.equal(d.store, 'biocoop'); // 1.69 promo < 1.95
  assert.equal(d.product.id, 'BC-LAI-2');
  assert.equal(d.lineTotal, 10.14);
  assert.equal(d.saving.amount, round2((1.95 - 1.69) * 1 * 6));
});

test('un produit en rupture n\'est jamais choisi', () => {
  const d = decideItem(item('farine de blé T65'), run, [], settings);
  assert.equal(d.store, 'biocoop');
  assert.equal(d.product.id, 'BC-FAR-1');
});

test('produit frais : Biocoop uniquement, La Fourche ignorée, Auchan en repli', () => {
  const yaourt = decideItem(item('yaourt nature'), run, [], settings);
  assert.equal(yaourt.store, 'biocoop');
  assert.equal(yaourt.chosen.lafourche, undefined);
  assert.equal(yaourt.saving, null); // Auchan moins cher mais non demandé
  const beurre = decideItem(item('beurre doux'), run, [], settings);
  assert.equal(beurre.store, 'auchan');
  assert.match(beurre.reasons.join(' '), /repli sur Auchan/);
  const off = decideItem(item('beurre doux'), run, [], { ...settings, auchan_enabled: false });
  assert.equal(off.status, 'unfound');
});

test('un produit frais ignore les résultats La Fourche même présents', () => {
  const fake = { queries: { x: { lafourche: [{ id: 'z', name: 'z', price: 0.1, pack_qty: 1, pack_unit: 'kg' }], biocoop: [{ id: 'b', name: 'b', price: 9, pack_qty: 1, pack_unit: 'kg' }] } } };
  const d = decideItem({ id: '1', label: 'x', category: 'fresh', qty: 1 }, fake, [], settings);
  assert.equal(d.store, 'biocoop');
});

test('ferme : jamais comparé', () => {
  const d = decideItem(item('carottes'), run, [], settings);
  assert.equal(d.status, 'farm');
  assert.equal(d.store, null);
});

test('Auchan n\'est retenu que si absent des deux autres, ou demandé', () => {
  const huile = decideItem(item("huile d'olive"), run, [], settings);
  assert.equal(huile.store, 'lafourche'); // Auchan 8.50 €/L serait moins cher mais n'est pas candidat
  const asked = decideItem({ ...item("huile d'olive"), want_auchan: true }, run, [], settings);
  assert.equal(asked.store, 'auchan');
  const none = decideItem(item('produit inexistant'), run, [], settings);
  assert.equal(none.status, 'unfound');
});

test('seuil Auchan : simple suggestion, pas d\'affectation automatique', () => {
  const d = decideItem(item("huile d'olive"), run, [], { ...settings, auchan_threshold_eur_per_kg: 5 });
  // base L -> pas de suggestion (seuil exprimé en €/kg)
  assert.equal(d.auchanSuggestion, null);
  const kg = decideItem(item("flocons d'avoine"), run, [], { ...settings, auchan_threshold_eur_per_kg: 2 });
  assert.equal(kg.store, 'biocoop');
  assert.equal(kg.auchanSuggestion, null); // Auchan 3.30 €/kg est plus cher
  const cher = decideItem(item('chocolat noir 70%'), { queries: { 'chocolat noir 70%': { lafourche: run.queries['chocolat noir 70%'].lafourche, biocoop: [], auchan: [{ id: 'A', name: 'A', price: 1, pack_qty: 100, pack_unit: 'g' }] } } }, [], { ...settings, auchan_threshold_eur_per_kg: 10 });
  assert.equal(cher.store, 'lafourche');
  assert.equal(cher.auchanSuggestion.product.id, 'A');
});

test('équivalence validée : on compare les produits mémorisés, pas le meilleur prix', () => {
  const eq = [{ list_item_id_or_label: item('chocolat noir 70%').id, preferred: { lafourche: 'LF-CHO-2', biocoop: 'BC-CHO-1', auchan: null } }];
  const d = decideItem(item('chocolat noir 70%'), run, eq, settings);
  // LF-CHO-2 : 16 €/kg ; BC-CHO-1 : 25.5 €/kg
  assert.equal(d.validated, true);
  assert.equal(d.needsValidation, false);
  assert.equal(d.product.id, 'LF-CHO-2');
  // sans équivalence : LF-CHO-1 à 23.9 €/kg ne bat pas LF-CHO-2 (16) mais reste à valider
  const free = decideItem(item('chocolat noir 70%'), run, [], settings);
  assert.equal(free.needsValidation, true);
  assert.equal(free.product.id, 'LF-CHO-2');
});

test('équivalence retrouvée par libellé', () => {
  const eq = [{ list_item_id_or_label: "Lait d'avoine", preferred: { lafourche: 'LF-LAI-1', biocoop: 'BC-LAI-1' } }];
  const d = decideItem(item("lait d'avoine"), run, eq, settings);
  assert.equal(d.product.id, 'LF-LAI-1'); // 1.95 < 2.05
});

test('produit validé indisponible : repli sur le meilleur prix avec explication', () => {
  const eq = [{ list_item_id_or_label: item("lait d'avoine").id, preferred: { lafourche: 'LF-LAI-2', biocoop: null } }];
  const d = decideItem(item("lait d'avoine"), run, eq, settings);
  assert.match(d.reasons.join(' '), /indisponible chez La Fourche/);
  assert.equal(d.chosen.lafourche.product.id, 'LF-LAI-1');
});

test('forçage manuel de l\'enseigne', () => {
  const d = decideItem({ ...item("lait d'avoine"), store_override: 'lafourche' }, run, [], settings);
  assert.equal(d.store, 'lafourche');
});

test('bases incomparables : on garde la base dominante', () => {
  const d = decideItem(item('lessive'), run, [], settings);
  // LF en L (1), Biocoop en unité (1) : égalité -> kg > L > unité => L ; Biocoop non comparable
  assert.equal(d.store, 'lafourche');
});

test('pas de résultat pour l\'article => en attente', () => {
  const d = decideItem({ id: 'n', label: 'nouveau', category: 'normal', qty: 1 }, run, [], settings);
  assert.equal(d.status, 'pending');
});

test('paniers par enseigne, totaux et synthèse', () => {
  const decisions = decideAll(data, run);
  const b = buildBaskets(decisions);
  assert.equal(decisions.length, 11);
  assert.deepEqual(b.farm.map((i) => i.label), ['carottes', 'poulet fermier']);
  assert.equal(b.unfound.length, 1);
  const sum = round2(b.stores.lafourche.total + b.stores.biocoop.total + b.stores.auchan.total);
  assert.equal(b.total, sum);
  assert.ok(b.stores.auchan.lines.some((l) => l.item.label === 'beurre doux'));
  assert.ok(b.stores.biocoop.lines.some((l) => l.item.label === 'yaourt nature'));
  assert.ok(b.totalSavings > 0);
  for (const s of Object.values(b.stores)) {
    assert.equal(s.total, round2(s.lines.reduce((t, l) => t + l.lineTotal, 0)));
  }
});

test('articles cochés ou supprimés exclus', () => {
  const d2 = { ...data, shopping_list: data.shopping_list.map((i) => (i.label === 'lessive' ? { ...i, checked: true } : i.label === 'carottes' ? { ...i, deleted: true } : i)) };
  const ds = decideAll(d2, run);
  assert.equal(ds.length, 9);
});

test('requête de recherche : uniques, sans ferme, La Fourche seulement si utile', () => {
  const req = buildSearchRequest(data);
  assert.ok(!req.queries.includes('carottes'));
  assert.equal(req.queries.length, 9);
  assert.deepEqual(req.stores, ['lafourche', 'biocoop', 'auchan']);
  let d = addItem(emptyData(), { label: 'Lait', category: 'fresh' });
  assert.deepEqual(buildSearchRequest(d), { queries: ['lait'], stores: ['biocoop', 'auchan'] });
  d = { ...d, settings: { ...d.settings, auchan_enabled: false } };
  assert.deepEqual(buildSearchRequest(d).stores, ['biocoop']);
});
