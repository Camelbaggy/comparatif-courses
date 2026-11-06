"""Auchan Seynod : accès automatique volontairement NON implémenté (repli propre).

Constat (voir etude/rapport-faisabilite-catalogues.md, vérifié à nouveau le 2026-11-06) :
- la recherche `/recherche?text=...` répond 200 mais sans aucun prix (« Afficher le prix ») : le prix
  dépend du drive choisi, mémorisé en session (cookies) ;
- le site est protégé par DataDome (anti-bot) ;
- le robots.txt interdit `/recherche*` et les paramètres `storeReference` / `keywords`.

Obtenir les prix exigerait de simuler un navigateur avec session de drive en contournant ces protections,
ce que nous ne faisons pas. Le scraper échoue donc avec un message clair (repris dans `errors.auchan`
de la sortie de `run.py`, sans gêner les autres enseignes) qui donne le lien de recherche à ouvrir à la
main : l'appli peut proposer la saisie manuelle du prix. `search_url` sert à construire ce lien.
"""
from __future__ import annotations

from urllib.parse import quote_plus

from .common import PoliteClient, Product

SEARCH_URL = "https://www.auchan.fr/recherche?text={q}"


class AuchanUnavailable(RuntimeError):
    """Prix Auchan non récupérables automatiquement."""


def search_url(query: str) -> str:
    """Lien de recherche Auchan à ouvrir dans le navigateur (choisir le drive Seynod, lire le prix)."""
    return SEARCH_URL.format(q=quote_plus(query))


class AuchanScraper:
    store = "auchan"
    store_ref = "Auchan Seynod"

    def __init__(self, client: PoliteClient) -> None:
        self.client = client

    def search(self, query: str, limit: int = 10) -> list[Product]:
        raise AuchanUnavailable(
            "prix Auchan non récupérables automatiquement (prix masqués sans drive choisi, "
            "anti-bot DataDome, robots.txt interdit /recherche) ; "
            f"saisie manuelle : {search_url(query)}"
        )

    def get(self, product_id: str) -> Product | None:
        raise AuchanUnavailable(
            f"prix Auchan non récupérables automatiquement (produit {product_id}) ; saisie manuelle"
        )
