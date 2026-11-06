from pathlib import Path

import httpx
import pytest

from scrapers.biocoop import BiocoopScraper, parse_product_page, parse_search
from scrapers.common import PoliteClient

FIX = Path(__file__).parent / "fixtures"


def fx(name: str) -> str:
    return (FIX / f"biocoop_{name}.html").read_text("utf-8")


@pytest.fixture
def flocons():
    return {p.id: p for p in parse_search(fx("search_flocons_avoine"))}


def test_search_parses_only_products(flocons):
    assert len(flocons) == 10  # les 5 blocs éditoriaux (sans data-id) sont ignorés


def test_standard_product(flocons):
    p = flocons["GE8336_000"]
    assert (p.name, p.brand) == ("Flocons d'avoine germée 350g", "Germline")
    assert (p.price, p.pack_qty, p.pack_unit) == (2.85, 350, "g")
    assert (p.unit_price_basis, p.unit_price_source) == ("kg", "computed")
    assert p.unit_price == pytest.approx(8.14, abs=0.01)
    assert p.ean == "3465511320356"
    assert p.in_stock is True and not p.needs_check
    assert p.url == "https://www.biocoop.fr/flocons-d-avoine-germee-350g-ge8336-000.html"
    assert p.category.startswith("Epicerie") or "/" in p.category
    assert p.store == "biocoop" and p.store_ref == "Biocoop Seynod"


def test_vrac_is_normalised_per_kg(flocons):
    p = flocons["AV2201_000"]
    assert (p.price, p.pack_qty, p.pack_unit) == (0.285, 100, "g")  # prix non arrondi au 100 g
    assert p.unit_price == 2.85 and p.unit_price_basis == "kg"
    assert not p.needs_check


def test_out_of_stock(flocons):
    assert flocons["LG1717_000"].in_stock is False
    assert flocons["LG1717_000"].price == 2.5


def test_liquid_in_litres():
    p = {p.id: p for p in parse_search(fx("search_lait_avoine"))}["AB5041_000"]
    assert (p.pack_qty, p.pack_unit, p.unit_price, p.unit_price_basis) == (1, "l", 2.35, "l")


def test_empty_results():
    assert parse_search(fx("search_vide")) == []


def test_promo_markup_is_supported():
    html = fx("search_flocons_avoine").replace(
        'data-price-amount="2.85" data-price-type="finalPrice"',
        'data-price-amount="2.28" data-price-type="finalPrice"',
        1,
    ).replace(
        '<div class="volume product-item-volume">',
        '<span data-price-amount="2.85" data-price-type="oldPrice"></span><div class="volume product-item-volume">',
        1,
    )
    p = {p.id: p for p in parse_search(html)}["GE8336_000"]
    assert (p.price, p.promo_price) == (2.85, 2.28)
    assert p.unit_price == pytest.approx(2.28 / 0.35, abs=0.01)  # calculé sur le prix payé


def test_product_page():
    p = parse_product_page(fx("produit_ge8336"), "https://x/y.html")
    assert (p.id, p.price, p.pack_qty, p.pack_unit, p.brand) == ("GE8336_000", 2.85, 350, "g", "Germline")
    assert p.ean == "3465511320356" and p.in_stock is True and not p.needs_check


def test_product_page_without_price_box_is_none():
    assert parse_product_page(fx("produit_national_ge8336"), "u") is None


def make_scraper(handler):
    client = PoliteClient(cache_dir=None, min_delay=0, transport=httpx.MockTransport(handler))
    return BiocoopScraper(client)


def test_search_hits_store_url_and_applies_limit():
    seen = []

    def handler(req):
        seen.append(req.url)
        return httpx.Response(200, text=fx("search_flocons_avoine"))

    res = make_scraper(handler).search("flocons avoine", limit=3)
    assert len(res) == 3
    assert str(seen[0]) == "https://www.biocoop.fr/magasin-biocoop_du_semnoz/catalogsearch/result/?q=flocons+avoine"


def test_get_follows_sku_redirect_then_reads_store_page():
    seen = []

    def handler(req):
        seen.append(str(req.url))
        if "catalogsearch" in req.url.path:
            return httpx.Response(200, text=fx("produit_national_ge8336"))  # après redirection
        return httpx.Response(200, text=fx("produit_ge8336"))

    p = make_scraper(handler).get("GE8336_000")
    assert p.price == 2.85 and p.id == "GE8336_000"
    assert seen[1] == "https://www.biocoop.fr/magasin-biocoop_du_semnoz/flocons-d-avoine-germee-350g-ge8336-000.html"


def test_get_unknown_sku_returns_none():
    assert make_scraper(lambda r: httpx.Response(200, text=fx("search_vide"))).get("NOPE_000") is None


def test_get_prefers_exact_match_in_list():
    assert make_scraper(lambda r: httpx.Response(200, text=fx("search_flocons_avoine"))).get("LG2050_000").id == "LG2050_000"
