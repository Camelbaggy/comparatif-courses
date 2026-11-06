import json

import pytest

from scrapers import run as runmod
from scrapers.common import make_product


class Good:
    store = "good"

    def __init__(self, client): pass

    def search(self, query, limit=10):
        return [make_product(store="good", store_ref="Good", id="1", name=query, price=1.0,
                             pack_qty=500, pack_unit="g", url="https://x")]

    def get(self, product_id): return None


class Bad(Good):
    def search(self, query, limit=10):
        raise RuntimeError("boom")


def factory(store, client):
    return {"good": Good, "bad": Bad}[store](client)


class FakeClient:
    def close(self): pass


def test_error_isolation_and_output_format():
    res = runmod.run(["bad", "good"], [("flocons", None)], client=FakeClient(), factory=factory, run_id="r1")
    assert res["run_id"] == "r1"
    assert res["errors"]["bad"] == "RuntimeError: boom"
    assert res["errors"]["good"] is None
    assert res["queries"]["flocons"]["bad"] == []
    assert res["queries"]["flocons"]["good"][0]["unit_price"] == 2.0
    json.dumps(res)


def test_per_query_store_restriction():
    res = runmod.run(["good", "bad"], [("a", ["good"]), ("b", None)], client=FakeClient(), factory=factory)
    assert set(res["queries"]["a"]) == {"good"}
    assert set(res["queries"]["b"]) == {"good", "bad"}


def test_stub_scrapers_report_error_without_crashing():
    res = runmod.run(["auchan"], [("x", None)], client=FakeClient())
    assert "NotImplementedError" in res["errors"]["auchan"]


def test_load_queries_formats(tmp_path):
    p = tmp_path / "q.json"
    p.write_text(json.dumps(["a", {"query": "b", "stores": ["biocoop"]}]))
    assert runmod.load_queries(p) == [("a", None), ("b", ["biocoop"])]
    p.write_text(json.dumps({"queries": ["c"]}))
    assert runmod.load_queries(p) == [("c", None)]


def test_cli_writes_file_and_rejects_unknown_store(tmp_path, monkeypatch):
    q = tmp_path / "q.json"
    q.write_text('["a"]')
    out = tmp_path / "out" / "r.json"
    monkeypatch.setattr(runmod, "default_factory", factory)
    # factory par défaut du run() lié à la définition : on patche run pour injecter la nôtre
    orig = runmod.run
    monkeypatch.setattr(runmod, "run", lambda *a, **k: orig(*a, **{**k, "client": FakeClient(), "factory": factory}))
    monkeypatch.setitem(runmod.REGISTRY, "good", "x:y")
    assert runmod.main(["--stores", "good", "--queries", str(q), "--out", str(out)]) == 0
    assert json.loads(out.read_text())["queries"]["a"]["good"]
    with pytest.raises(SystemExit):
        runmod.main(["--stores", "nope", "--queries", str(q)])
