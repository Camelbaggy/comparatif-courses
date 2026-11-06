"""Scraper La Fourche.

- `search` : moteur Algolia du site (clé de recherche publique, lecture seule, autorisée par Nicolas).
  Index `production_products_default:fr_FR`. Si la clé change (401/403), on la relit dans la
  configuration publique de la page d'accueil (`__NEXT_DATA__` > runtimeConfig > algoliaConfig).
- `get` : JSON `__NEXT_DATA__` de la page produit (apporte en plus l'EAN, absent de la recherche).

Prix : le site affiche deux prix, le prix adhérent (`price`) et le prix non adhérent barré
(`compare_at_price`, libellé « Prix non adhérent » sur la page). Par défaut (`member=False`) on
retourne le prix public non adhérent, `member_price=False`. Avec `member=True` (ou
LAFOURCHE_MEMBER=1) on retourne le prix adhérent, `member_price=True`. Si le site ne donne qu'un
seul prix (pas de `compare_at_price`), c'est ce prix qui est utilisé, `member_price=False`.
Aucun identifiant n'est nécessaire.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any

from .common import PoliteClient, Product, make_product, parse_quantity

BASE_URL = "https://lafourche.fr"
ALGOLIA_APP_ID = "SPM5J6SZTM"
# Clé de recherche publique (embarquée dans toutes les pages du site), surchargeable par l'environnement.
ALGOLIA_SEARCH_KEY = "ca66381c136c56785ec5fb8e95a70ad7"
ALGOLIA_INDEX = "production_products_default:fr_FR"

_NEXT_DATA_RE = re.compile(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', re.S)
_SKU_RE = re.compile(r"^\d+-[A-Za-z0-9]+-[A-Za-z0-9]+$")


def parse_next_data(html: str) -> dict[str, Any]:
    m = _NEXT_DATA_RE.search(html)
    if not m:
        raise ValueError("bloc __NEXT_DATA__ introuvable (structure du site modifiée ?)")
    return json.loads(m.group(1))


class LaFourcheScraper:
    store = "lafourche"
    store_ref = "La Fourche"

    def __init__(self, client: PoliteClient, member: bool | None = None) -> None:
        self.client = client
        if member is None:
            member = os.environ.get("LAFOURCHE_MEMBER", "").strip().lower() in {"1", "true", "oui", "yes"}
        self.member = member
        self.app_id = os.environ.get("LAFOURCHE_ALGOLIA_APP_ID", ALGOLIA_APP_ID)
        self.api_key = os.environ.get("LAFOURCHE_ALGOLIA_KEY", ALGOLIA_SEARCH_KEY)

    # ------------------------------------------------------------------ Algolia

    def _algolia_headers(self) -> dict[str, str]:
        return {"X-Algolia-Application-Id": self.app_id, "X-Algolia-API-Key": self.api_key}

    def _refresh_algolia_key(self) -> None:
        """Relit la clé publique dans la page d'accueil (utilisé seulement si l'ancienne est refusée)."""
        cfg = parse_next_data(self.client.get(BASE_URL + "/", use_cache=False))["runtimeConfig"]["algoliaConfig"]["app"]
        self.app_id, self.api_key = cfg["id"], cfg["key"]

    def _algolia(self, method: str, path: str, body: Any = None) -> Any:
        import httpx

        for attempt in (0, 1):
            url = f"https://{self.app_id}-dsn.algolia.net{path}"
            try:
                text = self.client.request(method, url, json_body=body, headers=self._algolia_headers())
                return json.loads(text)
            except httpx.HTTPStatusError as exc:
                if attempt == 0 and exc.response.status_code in (401, 403):
                    self._refresh_algolia_key()
                    continue
                raise

    # ------------------------------------------------------------------ conversion

    def _to_product(self, item: dict[str, Any]) -> Product:
        finance = (item.get("meta") or {}).get("finance") or {}
        member_price = item.get("price")
        public_price = item.get("compare_at_price")
        if public_price is not None and member_price is not None and public_price < member_price:
            public_price = None  # prix « barré » incohérent : on ne s'en sert pas
        if self.member or public_price is None:
            price, is_member = member_price, self.member and public_price is not None
        else:
            price, is_member = public_price, False

        # Conditionnement : unité et quantité de la fiche finance (« 1 L », « 10 unité », « 0.5 kg »)
        pack_qty: float | None = None
        pack_unit = finance.get("unit_of_measurement")
        try:
            pack_qty = float(finance.get("product_format"))
        except (TypeError, ValueError):
            pack_qty = None
        if pack_qty is None or not pack_unit:
            # repli : poids d'expédition (fiable pour les produits solides seulement)
            parsed = parse_quantity(item.get("weight") or "")
            pack_qty, pack_unit = (parsed if parsed else (None, None))

        breadcrumb = [b.get("title") for b in item.get("breadcrumb") or [] if b.get("title")]
        category = " / ".join(breadcrumb[1:]) or None

        # prix unitaire du site : il correspond au prix adhérent, donc pas de contrôle si on affiche l'autre prix
        site_unit = finance.get("unit_price") if (is_member or price == member_price) else None
        unit_ref = finance.get("unit_of_measurement") if site_unit is not None else None

        handle = item.get("handle") or ""
        return make_product(
            store=self.store,
            store_ref=self.store_ref,
            id=str(item.get("sku") or item.get("objectID")),
            ean=(item.get("barcode") or None),
            name=item.get("title") or "",
            brand=item.get("vendor") or None,
            pack_qty=pack_qty,
            pack_unit=pack_unit,
            price=price,
            in_stock=item.get("inventory_available"),
            url=f"{BASE_URL}/products/{handle}",
            image=item.get("image") or item.get("product_image"),
            category=category,
            member_price=is_member,
            site_unit_price=site_unit,
            site_unit_ref=unit_ref,
        )

    # ------------------------------------------------------------------ interface Scraper

    def search(self, query: str, limit: int = 10) -> list[Product]:
        data = self._algolia(
            "POST",
            f"/1/indexes/{ALGOLIA_INDEX}/query",
            {"query": query, "hitsPerPage": max(1, limit)},
        )
        return [self._to_product(h) for h in data.get("hits", [])[:limit]]

    def get(self, product_id: str) -> Product | None:
        """`product_id` : SKU La Fourche (ex. 4-LAF-298) ou handle de la page produit."""
        handle = product_id
        if _SKU_RE.match(product_id):
            import httpx

            try:
                hit = self._algolia("GET", f"/1/indexes/{ALGOLIA_INDEX}/{product_id}")
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    return None
                raise
            handle = hit.get("handle") or ""
            if not handle:
                return None
        import httpx

        try:
            html = self.client.get(f"{BASE_URL}/products/{handle}")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            raise
        product = (parse_next_data(html).get("props") or {}).get("pageProps", {}).get("product")
        if not product:
            return None
        product.setdefault("handle", handle)
        return self._to_product(product)
