// Fusion « dernier gagnant » entre la copie locale et le fichier Drive (contrat §4).
// Fusion par id d'article (horodatage par article), pas de verrou.

const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000;
const ts = (s) => (s ? Date.parse(s) || 0 : 0);

export function mergeData(local, remote, now = new Date().toISOString()) {
  if (!remote) return local;
  if (!local) return remote;
  const localDoc = ts(local.updated_at);
  const remoteDoc = ts(remote.updated_at);

  const items = new Map();
  for (const i of remote.shopping_list ?? []) items.set(i.id, { item: i, at: ts(i.updated_at) || remoteDoc });
  for (const i of local.shopping_list ?? []) {
    const at = ts(i.updated_at) || localDoc;
    const other = items.get(i.id);
    if (!other || at >= other.at) items.set(i.id, { item: i, at });
  }
  const shopping_list = [...items.values()]
    .map((v) => v.item)
    .filter((i) => !(i.deleted && ts(now) - ts(i.deleted_at) > TOMBSTONE_TTL_MS));

  const eqs = new Map();
  for (const e of [...(remote.equivalences ?? []), ...(local.equivalences ?? [])]) {
    const key = e.list_item_id_or_label;
    const other = eqs.get(key);
    if (!other || ts(e.validated_at) >= ts(other.validated_at)) eqs.set(key, e);
  }

  const manual = new Map();
  for (const m of [...(remote.manual_products ?? []), ...(local.manual_products ?? [])]) {
    const other = manual.get(m.item_id_or_label);
    if (!other || ts(m.entered_at) >= ts(other.entered_at)) manual.set(m.item_id_or_label, m);
  }

  const newer = localDoc >= remoteDoc ? local : remote;
  return {
    ...newer,
    version: 1,
    shopping_list,
    equivalences: [...eqs.values()],
    manual_products: [...manual.values()],
    settings: { ...remote.settings, ...newer.settings },
    updated_at: newer.updated_at,
    updated_by: newer.updated_by,
  };
}

/** Comparaison du contenu en ignorant les métadonnées de fichier. */
export function sameContent(a, b) {
  const strip = ({ updated_at, updated_by, ...rest }) => rest;
  const norm = (d) =>
    JSON.stringify(strip(d), (k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)))
        : v,
    );
  const sortList = (d) => ({
    ...d,
    shopping_list: [...d.shopping_list].sort((x, y) => x.id.localeCompare(y.id)),
    equivalences: [...d.equivalences].sort((x, y) =>
      String(x.list_item_id_or_label).localeCompare(String(y.list_item_id_or_label)),
    ),
    manual_products: [...(d.manual_products ?? [])].sort((x, y) =>
      String(x.item_id_or_label).localeCompare(String(y.item_id_or_label)),
    ),
  });
  return norm(sortList(a)) === norm(sortList(b));
}
