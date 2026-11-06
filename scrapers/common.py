"""Modèle produit, normalisation d'unités et client HTTP poli (partagés par tous les scrapers)."""
from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol

# --------------------------------------------------------------------------- unités

# unité lue -> (base de prix, facteur vers l'unité de base : kg, l ou unit)
UNIT_TO_BASE: dict[str, tuple[str, float]] = {
    "g": ("kg", 0.001),
    "kg": ("kg", 1.0),
    "ml": ("l", 0.001),
    "cl": ("l", 0.01),
    "l": ("l", 1.0),
    "unit": ("unit", 1.0),
}

_UNIT_ALIASES = {
    "gr": "g", "gramme": "g", "grammes": "g",
    "kilo": "kg", "kilos": "kg", "kilogramme": "kg", "kilogrammes": "kg",
    "litre": "l", "litres": "l", "lt": "l",
    "millilitre": "ml", "millilitres": "ml", "centilitre": "cl", "centilitres": "cl",
    "u": "unit", "unite": "unit", "unité": "unit", "unités": "unit", "unites": "unit",
    "piece": "unit", "pièce": "unit", "pièces": "unit", "pieces": "unit", "pce": "unit",
}

# Écart toléré entre le prix unitaire du site et le nôtre avant de signaler « à vérifier »
UNIT_PRICE_TOLERANCE = 0.05


def normalize_unit(raw: str) -> str:
    """'Kg', 'litre', 'pièce' -> 'kg', 'l', 'unit'. Lève ValueError si inconnue."""
    u = raw.strip().lower().rstrip(".")
    u = _UNIT_ALIASES.get(u, u)
    if u not in UNIT_TO_BASE:
        raise ValueError(f"unité inconnue : {raw!r}")
    return u


_NUM = r"(\d+(?:[.,]\d+)?)"
_QTY_RE = re.compile(rf"{_NUM}\s*([a-zA-Zéèû]+)")
_MULTI_RE = re.compile(rf"(\d+)\s*[x×]\s*{_NUM}\s*([a-zA-Zéèû]+)", re.IGNORECASE)


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def parse_quantity(text: str) -> tuple[float, str] | None:
    """Extrait (quantité, unité) d'un libellé : '350 g', '1,5 L', '6 x 33 cl' -> (198, 'cl').

    Retourne None si rien d'exploitable. Prend le premier motif trouvé.
    """
    if not text:
        return None
    m = _MULTI_RE.search(text)
    if m:
        try:
            return int(m.group(1)) * _num(m.group(2)), normalize_unit(m.group(3))
        except ValueError:
            pass
    for m in _QTY_RE.finditer(text):
        try:
            return _num(m.group(1)), normalize_unit(m.group(2))
        except ValueError:
            continue
    return None


def compute_unit_price(price: float | None, pack_qty: float | None, pack_unit: str | None) -> tuple[float, str] | None:
    """Prix normalisé (€/kg, €/L ou €/unité) calculé depuis le prix du conditionnement."""
    if price is None or not pack_qty or pack_qty <= 0 or not pack_unit:
        return None
    try:
        basis, factor = UNIT_TO_BASE[normalize_unit(pack_unit)]
    except ValueError:
        return None
    return round(price / (pack_qty * factor), 4), basis


def per_100g_to_per_kg(value: float) -> float:
    """Biocoop affiche le vrac au 100 g : € / 100 g -> € / kg."""
    return round(value * 10, 4)


def site_unit_price_to_base(value: float, unit: str) -> tuple[float, str]:
    """Convertit un prix unitaire lu sur le site ('€/100 g', '€/kg', '€/L'...) en (valeur, base).

    `unit` est l'unité de référence du site : 'kg', 'l', '100g', '100 g', '100ml', 'unit'...
    """
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)?\s*([a-zA-Zéèû]+)\s*", unit)
    if not m:
        raise ValueError(f"unité de prix inconnue : {unit!r}")
    ref_qty = _num(m.group(1)) if m.group(1) else 1.0
    basis, factor = UNIT_TO_BASE[normalize_unit(m.group(2))]
    return round(value / (ref_qty * factor), 4), basis


