// Lecture/écriture du fichier partagé courses-data.json sur Google Drive.
// OAuth côté navigateur (Google Identity Services), scope drive.file, sélecteur Google (Picker)
// pour que la 2e personne ouvre le fichier une fois ; l'identifiant est ensuite mémorisé.

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new DriveError(`Impossible de charger ${src}`));
    document.head.appendChild(s);
  });
}

/** Jeton d'accès via Google Identity Services (fenêtre de consentement au besoin). */
export function googleTokenProvider(clientId) {
  let token = null;
  let expiresAt = 0;
  let client = null;
  return async function getToken({ interactive = true, force = false } = {}) {
    if (!force && token && Date.now() < expiresAt - 60_000) return token;
    await loadScript('https://accounts.google.com/gsi/client');
    return new Promise((resolve, reject) => {
      client = client || globalThis.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: () => {},
      });
      client.callback = (resp) => {
        if (resp.error) return reject(new DriveError(resp.error_description || resp.error, 401));
        token = resp.access_token;
        expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        resolve(token);
      };
      client.error_callback = (e) => reject(new DriveError(e?.message || 'Connexion Google annulée', 401));
      client.requestAccessToken({ prompt: interactive ? (token ? '' : 'consent') : 'none' });
    });
  };
}

/**
 * @param {object} opts
 * @param {object} opts.config      { clientId, apiKey, appId, fileName }
 * @param {Function} [opts.getToken] fournisseur de jeton (injectable pour les tests)
 * @param {Function} [opts.fetchImpl]
 */
export function createDriveClient({ config, getToken, fetchImpl } = {}) {
  const doFetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const tokenFn = getToken ?? googleTokenProvider(config.clientId);

  async function request(url, init = {}, retry = true) {
    const token = await tokenFn({ interactive: true });
    const res = await doFetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retry) {
      await tokenFn({ interactive: true, force: true });
      return request(url, init, false);
    }
    if (!res.ok) {
      const hint =
        res.status === 404
          ? " Fichier introuvable ou pas encore ouvert avec cette appli : utilisez « Ouvrir le fichier partagé »."
          : '';
      throw new DriveError(`Drive ${res.status}.${hint}`, res.status);
    }
    return res;
  }

  return {
    signIn: () => tokenFn({ interactive: true }),

    async whoami() {
      try {
        const res = await request(`${API}/about?fields=user(emailAddress,displayName)`);
        return (await res.json()).user?.emailAddress ?? null;
      } catch {
        return null;
      }
    },

    async read(fileId) {
      const res = await request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`);
      return res.json();
    },

    async write(fileId, data) {
      const res = await request(`${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data, null, 2),
      });
      return res.json();
    },

    /** Crée le fichier (dans « Mon Drive ») ; à partager ensuite avec l'autre compte depuis Drive. */
    async create(data, name = config.fileName ?? 'courses-data.json') {
      const boundary = 'courses' + Math.random().toString(16).slice(2);
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name, mimeType: 'application/json' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
        JSON.stringify(data, null, 2) +
        `\r\n--${boundary}--`;
      const res = await request(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return (await res.json()).id;
    },

    /** Sélecteur Google : donne accès au fichier à cette appli (scope drive.file). Renvoie l'id ou null. */
    async pick() {
      const token = await tokenFn({ interactive: true });
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise((resolve) => globalThis.gapi.load('picker', resolve));
      const { google } = globalThis;
      return new Promise((resolve) => {
        const view = new google.picker.DocsView()
          .setMimeTypes('application/json')
          .setIncludeFolders(false)
          .setQuery(config.fileName ?? 'courses-data.json');
        new google.picker.PickerBuilder()
          .addView(view)
          .addView(new google.picker.DocsView().setMimeTypes('application/json').setOwnedByMe(false))
          .setOAuthToken(token)
          .setDeveloperKey(config.apiKey)
          .setAppId(config.appId)
          .setLocale('fr')
          .setCallback((r) => {
            if (r.action === google.picker.Action.PICKED) resolve(r.docs[0].id);
            else if (r.action === google.picker.Action.CANCEL) resolve(null);
          })
          .build()
          .setVisible(true);
      });
    },
  };
}
