"""CLI : python -m scrapers.run --stores biocoop,lafourche --queries queries.json --out data/results/<run_id>.json

Fichier de requêtes : liste de chaînes ou d'objets {"query": "...", "stores": ["biocoop"]}
(`stores` restreint les enseignes interrogées pour cette requête). Ou {"queries": [...]}.
Une enseigne en erreur est signalée dans `errors` et n'empêche pas les autres.
"""
from __future__ import annotations

import argparse
import importlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .common import PoliteClient, Scraper

# enseigne -> "module:Classe" (import tardif : un module cassé n'empêche pas les autres)
REGISTRY: dict[str, str] = {
    "biocoop": "scrapers.biocoop:BiocoopScraper",
    "lafourche": "scrapers.lafourche:LaFourcheScraper",
    "auchan": "scrapers.auchan:AuchanScraper",
}

# Pauses imposées par hôte (robots.txt de Biocoop : 30 s)
HOST_DELAYS = {"www.biocoop.fr": 30.0}

ScraperFactory = Callable[[str, PoliteClient], Scraper]


def default_factory(store: str, client: PoliteClient) -> Scraper:
    module, cls = REGISTRY[store].split(":")
    return getattr(importlib.import_module(module), cls)(client)


def load_queries(path: str | Path) -> list[tuple[str, list[str] | None]]:
    data = json.loads(Path(path).read_text("utf-8"))
    if isinstance(data, dict):
        data = data.get("queries", [])
    out: list[tuple[str, list[str] | None]] = []
    for item in data:
        if isinstance(item, str):
            out.append((item, None))
        else:
            out.append((item["query"], item.get("stores")))
    return out


def run(
    stores: list[str],
    queries: list[tuple[str, list[str] | None]],
    limit: int = 10,
    client: PoliteClient | None = None,
    factory: ScraperFactory = default_factory,
    run_id: str | None = None,
) -> dict[str, Any]:
    run_id = run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    own_client = client is None
    client = client or PoliteClient(host_delays=HOST_DELAYS)
    result: dict[str, Any] = {
        "run_id": run_id,
        "queries": {q: {s: [] for s in (only or stores) if s in stores} for q, only in queries},
        "errors": {s: None for s in stores},
    }
    try:
        for store in stores:
            try:
                scraper = factory(store, client)
                for q, only in queries:
                    if only is not None and store not in only:
                        continue
                    products = scraper.search(q, limit)
                    result["queries"][q][store] = [p.to_dict() for p in products]
            except Exception as exc:  # isolation : on note l'erreur et on passe à l'enseigne suivante
                result["errors"][store] = f"{type(exc).__name__}: {exc}"
    finally:
        if own_client:
            client.close()
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="scrapers.run")
    ap.add_argument("--stores", default=",".join(REGISTRY), help="liste séparée par des virgules")
    ap.add_argument("--queries", required=True, help="fichier JSON de requêtes")
    ap.add_argument("--out", help="fichier de sortie (défaut : data/results/<run_id>.json)")
    ap.add_argument("--limit", type=int, default=10)
    ap.add_argument("--run-id", help="identifiant du run (défaut : horodatage UTC) ; [A-Za-z0-9_-] uniquement")
    args = ap.parse_args(argv)

    stores = [s.strip() for s in args.stores.split(",") if s.strip()]
    unknown = [s for s in stores if s not in REGISTRY]
    if unknown:
        ap.error(f"enseigne(s) inconnue(s) : {', '.join(unknown)} (connues : {', '.join(REGISTRY)})")

    if args.run_id and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", args.run_id):
        ap.error("--run-id invalide (caractères autorisés : lettres, chiffres, _ et -)")

    result = run(stores, load_queries(args.queries), limit=args.limit, run_id=args.run_id)
    out = Path(args.out or f"data/results/{result['run_id']}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")
    print(f"écrit {out}", file=sys.stderr)
    for store, err in result["errors"].items():
        if err:
            print(f"[{store}] erreur : {err}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