# --------------------------------------------------------------------------- produit


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass
class Product:
    """Schéma produit commun (docs/contrat-technique.md, section 2).

    Extension par rapport au contrat : `needs_check` / `check_reason` signalent un produit
    « à vérifier » (conditionnement inconnu ou prix unitaire du site incohérent).
    """

    store: str
    store_ref: str
    id: str
    name: str
    price: float | None
    url: str
    ean: str | None = None
    brand: str | None = None
    pack_qty: float | None = None
    pack_unit: str | None = None
    promo_price: float | None = None
    unit_price: float | None = None
    unit_price_basis: str | None = None
    unit_price_source: str | None = None
    in_stock: bool | None = None
    image: str | None = None
    category: str | None = None
    member_price: bool = False
    fetched_at: str = field(default_factory=utc_now_iso)
    needs_check: bool = False
    check_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def make_product(
    *,
    site_unit_price: float | None = None,
    site_unit_ref: str | None = None,
    **fields: Any,
) -> Product:
    """Construit un Product en remplissant `unit_price` selon les règles du contrat.

    - `unit_price` est recalculé depuis le prix payé (promo si présente) et `pack_qty` quand c'est possible ;
    - sinon on retombe sur la valeur du site (`site_unit_price` + `site_unit_ref`, ex. '100g' pour le vrac Biocoop) ;
    - la valeur du site sert de contrôle : écart > 5 % => `needs_check`.
    """
    p = Product(**fields)
    if p.pack_unit:
        try:
            p.pack_unit = normalize_unit(p.pack_unit)
        except ValueError:
            p.pack_unit = None
    paid = p.promo_price if p.promo_price is not None else p.price

    site: tuple[float, str] | None = None
    if site_unit_price is not None and site_unit_ref:
        try:
            site = site_unit_price_to_base(site_unit_price, site_unit_ref)
        except ValueError:
            site = None

    computed = compute_unit_price(paid, p.pack_qty, p.pack_unit)
    if computed:
        p.unit_price, p.unit_price_basis = computed
        p.unit_price_source = "computed"
        if site and site[1] == computed[1] and computed[0] > 0:
            if abs(site[0] - computed[0]) / computed[0] > UNIT_PRICE_TOLERANCE:
                p.needs_check = True
                p.check_reason = f"prix unitaire du site ({site[0]}) != calculé ({computed[0]})"
    elif site:
        p.unit_price, p.unit_price_basis = site
        p.unit_price_source = "site"
    else:
        p.needs_check = True
        p.check_reason = "conditionnement inconnu"
    return p


# --------------------------------------------------------------------------- interface scraper


class Scraper(Protocol):
    store: str

    def search(self, query: str, limit: int = 10) -> list[Product]: ...

    def get(self, product_id: str) -> Product | None: ...


# --------------------------------------------------------------------------- client HTTP poli

DEFAULT_USER_AGENT = (
    "comparatif-courses/0.1 (comparateur personnel, 2 personnes; "
    "+https://github.com/Camelbaggy/comparatif-courses)"
)


class PoliteClient:
    """Client HTTP séquentiel : User-Agent identifiable, pause entre requêtes, cache disque.

    - `min_delay` : secondes minimum entre deux requêtes réseau (défaut 2 s) ;
      `host_delays` permet d'imposer plus par hôte (ex. {"www.biocoop.fr": 30}).
    - Le cache (clé = méthode + URL + corps) évite de retaper le réseau ; `cache_ttl` en secondes.
    - `transport` permet d'injecter un httpx.MockTransport en test.
    """

    def __init__(
        self,
        cache_dir: str | Path | None = ".cache/http",
        min_delay: float = 2.0,
        host_delays: dict[str, float] | None = None,
        cache_ttl: float = 24 * 3600,
        user_agent: str = DEFAULT_USER_AGENT,
        timeout: float = 20.0,
        transport: Any = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        import httpx  # import tardif : les modules purs restent importables sans httpx

        self._client = httpx.Client(
            headers={"User-Agent": user_agent, "Accept-Language": "fr-FR,fr;q=0.9"},
            timeout=timeout,
            follow_redirects=True,
            transport=transport,
        )
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.min_delay = min_delay
        self.host_delays = host_delays or {}
        self.cache_ttl = cache_ttl
        self._sleep = sleep
        self._clock = clock
        self._last_request: float | None = None
        self._last_host: str | None = None
        self.network_calls = 0

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "PoliteClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- cache
    def _cache_path(self, key: str) -> Path | None:
        if not self.cache_dir:
            return None
        return self.cache_dir / (hashlib.sha256(key.encode()).hexdigest() + ".json")

    def _cache_get(self, key: str) -> str | None:
        path = self._cache_path(key)
        if not path or not path.exists():
            return None
        try:
            entry = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            return None
        if time.time() - entry.get("ts", 0) > self.cache_ttl:
            return None
        return entry.get("body")

    def _cache_put(self, key: str, body: str) -> None:
        path = self._cache_path(key)
        if not path:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"ts": time.time(), "key": key, "body": body}), "utf-8")

    # -- requêtes
    def _wait(self, host: str) -> None:
        if self._last_request is None:
            return
        delay = max(self.min_delay, self.host_delays.get(host, 0.0))
        remaining = delay - (self._clock() - self._last_request)
        if remaining > 0:
            self._sleep(remaining)

    def request(self, method: str, url: str, *, params: dict | None = None,
                json_body: Any = None, headers: dict | None = None, use_cache: bool = True) -> str:
        """Retourne le corps texte de la réponse. Lève httpx.HTTPStatusError si statut >= 400."""
        import httpx

        req = self._client.build_request(method, url, params=params, json=json_body, headers=headers)
        key = f"{method} {req.url} {req.content.decode('utf-8', 'ignore') if req.content else ''}"
        if use_cache:
            cached = self._cache_get(key)
            if cached is not None:
                return cached
        host = req.url.host
        self._wait(host)
        try:
            resp = self._client.send(req)
        finally:
            self._last_request = self._clock()
            self.network_calls += 1
        resp.raise_for_status()
        body = resp.text
        if use_cache:
            self._cache_put(key, body)
        return body

    def get(self, url: str, **kw: Any) -> str:
        return self.request("GET", url, **kw)

    def get_json(self, url: str, **kw: Any) -> Any:
        return json.loads(self.get(url, **kw))

    def post_json(self, url: str, json_body: Any, **kw: Any) -> Any:
        return json.loads(self.request("POST", url, json_body=json_body, **kw))
