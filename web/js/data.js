// Modèle du fichier partagé courses-data.json (contrat §4) et opérations pures dessus.

export const DATA_VERSION = 1;
export const CATEGORY_LABELS = { normal: 'Normal', fresh: 'Frais', farm: 'Ferme' };
export const KIND_LABELS = { recurring: 'Habituel', oneoff: 'Ponctuel' };

export function emptyData() {
  return {
    version: DATA_VERSION,
    updated_at: null,
    updated_by: null,
    shopping_list: [],
    equivalences: [],
    manual_products: [],
    settings: { auchan_enabled: true, auchan_threshold_eur_per_kg: null },
  };
}

/** Complète un fichier lu (éventuellement ancien ou partiel) avec les valeurs par défaut. */
export function normalizeData(raw) {
  const base = emptyData();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    version: DATA_VERSION,
    shopping_list: Array.isArray(raw.shopping_list) ? raw.shopping_list : [],
    equivalences: Array.isArray(raw.equivalences) ? raw.equivalences : [],
    manual_products: Array.isArray(raw.manual_products) ? raw.manual_products : [],
    settings: { ...base.settings, ...(raw.settings ?? {}) },
  };
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

const stamp = (data, now, user) => ({ ...data, updated_at: now, updated_by: user ?? data.updated_by ?? null });

export function addItem(data, fields, { now = new Date().toISOString(), user, id = newId() } = {}) {
  const label = String(fields.label ?? '').trim();
  if (!label) return data;
  const item = {
    id,
    label,
    kind: fields.kind === 'oneoff' ? 'oneoff' : 'recurring',
    category: ['fresh', 'farm'].includes(fields.category) ? fields.category : 'normal',
    qty: fields.qty > 0 ? Number(fields.qty) : 1,
    checked: false,
    note: fields.note ?? '',
    updated_at: now,
  };
  return stamp({ ...data, shopping_list: [...data.shopping_list, item] }, now, user);
}

export function updateItem(data, id, patch, { now = new Date().toISOString(), user } = {}) {
  return stamp(
    {
      ...data,
      shopping_list: data.shopping_list.map((i) => (i.id === id ? { ...i, ...patch, updated_at: now } : i)),
    },
    now,
    user,
  );
}

/** Suppression logique (tombstone) pour que la fusion Drive ne ressuscite pas l'article. */
export function removeItem(data, id, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  return updateItem(data, id, { deleted: true, deleted_at: now }, { ...opts, now });
}

/** Fin des courses : retire les ponctuels cochés, décoche les habituels. */
export function finishShopping(data, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  const shopping_list = data.shopping_list.map((i) => {
    if (i.deleted || !i.checked) return i;
    if (i.kind === 'oneoff') return { ...i, deleted: true, deleted_at: now, updated_at: now };
    return { ...i, checked: false, updated_at: now };
  });
  return stamp({ ...data, shopping_list }, now, opts.user);
}

export function setEquivalence(data, item, preferred, { now = new Date().toISOString(), user } = {}) {
  const key = item.id;
  const entry = {
    list_item_id_or_label: key,
    label: item.label,
    preferred: { lafourche: null, biocoop: null, auchan: null, ...preferred },
    validated_by: user ?? null,
    validated_at: now,
  };
  const others = data.equivalences.filter(
    (e) => e.list_item_id_or_label !== key && e.list_item_id_or_label !== item.label,
  );
  return stamp({ ...data, equivalences: [...others, entry] }, now, user);
}

export function removeEquivalence(data, item, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  return stamp(
    {
      ...data,
      equivalences: data.equivalences.filter(
        (e) => e.list_item_id_or_label !== item.id && e.list_item_id_or_label !== item.label,
      ),
    },
    now,
    opts.user,
  );
}

export function updateSettings(data, patch, opts = {}) {
  const now = opts.now ?? new Date().toISOString();
  return stamp({ ...data, settings: { ...data.settings, ...patch } }, now, opts.user);
}

export const visibleItems = (data) => data.shopping_list.filter((i) => !i.deleted);

const UNIT_CODES = ['g', 'kg', 'ml', 'cl', 'l', 'unit'];

/** Enregistre (ou remplace) le prix Auchan saisi à la main pour un article. Renvoie data inchangé si invalide. */
export function setManualProduct(data, item, fields, { now = new Date().toISOString(), user } = {}) {
  const price = Number(String(fields.price).replace(',', '.'));
  const qty = Number(String(fields.pack_qty).replace(',', '.'));
  if (!(price > 0) || !(qty > 0) || !UNIT_CODES.includes(fields.pack_unit)) return data;
  const entry = {
    item_id_or_label: item.id,
    label: item.label,
    name: String(fields.name ?? '').trim(),
    pack_qty: qty,
    pack_unit: fields.pack_unit,
    price,
    url: fields.url ?? null,
    entered_by: user ?? null,
    entered_at: now,
  };
  const others = (data.manual_products ?? []).filter(
    (m) => m.item_id_or_label !== item.id && m.item_id_or_label !== item.label,
  );
  return stamp({ ...data, manual_products: [...others, entry] }, now, user);
}

/** Suppression logique (pour que la fusion Drive ne ressuscite pas la saisie). */
export function removeManualProduct(data, item, { now = new Date().toISOString(), user } = {}) {
  const manual_products = (data.manual_products ?? []).map((m) =>
    m.item_id_or_label === item.id || m.item_id_or_label === item.label
      ? { ...m, deleted: true, entered_at: now }
      : m,
  );
  return stamp({ ...data, manual_products }, now, user);
}
