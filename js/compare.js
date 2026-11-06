// Logique de comparaison : fonctions pures, sans DOM ni réseau (testées avec `npm test`).
// Règles métier : voir CLAUDE.md §3.3 et docs/contrat-technique.md.

export const STORES = ['lafourche', 'biocoop', 'auchan'];
export const STORE_LABELS = {
  lafourche: 'La Fourche',
  biocoop: 'Biocoop Seynod',
  auchan: 'Auchan Seynod',
};

const UNITS = {
  g: { basis: 'kg', factor: 0.001 },
  kg: { basis: 'kg', factor: 1 },
  ml: { basis: 'l', factor: 0.001 },
  cl: { basis: 'l', factor: 0.01 },
  l: { basis: 'l', factor: 1 },
  unit: { basis: 'unit', factor: 1 },
};
const BASIS_ORDER = ['kg', 'l', 'unit'];
export const BASIS_LABELS = { kg: '€/kg', l: '€/L', unit: '€/unité' };

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function normalizeLabel(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Taille du conditionnement exprimée dans l'unité de base (kg, L ou unité). */
export function packSize(product) {
  const u = UNITS[product?.pack_unit];
  const qty = Number(product?.pack_qty);
  if (!u || !(qty > 0)) return null;
  return { amount: qty * u.factor, basis: u.basis };
}

/** Prix réellement payé pour le conditionnement (promo si en cours). */
export function paidPrice(product) {
  const { price, promo_price: promo } = product;
  if (promo != null && (price == null || promo < price)) return promo;
  return price ?? null;
}

/**
 * Prix ramené à l'unité de mesure standard.
 * Recalculé depuis prix + conditionnement quand c'est possible, sinon repli sur le
 * prix unitaire lu sur le site (ajusté au prorata de la promo). null => « à vérifier ».
 */
export function unitPrice(product) {
  const price = paidPrice(product);
  const size = packSize(product);
  if (price != null && size) {
    return { value: price / size.amount, basis: size.basis };
  }
  if (product.unit_price != null && product.unit_price_basis) {
    const ratio = product.price && price != null ? price / product.price : 1;
    return { value: product.unit_price * ratio, basis: product.unit_price_basis };
  }
  return null;
}

export const isAvailable = (p) => p.in_stock !== false;

/** Base de comparaison la plus fréquente parmi des produits (kg > L > unité en cas d'égalité). */
export function dominantBasis(products) {
  const counts = {};
  for (const p of products) {
    const u = unitPrice(p);
    if (u) counts[u.basis] = (counts[u.basis] || 0) + 1;
  }
  let best = null;
  for (const b of BASIS_ORDER) {
    if (counts[b] && (best === null || counts[b] > counts[best])) best = b;
  }
  return best;
}

/**
 * Classe des produits d'une enseigne : disponibles d'abord, puis prix croissant dans la
 * base choisie ; les produits sans prix unitaire ou dans une autre base viennent à la fin.
 */
export function rankProducts(products, basis) {
  const entries = (products ?? []).map((product) => {
    const unit = unitPrice(product);
    return {
      product,
      unit,
      available: isAvailable(product),
      comparable: !!unit && (!basis || unit.basis === basis),
      toCheck: !unit,
    };
  });
  const group = (e) => (e.comparable ? (e.available ? 0 : 1) : 2);
  return entries.sort(
    (a, b) =>
      group(a) - group(b) ||
      (group(a) < 2 ? a.unit.value - b.unit.value : 0) ||
      String(a.product.name).localeCompare(String(b.product.name), 'fr'),
  );
}

export function findEquivalence(equivalences, item) {
  const label = normalizeLabel(item.label);
  return (
    (equivalences ?? []).find(
      (e) => e.list_item_id_or_label === item.id || normalizeLabel(e.list_item_id_or_label) === label,
    ) ?? null
  );
}

/** Clé de requête envoyée aux scrapers pour un article (et clé dans results.queries). */
export const queryFor = (item) => String(item.query || item.label || '').trim().toLowerCase();

/** Produits trouvés pour un article dans un résultat de run (clé insensible à la casse/accents). */
export function candidatesFor(item, run, store) {
  const queries = run?.queries;
  if (!queries) return null;
  const wanted = normalizeLabel(queryFor(item));
  const key = Object.keys(queries).find((k) => normalizeLabel(k) === wanted);
  return key === undefined ? null : (queries[key]?.[store] ?? []);
}

const sameSku = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * Décide où acheter un article.
 * status : farm | pending (pas encore cherché) | assigned | unfound
 */
export function decideItem(item, run, equivalences = [], settings = {}) {
  const quantity = item.qty > 0 ? item.qty : 1;
  const base = {
    item,
    quantity,
    status: 'pending',
    store: null,
    chosen: {},
    options: {},
    validated: false,
    needsValidation: false,
    saving: null,
    auchanSuggestion: null,
    reasons: [],
  };

  if (item.category === 'farm') {
    return { ...base, status: 'farm', reasons: ['Fourni par la ferme : pas de comparaison.'] };
  }

  const fresh = item.category === 'fresh';
  const stores = fresh ? ['biocoop', 'auchan'] : STORES;
  const raw = Object.fromEntries(stores.map((s) => [s, candidatesFor(item, run, s)]));
  if (stores.every((s) => raw[s] === null)) {
    return { ...base, reasons: ['Recherche pas encore lancée.'] };
  }

  const eq = findEquivalence(equivalences, item);
  const preferred = eq?.preferred ?? {};

  // Base de comparaison : celle des produits validés s'ils sont présents, sinon la plus fréquente.
  const all = stores.flatMap((s) => raw[s] ?? []);
  const prefProducts = stores
    .map((s) => (raw[s] ?? []).find((p) => sameSku(p.id, preferred[s])))
    .filter(Boolean);
  const basis = dominantBasis(prefProducts.length ? prefProducts : all);

  const chosen = {};
  const options = {};
  const reasons = [];
  for (const s of stores) {
    const ranked = rankProducts(raw[s] ?? [], basis);
    options[s] = ranked;
    const pref = ranked.find((e) => sameSku(e.product.id, preferred[s]));
    if (pref && pref.available && pref.comparable) {
      chosen[s] = pref;
    } else {
      if (pref) reasons.push(`Produit validé indisponible chez ${STORE_LABELS[s]} : meilleur prix proposé à la place.`);
      chosen[s] = ranked.find((e) => e.comparable && e.available) ?? null;
    }
  }

  // Candidats en concurrence (règles d'enseigne).
  let contenders = fresh ? ['biocoop'] : ['lafourche', 'biocoop'];
  if (item.want_auchan) contenders = [...contenders, 'auchan'];
  contenders = contenders.filter((s) => chosen[s]);

  let store = null;
  if (item.store_override && chosen[item.store_override]) {
    store = item.store_override;
    reasons.push(`Enseigne choisie manuellement : ${STORE_LABELS[store]}.`);
  } else if (contenders.length) {
    store = contenders.reduce((best, s) =>
      chosen[s].unit.value < chosen[best].unit.value - 1e-9 ? s : best,
    );
  } else if (settings.auchan_enabled !== false && chosen.auchan) {
    store = 'auchan';
    reasons.push(
      fresh
        ? 'Introuvable chez Biocoop : repli sur Auchan.'
        : 'Introuvable chez La Fourche et Biocoop : repli sur Auchan.',
    );
  }

  const validated = !!eq && stores.some((s) => sameSku(chosen[s]?.product.id, preferred[s]));
  if (!store) {
    return {
      ...base,
      status: 'unfound',
      chosen,
      options,
      reasons: [...reasons, 'Aucun produit disponible trouvé.'],
    };
  }

  // Économie par rapport à la meilleure alternative comparée.
  let saving = null;
  const rivals = contenders.filter((s) => s !== store);
  if (rivals.length) {
    const rival = rivals.reduce((b, s) => (chosen[s].unit.value < chosen[b].unit.value ? s : b));
    const size = packSize(chosen[store].product);
    const diff = chosen[rival].unit.value - chosen[store].unit.value;
    if (size && diff > 0) {
      saving = { amount: round2(diff * size.amount * quantity), versus: rival };
    }
  }

  // Suggestion Auchan quand le bio dépasse le seuil (jamais appliquée automatiquement).
  let auchanSuggestion = null;
  const threshold = settings.auchan_threshold_eur_per_kg;
  const cur = chosen[store];
  if (
    store !== 'auchan' &&
    threshold != null &&
    cur.unit.basis === 'kg' &&
    cur.unit.value > threshold &&
    chosen.auchan &&
    chosen.auchan.unit.value < cur.unit.value
  ) {
    auchanSuggestion = chosen.auchan;
  }

  return {
    ...base,
    status: 'assigned',
    store,
    chosen,
    options,
    product: cur.product,
    unit: cur.unit,
    lineTotal: round2(paidPrice(cur.product) * quantity),
    validated,
    needsValidation: !validated && contenders.length > 1,
    saving,
    auchanSuggestion,
    reasons,
  };
}

/** Articles actifs de la liste (non supprimés, non cochés). */
export const activeItems = (data) =>
  (data.shopping_list ?? []).filter((i) => !i.deleted && !i.checked);

export function decideAll(data, run) {
  return activeItems(data).map((item) => decideItem(item, run, data.equivalences, data.settings));
}

/** Paniers par enseigne + synthèse. */
export function buildBaskets(decisions) {
  const stores = Object.fromEntries(
    STORES.map((s) => [s, { store: s, lines: [], total: 0, savings: 0 }]),
  );
  const farm = [];
  const unfound = [];
  const pending = [];
  for (const d of decisions) {
    if (d.status === 'farm') farm.push(d.item);
    else if (d.status === 'unfound') unfound.push(d);
    else if (d.status === 'pending') pending.push(d);
    else {
      const b = stores[d.store];
      b.lines.push(d);
      b.total = round2(b.total + d.lineTotal);
      b.savings = round2(b.savings + (d.saving?.amount ?? 0));
    }
  }
  const total = round2(STORES.reduce((sum, s) => sum + stores[s].total, 0));
  const totalSavings = round2(STORES.reduce((sum, s) => sum + stores[s].savings, 0));
  return { stores, farm, unfound, pending, total, totalSavings };
}

/**
 * Demande de recherche pour GitHub Actions (format de queries.json des scrapers) :
 * une entrée {query, stores} par requête unique, pour ne pas interroger La Fourche
 * sur les produits frais. Auchan n'est interrogé que s'il est activé (repli).
 */
export function buildSearchRequest(data) {
  const auchan = data.settings?.auchan_enabled !== false;
  const items = activeItems(data).filter((i) => i.category !== 'farm');
  const byQuery = new Map();
  for (const i of items) {
    const q = queryFor(i);
    if (!q) continue;
    const stores = new Set(byQuery.get(q) ?? []);
    for (const s of i.category === 'fresh' ? ['biocoop'] : ['lafourche', 'biocoop']) stores.add(s);
    if (auchan) stores.add('auchan');
    byQuery.set(q, stores);
  }
  const queries = [...byQuery].map(([query, set]) => ({ query, stores: STORES.filter((s) => set.has(s)) }));
  const stores = STORES.filter((s) => queries.some((q) => q.stores.includes(s)));
  return { queries, stores };
}
