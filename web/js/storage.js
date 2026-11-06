// localStorage sécurisé (peut être indisponible ou vide en navigation privée).
export function load(key, fallback = null) {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function save(key, value) {
  try {
    if (value === undefined || value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* ignoré */
  }
}
