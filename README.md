# Comparatif courses

Comparateur de courses (La Fourche / Biocoop du Semnoz / Auchan Seynod) sur le prix au kg ou au litre.
Architecture et schémas : [docs/contrat-technique.md](docs/contrat-technique.md).

## Scrapers (Python 3.12+)

```bash
pip install -r requirements-dev.txt
pytest                                   # tests, sans réseau
python -m scrapers.run --stores biocoop,lafourche --queries queries.example.json
```

Sortie : `data/results/<run_id>.json` (voir le contrat, section 3). Une enseigne en panne est
signalée dans `errors` sans bloquer les autres.

### Ajouter / implémenter une enseigne

1. Implémenter la classe dans `scrapers/<enseigne>.py` selon le Protocol `Scraper` (`scrapers/common.py`).
2. Construire les `Product` avec `make_product(...)` : il normalise `unit_price` (€/kg, €/L, €/unité).
3. Utiliser `PoliteClient` pour tout accès réseau (pause, cache, User-Agent).
4. Tests sur fixtures dans `scrapers/tests/fixtures/`, jamais de réseau.

## Workflow GitHub

`Actions > Recherche prix > Run workflow` : entrées `queries` (JSON), `stores` et `run_id` (optionnel). Les résultats sont
publiés sur la branche `gh-pages`, à côté du site : `data/results/<run_id>.json` et `data/results/latest.json`.
