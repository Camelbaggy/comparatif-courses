import json

import httpx
import pytest

from scrapers.common import (
    PoliteClient, compute_unit_price, make_product, normalize_unit,
    parse_quantity, per_100g_to_per_kg, site_unit_price_to_base,
)

BASE = dict(store="biocoop", store_ref="Biocoop Seynod", id="X1", name="Test", url="https://x")


def test_normalize_unit_aliases():
    assert normalize_unit("Kg") == "kg"
    assert normalize_unit("litre") == "l"
    assert normalize_unit("pièce") == "unit"
    with pytest.raises(ValueError):
        normalize_unit("yard")


@pytest.mark.parametrize("text,expected", [
    ("350 g", (350, "g")),
    ("1,5 L", (1.5, "l")),
    ("Lait 6 x 33 cl", (198, "cl")),
    ("Flocons 500g bio", (500, "g")),
    ("sans quantité", None),
])
def test_parse_quantity(text, expected):
    assert parse_quantity(text) == expected


def test_compute_unit_price():
    assert compute_unit_price(2.85, 350, "g") == (8.1429, "kg")
    assert compute_unit_price(1.20, 75, "cl") == (1.6, "l")
    assert compute_unit_price(3.0, 6, "unit") == (0.5, "unit")
    assert compute_unit_price(2.0, None, "g") is None
    assert compute_unit_price(None, 100, "g") is None


def test_vrac_per_100g():
    assert per_100g_to_per_kg(0.85) == 8.5
    assert site_unit_price_to_base(0.85, "100g") == (8.5, "kg")
    assert site_unit_price_to_base(2.4, "kg") == (2.4, "kg")
    assert site_unit_price_to_base(1.2, "100 ml") == (12.0, "l")


def test_make_product_computed_and_consistent():
    p = make_product(**BASE, price=2.85, pack_qty=350, pack_unit="g", site_unit_price=8.14, site_unit_ref="kg")
    assert (p.unit_price, p.unit_price_basis, p.unit_price_source) == (8.1429, "kg", "computed")
    assert not p.needs_check


def test_make_product_promo_used_for_unit_price():
    p = make_product(**BASE, price=3.0, promo_price=2.0, pack_qty=1, pack_unit="kg")
    assert p.unit_price == 2.0


def test_make_product_site_mismatch_flagged():
    p = make_product(**BASE, price=2.85, pack_qty=350, pack_unit="g", site_unit_price=12.0, site_unit_ref="kg")
    assert p.needs_check and "site" in p.check_reason
    assert p.unit_price == 8.1429  # notre calcul fait foi


def test_make_product_vrac_biocoop_fallback_to_site_100g():
    p = make_product(**BASE, price=None, site_unit_price=0.85, site_unit_ref="100g")
    assert (p.unit_price, p.unit_price_basis, p.unit_price_source) == (8.5, "kg", "site")
    assert not p.needs_check


def test_make_product_unknown_pack_needs_check():
    p = make_product(**BASE, price=2.0)
    assert p.unit_price is None and p.needs_check


def test_product_to_dict_has_contract_keys():
    d = make_product(**BASE, price=1.0, pack_qty=1, pack_unit="kg").to_dict()
    for k in ["store", "store_ref", "id", "ean", "name", "brand", "pack_qty", "pack_unit", "price",
              "promo_price", "unit_price", "unit_price_basis", "unit_price_source", "in_stock",
              "url", "image", "category", "member_price", "fetched_at"]:
        assert k in d
    json.dumps(d)


def _client(tmp_path, handler, **kw):
    sleeps = []
    c = PoliteClient(cache_dir=tmp_path, transport=httpx.MockTransport(handler),
                     sleep=sleeps.append, clock=lambda: 100.0, **kw)
    return c, sleeps


def test_client_cache_avoids_second_network_call(tmp_path):
    c, _ = _client(tmp_path, lambda r: httpx.Response(200, json={"ok": 1}))
    assert c.get_json("https://example.org/a") == {"ok": 1}
    assert c.get_json("https://example.org/a") == {"ok": 1}
    assert c.network_calls == 1


def test_client_sets_user_agent_and_waits(tmp_path):
    seen = []

    def handler(req):
        seen.append(req.headers["user-agent"])
        return httpx.Response(200, text="ok")

    c, sleeps = _client(tmp_path, handler, host_delays={"example.org": 30})
    c.get("https://example.org/1")
    assert sleeps == []  # première requête : pas d'attente
    c.get("https://example.org/2")
    assert sleeps == [30]
    assert "comparatif-courses" in seen[0]


def test_client_raises_on_http_error(tmp_path):
    c, _ = _client(tmp_path, lambda r: httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        c.get("https://example.org/x")
