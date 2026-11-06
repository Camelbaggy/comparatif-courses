// Configuration de l'appli. Aucune valeur secrète ici : tout est public côté navigateur.
// Tant que les identifiants Google sont des valeurs « REMPLACER », l'appli fonctionne en mode local
// (données dans le navigateur) et la synchronisation Drive est désactivée.

export const CONFIG = {
  google: {
    // Console Google Cloud > Identifiants > ID client OAuth (application Web).
    // Origines JavaScript autorisées : https://camelbaggy.github.io (et http://localhost:8080 pour tester).
    clientId: 'REMPLACER.apps.googleusercontent.com',
    // Clé d'API (restreinte à l'API Picker) et numéro du projet Cloud (« appId » du Picker).
    apiKey: 'REMPLACER',
    appId: 'REMPLACER',
    fileName: 'courses-data.json',
  },
  github: {
    owner: 'Camelbaggy',
    repo: 'comparatif-courses',
    workflow: 'search.yml',
    ref: 'main',
    // URL des résultats publiés avec le site (data/results/<run_id>.json), relative à index.html.
    resultsBase: './data/results/',
  },
  // Données factices pour le mode démo (?demo=1 ou aucun jeton GitHub).
  sampleResults: './data/sample-results.json',
  sampleData: './data/sample-courses.json',
};

export const isPlaceholder = (v) => !v || /REMPLACER/.test(v);
export const driveConfigured = (cfg = CONFIG.google) =>
  !isPlaceholder(cfg.clientId) && !isPlaceholder(cfg.apiKey) && !isPlaceholder(cfg.appId);
