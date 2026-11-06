"""Scraper Auchan Seynod : à implémenter (stub). Voir scrapers/common.py (Scraper, make_product, PoliteClient)."""
from __future__ import annotations

from .common import PoliteClient, Product


class AuchanScraper:
    store = "auchan"
    store_ref = "Auchan Seynod"

    def __init__(self, client: PoliteClient) -> None:
        self.client = client

    def search(self, query: str, limit: int = 10) -> list[Product]:
        raise NotImplementedError("scraper auchan pas encore implémenté")

    def get(self, product_id: str) -> Product | None:
        raise NotImplementedError("scraper auchan pas encore implémenté")
