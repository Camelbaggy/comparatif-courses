import pytest

from scrapers import run as runmod
from scrapers.auchan import AuchanScraper, AuchanUnavailable, search_url


def test_search_url_encodes_query():
    assert search_url("flocons d'avoine") == "https://www.auchan.fr/recherche?text=flocons+d%27avoine"


def test_search_raises_clear_error_with_link():
    with pytest.raises(AuchanUnavailable, match=r"recherche\?text=lait\+avoine"):
        AuchanScraper(client=None).search("lait avoine")


def test_run_isolates_auchan_failure(tmp_path):
    class Fake:
        network_calls = 0
        def close(self): pass

    res = runmod.run(["auchan"], [("lait", None)], client=Fake())
    assert res["queries"]["lait"]["auchan"] == []
    assert res["errors"]["auchan"].startswith("AuchanUnavailable:")
    assert "saisie manuelle" in res["errors"]["auchan"]
