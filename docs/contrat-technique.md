# Contrat technique v0 (option A) : à valider avant de coder

Objectif : permettre à plusieurs threads de coder en parallèle sans se marcher dessus. Tout est volontairement minimal.

## 1. Structure du dépôt (monorepo `courses`, compte Camelbaggy)

```
courses/
  web/                     # appli statique, sans étape de build (HTML + JS modules, Preact via CDN possible)
    index.html, app.js, js/
    js/drive.js            # lecture/écriture du fichier partagé Google Drive
    js/compare.js          # logique de comparaison (pure, testable)
    js/github.js           # déclenchement du workflow + lecture des résultats
  scrapers/                # paquet Python 3.12, dépendances : httpx, selectolax (ou beautifulsoup4)
    common.py              # modèle Product, normalisation d'unités, client HTTP poli
    biocoop.py, lafourche.py, auchan.py   # un module par enseigne
    run.py                 # CLI utilisé par GitHub Actions
    tests/                 # tests sur HTML/JSON enregistrés (fixtures), pas de réseau
  data/results/            # sorties des scrapers (JSON), publiées avec le site
  docs/                    # ce contrat, notes
  .github/workflows/search.yml   # workflow_dispatch (+ cron plus tard)
```

Règle : un thread = un dossier (web/, scrapers/<enseigne>, workflow). Les schémas ci-dessous sont la seule interface partagée.

## 2. Schéma produit commun (sortie de tous les scrapers)

```json
{
  "store": "biocoop|lafourche|auchan",
  "store_ref": "Biocoop Seynod | La Fourche | Auchan Seynod",
  "id": "GE8336_000",               // identifiant propre à l'enseigne (SKU)
  "ean": "3760121216588|null",
  "name": "Flocons d'avoine germée",
  "brand": "Germline|null",
  "pack_qty": 350,                  // quantité du conditionnement
  "pack_unit": "g|kg|ml|cl|l|unit", // unité telle que lue
  "price": 2.85,                    // prix TTC payé pour le conditionnement, en euros
  "promo_price": null,              // prix promo si en cours
  "unit_price": 8.14,               // prix normalisé
  "unit_price_basis": "kg|l|unit",  // €/kg, €/L ou €/unité
  "unit_price_source": "site|computed", // lu sur le site ou calculé par nous
  "in_stock": true,                 // null si inconnu
  "url": "https://...",
  "image": "https://...|null",
  "category": "Epicerie sucrée/Céréales|null",
  "member_price": false,            // La Fourche : true si le prix est le prix adhérent
  "fetched_at": "2026-11-06T05:30:00Z"
}
```

Règles de normalisation (dans `common.py`, testées) : g/kg vers €/kg, ml/cl/l vers €/L, vrac Biocoop affiché au 100 g converti en €/kg. `unit_price` est toujours recalculé depuis `price` et `pack_qty` quand possible ; la valeur du site sert de contrôle. Si le conditionnement est inconnu, `unit_price` est null et le produit est signalé « à vérifier ».

## 3. Interface d'un module de scraper

```python
class Scraper(Protocol):
    store: str
    def search(self, query: str, limit: int = 10) -> list[Product]: ...
    def get(self, product_id: str) -> Product | None: ...   # rafraîchir un produit connu
```

- Chaque enseigne est indépendante : une panne de l'une ne bloque pas les autres (erreur capturée par `run.py`, indiquée dans la sortie).
- Client HTTP poli : User-Agent identifiable, une requête à la fois, pause entre requêtes (au moins 2 s ; Biocoop demande 30 s dans son robots.txt, on respecte un cache et on limite le volume), cache disque.
- Aucun accès réseau dans les tests : fixtures HTML/JSON dans `scrapers/tests/fixtures/`.
- CLI : `python -m scrapers.run --stores biocoop,lafourche --queries queries.json --out data/results/<run_id>.json`.

Format de sortie d'un run :

```json
{
  "run_id": "20261106T053000Z",
  "queries": { "flocons avoine": { "biocoop": [Product], "lafourche": [Product], "auchan": [] } },
  "errors": { "auchan": "message ou null" }
}
```

## 4. Fichier de données partagé sur Google Drive (`courses-data.json`)

```json
{
  "version": 1,
  "updated_at": "...", "updated_by": "email",
  "shopping_list": [
    { "id": "uuid", "label": "lait d'avoine", "kind": "recurring|oneoff", "category": "normal|fresh|farm",
      "qty": 2, "checked": false, "note": "" }
  ],
  "equivalences": [
    { "list_item_id_or_label": "lait d'avoine",
      "preferred": { "lafourche": "SKU", "biocoop": "SKU", "auchan": "SKU|null" },
      "validated_by": "email", "validated_at": "..." }
  ],
  "settings": { "auchan_enabled": true, "auchan_threshold_eur_per_kg": null }
}
```

- Règles métier : `fresh` → Biocoop (repli Auchan), pas de requête La Fourche ; `farm` → jamais comparé ; Auchan uniquement en repli ou sur demande.
- Concurrence : écriture « dernier gagnant » avec un champ `updated_at` et une fusion simple par `id` (pas de verrou, deux utilisateurs seulement).
- Accès Drive : OAuth Google côté navigateur, scope `drive.file`, fichier dans un dossier partagé entre les deux comptes. Avec `drive.file`, la 2e personne doit ouvrir le fichier une fois via le sélecteur Google (Picker) ; l'identifiant est ensuite mémorisé dans le navigateur. Nicolas devra créer le projet Google Cloud et l'identifiant OAuth (je guiderai ; mode « test » avec les 2 adresses suffit).

## 5. Déclenchement des recherches (le point délicat de l'option A)

Le navigateur ne peut pas appeler les enseignes (CORS). Flux proposé :
1. L'appli appelle `workflow_dispatch` de `search.yml` avec la liste des requêtes (jeton GitHub à portée minimale, enregistré dans le navigateur de chaque utilisateur).
2. Le workflow exécute les scrapers et publie `data/results/<run_id>.json` (branche `gh-pages`).
3. L'appli interroge le statut puis charge le JSON, et fait la comparaison dans le navigateur (`compare.js`).

Secrets GitHub : identifiants La Fourche uniquement si le prix adhérent est requis (à décider après test). Jamais dans le dépôt ni dans l'appli.

## 6. Jalons proposés

1. **J1** : squelette du dépôt, `common.py` + schéma + tests de normalisation. Scrapers Biocoop et La Fourche (`search`/`get`) avec fixtures. Workflow `search.yml`.
2. **J2** : appli web (liste, Drive, lancement d'une recherche, affichage des résultats, validation des équivalences).
3. **J3** : comparaison complète, paniers par enseigne et totaux, déploiement GitHub Pages.
4. **J4** : Auchan Seynod (à évaluer : réseau/DataDome, éventuellement saisie manuelle).

## 7. Points ouverts

- Choix de la bibliothèque front (JS pur ou Preact) : proposition Preact + htm via CDN, sans build.
- Prix adhérent La Fourche : test de connexion depuis l'appareil de Nicolas à faire avant J1 côté La Fourche.
- Recherche La Fourche : Algolia (autorisé par Nicolas) ; à vérifier que cela fonctionne depuis GitHub Actions.
- Dépôt GitHub : il faut l'attacher à la session (aucun dépôt attaché pour l'instant).
