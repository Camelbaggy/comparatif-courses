// Déclenchement du workflow de recherche (workflow_dispatch) et lecture des résultats publiés.
// Le jeton GitHub (portée minimale : Actions en lecture/écriture sur ce seul dépôt) est
// enregistré dans le navigateur de chaque utilisateur ; il n'est jamais dans le dépôt.

export class GithubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

/** run_id au format 20261106T053000Z */
export function makeRunId(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createGithubClient({ config, token, fetchImpl, sleepImpl = sleep } = {}) {
  const doFetch = fetchImpl ?? ((...a) => globalThis.fetch(...a));
  const api = `https://api.github.com/repos/${config.owner}/${config.repo}`;
  const headers = () => ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  });

  const resultsUrl = (runId) => `${config.resultsBase}${runId}.json`;

  return {
    resultsUrl,

    /**
     * Lance le workflow. Entrées (chaînes) : queries = tableau JSON de requêtes,
     * stores = liste séparée par des virgules, run_id = identifiant choisi par l'appli.
     */
    async dispatchSearch({ queries, stores, runId = makeRunId() }) {
      if (!token) throw new GithubError('Jeton GitHub manquant (Réglages).', 401);
      const res = await doFetch(`${api}/actions/workflows/${config.workflow}/dispatches`, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ref: config.ref,
          inputs: { queries: JSON.stringify(queries), stores: stores.join(','), run_id: runId },
        }),
      });
      if (res.status !== 204) {
        const hint = res.status === 401 || res.status === 403 ? ' Vérifiez le jeton et ses droits.' : '';
        throw new GithubError(`Lancement refusé par GitHub (${res.status}).${hint}`, res.status);
      }
      return { runId, dispatchedAt: new Date().toISOString() };
    },

    /** Dernier run du workflow créé après `since` (null si pas encore visible). */
    async findRun(since) {
      const res = await doFetch(
        `${api}/actions/workflows/${config.workflow}/runs?event=workflow_dispatch&per_page=5`,
        { headers: headers() },
      );
      if (!res.ok) return null;
      const { workflow_runs: runs = [] } = await res.json();
      const t = Date.parse(since) - 60_000;
      return runs.find((r) => Date.parse(r.created_at) >= t) ?? null;
    },

    /** Charge un résultat publié ; null tant qu'il n'existe pas (404). */
    async loadResults(runId) {
      const res = await doFetch(`${resultsUrl(runId)}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new GithubError(`Lecture des résultats impossible (${res.status}).`, res.status);
      return res.json();
    },

    /** Attend la publication des résultats ; remonte l'état du workflow via onStatus. */
    async waitForResults({ runId, dispatchedAt, onStatus, intervalMs = 10_000, timeoutMs = 15 * 60_000, signal }) {
      const start = Date.now();
      let tick = 0;
      while (Date.now() - start < timeoutMs) {
        if (signal?.aborted) throw new GithubError('Recherche annulée.');
        const results = await this.loadResults(runId);
        if (results) return results;
        if (token && tick % 3 === 0) {
          const run = await this.findRun(dispatchedAt).catch(() => null);
          if (run) {
            onStatus?.(run.status === 'completed' ? `Terminé (${run.conclusion})` : 'Recherche en cours…');
            if (run.status === 'completed' && run.conclusion !== 'success') {
              throw new GithubError(`Le workflow a échoué (${run.conclusion}). Voir l'onglet Actions du dépôt.`);
            }
          } else {
            onStatus?.('En attente du démarrage…');
          }
        }
        tick++;
        await sleepImpl(intervalMs);
      }
      throw new GithubError('Délai dépassé : les résultats ne sont pas encore publiés.');
    },
  };
}
