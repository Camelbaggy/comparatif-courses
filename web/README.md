# Appli web (liste de courses + comparaison)

Appli statique sans étape de build (Preact + htm via CDN, version épinglée). Interface en français, pensée mobile.

- `index.html`, `app.js`, `style.css`, `config.js` (identifiants Google à remplacer, dépôt GitHub)
- `js/compare.js` : logique pure (€/kg ou €/L, frais → Biocoop, ferme exclue, Auchan en repli seulement, paniers et totaux)
- `js/data.js`, `js/merge.js` : modèle de `courses-data.json` et fusion « dernier gagnant » par article
- `js/drive.js` : Google Drive (OAuth `drive.file` + Picker) ; `js/github.js` : `workflow_dispatch` + lecture des résultats
- `data/sample-*.json` : données d'exemple (mode démo, `?demo=1` ou sans jeton GitHub)

Tests : `cd web && npm test` (Node ≥ 20, aucune dépendance). Essai local : `python3 -m http.server 8080 --directory web`.

## Extensions du contrat (additives)

- Article : `updated_at`, `deleted`/`deleted_at` (suppression logique pour la fusion), `store_override`, `want_auchan`, `query` optionnel.
- Workflow `search.yml` : l'appli envoie `queries` = `[{"query": "lait d'avoine", "stores": ["lafourche","biocoop"]}, …]` (en minuscules), `stores` (union, virgules) et `run_id` ; résultat lu à `data/results/<run_id>.json` à côté du site (`gh-pages`).
