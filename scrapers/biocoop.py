"""Scraper Biocoop du Semnoz (Seynod) : recherche HTML du site Magento, sans connexion.

Le magasin est choisi par l'URL (`/magasin-biocoop_du_semnoz/`) : les prix lus sont ceux du magasin
(les pages produit hors de ce préfixe affichent un prix national différent ou « Afficher le prix »).

- `search` : `/catalogsearch/result/?q=...`, un `<li>` par produit (attributs `data-*` du lien + bloc prix).
- `get` : la recherche par SKU redirige vers la page produit nationale ; on en tire le slug, puis on lit
  la page produit *du magasin* (même slug sous le préfixe du magasin).
- Vrac : le prix est donné pour 100 g ; on le traite comme un conditionnement de 100 g (=> €/kg).

Le robots.txt de Biocoop demande 30 s entre requêtes : `run.py` l'impose via `HOST_DELAYS`.
"""
from __future__ import annotations

import html as htmllib
import re
from urllib.parse import quote_plus

from selectolax.lexbor import LexborHTMLParser as HTMLParser, LexborNode as Node

from .common import PoliteClient, Product, make_product, parse_quantity

BASE_URL = "https://www.biocoop.fr"
STORE_PATH = "/magasin-biocoop_du_semnoz"
STORE = "biocoop"
STORE_REF = "Biocoop Seynod"

_UNIT_PRICE_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*€\s*/\s*([A-Za-z]+)")
_EAN_RE = re.compile(r"[-/](\d{13})-")
_SLUG_RE = re.compile(r"^https://www\.biocoop\.fr/([a-z0-9-]+\.html)$")


def _float(s: str | None) -> float | None:
    if s is None:
        return None
    try:
        return float(s.replace(",", ".").strip())
    except ValueError:
        return None


def _text(node: Node | None) -> str:
    return re.sub(r"\s+", " ", node.text()).strip() if node else ""


def _site_unit_price(container: Node) -> tuple[float | None, str | None]:
    """'8,14 €/kg' -> (8.14, 'kg') ; lit le bloc `.weight-price`."""
    node = container.css_first(".weight-price")
    m = _UNIT_PRICE_RE.search(_text(node)) if node else None
    return (_float(m.group(1)), m.group(2).lower()) if m else (None, None)


def _price_boxes(container: Node) -> tuple[float | None, float | None]:
    """(prix affiché, ancien prix barré) lus dans le bloc Magento standard ; None si absents."""
    final = container.css_first('[data-price-type="finalPrice"]')
    old = container.css_first('[data-price-type="oldPrice"]')
    return (
        _float(final.attributes.get("data-price-amount")) if final else None,
        _float(old.attributes.get("data-price-amount")) if old else None,
    )


def _ean_from_image(url: str | None) -> str | None:
    m = _EAN_RE.search(url or "")
    return m.group(1) if m else None


def _apply_promo(price: float | None, old: float | None) -> tuple[float | None, float | None]:
    """Si un ancien prix supérieur existe, il devient `price` et le prix courant `promo_price`."""
    if price is not None and old is not None and old > price:
        return old, price
    return price, None


