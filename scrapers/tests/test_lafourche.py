import json
from pathlib import Path

import httpx
import pytest

from scrapers.common import PoliteClient
from scrapers.lafourche import LaFourcheScraper

FX = Path(__file__).parent / "fixtures" / "lafourche"
SEARCH = json.loads((FX / "search_mixed.json").read_text("utf-8"))
PAGE = (FX / "product_coquillettes.html").read_text("utf-8")


def make(handler, **kw):
    client = PoliteClient(cache_dir=None, min_delay=0, transport=httpx.MockTransport(handler))
    return LaFourcheScraper(client, **kw), client


def algolia_handler(request):
    assert request.url.host == "spm5j6sztm-dsn.algolia.net"
    assert request.headers["x-algolia-application-id"] == "SPM5J6SZTM"
    return httpx.Response(200, json=SEARCH)


def test_search_public_price_by_default():
    sc, _ = make(algolia_handler)
    products = {p.id: p for p in sc.search("flocons", limit=20)}
    # Panier duo : prix public = compare_at_price
    panier = products["4-PAN-122"]
    assert panier.price == 8.49 and panier.member_price is False
    assert panier.unit_price_basis == "kg" and panier.unit_price_source == "computed"
    assert panier.store == "lafourche" and panier.url.startswith("https://lafourche.fr/products/")


def test_search_member_price():
    sc, _ = make(algolia_handler, member=True)
    panier = {p.id: p for p in sc.search("flocons", limit=20)}["4-PAN-122"]
    assert panier.price == 3.82 and panier.member_price is True
    assert panier.unit_price == pytest.approx(3.82 / 2.1, abs=1e-3)


def test_liquid_and_unit_packs():
    sc, _ = make(algolia_handler, member=True)
    products = sc.search("x", limit=20)
    oil = next(p for p in products if p.id == "6-BRO-101")
    assert (oil.pack_qty, oil.pack_unit, oil.unit_price_basis) == (1.0, "l", "l")
    assert oil.unit_price == pytest.approx(9.97)
    eggs = next(p for p in products if p.id == "10-VLS-105")
    assert (eggs.pack_qty, eggs.pack_unit, eggs.unit_price_basis) == (10.0, "unit", "unit")
    assert eggs.unit_price == pytest.approx(0.52)
    assert all(p.in_stock is True for p in products)


def test_limit_and_no_hit():
    sc, _ = make(algolia_handler)
    assert len(sc.search("x", limit=2)) == 2
    sc, _ = make(lambda r: httpx.Response(200, json={"hits": []}))
    assert sc.search("zzz") == []


def test_get_by_handle_has_ean():
    def handler(request):
        assert request.url.path == "/products/la-fourche-de-coquillettes-semi-completes-bio-en-sachet-kraft-1kg"
        return httpx.Response(200, text=PAGE)

    sc, _ = make(handler)
    p = sc.get("la-fourche-de-coquillettes-semi-completes-bio-en-sachet-kraft-1kg")
    assert p.id == "4-LAF-298" and p.ean == "3760324848227"
    assert p.price == 2.4 and p.member_price is False  # prix non adhérent
    assert p.unit_price == pytest.approx(2.4) and p.unit_price_basis == "kg"
    assert p.needs_check is False
    sc, _ = make(handler, member=True)
    p = sc.get("la-fourche-de-coquillettes-semi-completes-bio-en-sachet-kraft-1kg")
    assert p.price == 2.11 and p.member_price is True and p.unit_price == pytest.approx(2.11)


def test_get_by_sku_goes_through_algolia_then_page():
    hit = {"handle": "la-fourche-de-coquillettes-semi-completes-bio-en-sachet-kraft-1kg"}

    def handler(request):
        if request.url.host.endswith("algolia.net"):
            assert request.method == "GET" and request.url.path.endswith("/4-LAF-298")
            return httpx.Response(200, json=hit)
        return httpx.Response(200, text=PAGE)

    sc, _ = make(handler)
    assert sc.get("4-LAF-298").ean == "3760324848227"


def test_get_unknown_returns_none():
    sc, _ = make(lambda r: httpx.Response(404, text="nope"))
    assert sc.get("9-ZZZ-999") is None
    assert sc.get("un-handle-inconnu") is None


def test_algolia_key_refresh_on_403():
    home = {"props": {}, "runtimeConfig": {"algoliaConfig": {"app": {"id": "NEWAPP", "key": "newkey"}}}}
    calls = []

    def handler(request):
        calls.append(str(request.url))
        if request.url.host == "lafourche.fr":
            return httpx.Response(200, text='<script id="__NEXT_DATA__" type="application/json">%s</script>' % json.dumps(home))
        if request.headers["x-algolia-api-key"] == "newkey":
            return httpx.Response(200, json=SEARCH)
        return httpx.Response(403, text="forbidden")

    sc, _ = make(handler)
    assert len(sc.search("x", limit=3)) == 3
    assert any("newapp-dsn" in c for c in calls)


def test_page_without_next_data_raises():
    sc, _ = make(lambda r: httpx.Response(200, text="<html></html>"))
    with pytest.raises(ValueError):
        sc.get("un-handle")
