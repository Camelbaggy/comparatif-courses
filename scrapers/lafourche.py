"""Scraper La Fourche : à implémenter (stub). Voir scrapers/common.py (Scraper, make_product, PoliteClient)."""
from __future__ import annotations

from .common import PoliteClient, Product


class LaFourcheScraper:
    store = "lafourche"
    store_ref = "La Fourche"

    def __init__(self, client: PoliteClient) -> None:
        self.client = client

    def search(self, query: str, limit: int = 10) -> list[Product]:
        raise NotImplementedError("scraper lafourche pas encore implémenté")

    def get(self, product_id: str) -> Product | None:
        raise NotImplementedError("scraper lafourche pas encore implémenté")