def parse_search(html: str) -> list[Product]:
    """Produits d'une page de résultats (les blocs éditoriaux `<li>` sans `data-id` sont ignorés)."""
    tree = HTMLParser(html)
    products: list[Product] = []
    for link in tree.css("a.product-item-link[data-id]"):
        li = link.parent
        while li is not None and li.tag != "li":
            li = li.parent
        if li is None:
            continue
        attrs = link.attributes
        sku = attrs["data-id"]
        name = _text(link.css_first(".product.name")) or htmllib.unescape(attrs.get("data-name") or sku)

        paid_final, old = _price_boxes(li)
        vrac = "product-item-vrac" in (li.attributes.get("class") or "") or li.css_first('[class^="vrac_qty_"]') is not None
        if vrac:
            # data-price = prix pour la quantité de référence (100 g), non arrondi (0.285 vs 0,29 affiché)
            qty = parse_quantity(attrs.get("data-variant") or "") or parse_quantity(_text(li.css_first(".weight-middle-part")))
            price = _float(attrs.get("data-price"))
        else:
            vol = li.css_first(".product-item-volume .part-product span:not(.visually-hidden)")
            qty = parse_quantity(_text(vol))
            price = paid_final if paid_final is not None else _float(attrs.get("data-price"))
        price, promo = _apply_promo(price, old if not vrac else None)

        site_price, site_ref = _site_unit_price(li)
        img = li.css_first("img.product-image-photo")
        image = (img.attributes.get("data-lazy-src") or img.attributes.get("src")) if img else None
        unavailable = li.css_first(".stock.unavailable, .not-salable") is not None

        products.append(make_product(
            store=STORE, store_ref=STORE_REF, id=sku, name=name,
            brand=attrs.get("data-brand") or None,
            ean=_ean_from_image(image),
            price=price, promo_price=promo,
            pack_qty=qty[0] if qty else None, pack_unit=qty[1] if qty else None,
            in_stock=not unavailable,
            url=attrs.get("href") or "",
            image=image,
            category=attrs.get("data-category") or None,
            site_unit_price=site_price, site_unit_ref=site_ref,
        ))
    return products


def parse_product_page(html: str, url: str) -> Product | None:
    """Page produit du magasin (`/magasin-biocoop_du_semnoz/<slug>.html`)."""
    tree = HTMLParser(html)
    sku_node = tree.css_first('[itemprop="sku"]')
    name_node = tree.css_first('h1.page-title [itemprop="name"]')
    box = tree.css_first(".product-info-main")
    if not (sku_node and name_node and box):
        return None
    final, old = _price_boxes(box)
    if final is None:
        meta = tree.css_first('meta[property="product:price:amount"]')
        final = _float(meta.attributes.get("content")) if meta else None
    price, promo = _apply_promo(final, old)
    qty = parse_quantity(_text(box.css_first(".part-product span:not(.visually-hidden)")))
    site_price, site_ref = _site_unit_price(box)
    brand = tree.css_first(".brand.value")
    og_image = tree.css_first('meta[property="og:image"]')
    image = og_image.attributes.get("content") if og_image else None
    avail = box.css_first('[itemprop="availability"]')
    in_stock = None
    if avail is not None:
        in_stock = "InStock" in (avail.attributes.get("href") or "")
    return make_product(
        store=STORE, store_ref=STORE_REF, id=_text(sku_node), name=_text(name_node),
        brand=_text(brand) or None, ean=_ean_from_image(image),
        price=price, promo_price=promo,
        pack_qty=qty[0] if qty else None, pack_unit=qty[1] if qty else None,
        in_stock=in_stock, url=url, image=image,
        site_unit_price=site_price, site_unit_ref=site_ref,
    )


class BiocoopScraper:
    store = STORE
    store_ref = STORE_REF

    def __init__(self, client: PoliteClient) -> None:
        self.client = client

    def _search_url(self, query: str) -> str:
        return f"{BASE_URL}{STORE_PATH}/catalogsearch/result/?q={quote_plus(query)}"

    def search(self, query: str, limit: int = 10) -> list[Product]:
        return parse_search(self.client.get(self._search_url(query)))[:limit]

    def get(self, product_id: str) -> Product | None:
        # Une recherche par SKU redirige vers la page produit nationale (httpx suit la redirection) :
        # on n'en garde que le slug, car son prix n'est pas celui du magasin.
        body = self.client.get(self._search_url(product_id))
        for p in parse_search(body):  # SKU non reconnu exactement : la recherche peut renvoyer une liste
            if p.id == product_id:
                return p
        og = HTMLParser(body).css_first('meta[property="og:url"]')
        m = _SLUG_RE.match(og.attributes.get("content", "") if og else "")
        if not m:
            return None
        url = f"{BASE_URL}{STORE_PATH}/{m.group(1)}"
        product = parse_product_page(self.client.get(url), url)
        return product if product and product.id == product_id else None
