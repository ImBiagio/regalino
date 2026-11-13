"""Importare liste di regali da altri siti o da un file (ADR 0015).

Tre strade, tutte verso lo stesso albero di ``ImportList``:

- **Amazon**: la lista desideri pubblica (``/hz/wishlist/ls/<id>``) e' HTML
  scritto dal server, con un ``<li data-itemid>`` per regalo: si legge con un
  parser dedicato, seguendo le pagine successive ("mostra altro").
- **Elfster e le altre pagine**: Elfster costruisce la lista con JavaScript e
  non ci sono dati dichiarati da leggere. La pagina si apre col browser dello
  scraper (o arriva gia' costruita dall'estensione, ADR 0016) e Gemini ne
  estrae i regali da una versione compatta della pagina (testo, link, foto).
  Link e foto devono esistere davvero nella pagina: quello che Gemini inventa
  si scarta. Non si usano API private dei siti: solo quello che vede chi apre
  il link.
- **File CSV o JSON**: un export fatto a mano o da un altro servizio.

"Lista dentro una lista": una pagina puo' rimandare ad altre liste della
stessa persona (il profilo Elfster con piu' wishlist, il JSON con ``lists``
annidate, la colonna ``lista`` del CSV con "Natale > Libri"). Si importano
tutte, e alla creazione l'albero diventa liste incluse (ADR 0008), che hanno
un solo livello: i nipoti salgono a figli.

Niente si salva finche' l'utente non conferma: ``read`` restituisce solo
l'anteprima, ``create_lists`` crea liste e regali; le foto arrivano dopo, dal
worker (``tasks.attach_import_images``).
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
from dataclasses import asdict, dataclass, field
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import PurePath
from urllib.parse import urljoin, urlsplit

import httpx
from django.conf import settings
from django.db import transaction
from django.utils.translation import gettext as _

from . import ai
from .images import MAX_HTML_BYTES, ImageError, ReadError, ScraperDown, fetch
from .links import MAX_URL, _decode, clean_title, clean_url, parse_price
from .models import MAX_QUANTITY, Wish, WishList, WishListInclusion, seed_price

logger = logging.getLogger(__name__)

# Tetti: un import e' una lista o poche, non un catalogo.
MAX_LISTS = 20
MAX_ITEMS = 300
# Pagine "mostra altro" di Amazon da seguire (circa 10 regali l'una).
MAX_PAGES = 15
# Altre liste da aprire partendo da una pagina (profilo con piu' liste).
MAX_LINKED_LISTS = 10
MAX_FILE_BYTES = 2 * 1024 * 1024
# La pagina compatta da far leggere a Gemini: abbastanza per ~100 regali.
MAX_OUTLINE = 60_000
MAX_NOTES = 1000
MAX_LIST_TITLE = 120


class ImportFailed(Exception):
    """Un import che non si puo' fare: il messaggio va all'utente."""


@dataclass
class ImportItem:
    title: str
    url: str = ""
    price: Decimal | None = None
    quantity: int = 1
    notes: str = ""
    image_url: str = ""


@dataclass
class ImportList:
    title: str
    items: list[ImportItem] = field(default_factory=list)
    # Le liste "dentro" questa: al salvataggio diventano liste incluse.
    lists: list[ImportList] = field(default_factory=list)
    source: str = ""

    def count(self) -> tuple[int, int]:
        """Quante liste (questa compresa) e quanti regali ci sono nell'albero."""
        lists, items = 1, len(self.items)
        for child in self.lists:
            child_lists, child_items = child.count()
            lists += child_lists
            items += child_items
        return lists, items


def as_data(lists: list[ImportList]) -> list[dict]:
    """L'albero per l'anteprima (JSON): i prezzi come stringhe."""

    def item(entry: ImportItem) -> dict:
        data = asdict(entry)
        data["price"] = f"{entry.price:.2f}" if entry.price is not None else None
        return data

    return [
        {
            "title": entry.title,
            "source": entry.source,
            "items": [item(i) for i in entry.items],
            "lists": as_data(entry.lists),
        }
        for entry in lists
    ]


# ---------------------------------------------------------------- comuni --


def _clean_text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _quantity(value) -> int:
    try:
        number = int(Decimal(str(value).strip()))
    except (ArithmeticError, ValueError):
        return 1
    return min(max(number, 1), MAX_QUANTITY)


def _url(value, base: str = "") -> str:
    """Un link http(s) assoluto e ripulito, o stringa vuota."""
    raw = str(value or "").strip()
    if not raw or raw.startswith(("data:", "javascript:", "#")):
        return ""
    url = urljoin(base, raw) if base else raw
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return ""
    url = clean_url(url)
    return url if len(url) <= MAX_URL else ""


def _item(title, url="", price=None, quantity=1, notes="", image="", base="", currency=""):
    title = clean_title(_clean_text(title, 400))
    if not title:
        return None
    if not isinstance(price, Decimal):
        price = parse_price(str(price), currency) if price not in (None, "") else None
    return ImportItem(
        title=title,
        url=_url(url, base),
        price=price,
        quantity=_quantity(quantity),
        notes=str(notes or "").strip()[:MAX_NOTES],
        image_url=_url(image, base),
    )


def _limit(lists: list[ImportList]) -> list[ImportList]:
    """Taglia l'albero ai tetti, nell'ordine in cui arriva."""
    budget = {"lists": MAX_LISTS, "items": MAX_ITEMS}

    def cut(entries: list[ImportList]) -> list[ImportList]:
        kept = []
        for entry in entries:
            if budget["lists"] <= 0:
                break
            budget["lists"] -= 1
            entry.items = entry.items[: max(budget["items"], 0)]
            budget["items"] -= len(entry.items)
            entry.lists = cut(entry.lists)
            kept.append(entry)
        return kept

    return cut(lists)


# ---------------------------------------------------------- dove leggere --


def _fetch_html(url: str) -> tuple[str, str]:
    """La pagina con una richiesta diretta (con le difese SSRF di ``fetch``)."""
    page = fetch(url, MAX_HTML_BYTES)
    if "html" not in page.content_type:
        raise ImportFailed(_("Il link non porta a una pagina web."))
    return _decode(page.body), page.url


def scrape_html(url: str) -> tuple[str, str]:
    """La pagina aperta dal browser dello scraper, gia' scorsa fino in fondo."""
    if not settings.SCRAPER_URL:
        raise ScraperDown(_("Non riesco ad aprire la pagina del link."))
    try:
        response = httpx.post(
            f"{settings.SCRAPER_URL.rstrip('/')}/scrape",
            json={"url": url, "html": True},
            # Scorrere una lista lunga richiede piu' tempo di un prodotto.
            timeout=settings.SCRAPER_TIMEOUT + 20,
        )
    except httpx.HTTPError:
        raise ScraperDown(_("Non riesco ad aprire la pagina del link.")) from None
    if response.status_code != 200:
        raise ReadError(_("Non riesco ad aprire la pagina del link."))
    data = response.json()
    if data.get("blocked"):
        raise ImportFailed(
            _(
                "Il sito chiede di dimostrare di non essere un robot: apri la lista nel "
                "tuo browser e importala con l'estensione di Regalino."
            )
        )
    return str(data.get("html") or ""), str(data.get("url") or url)


def _page(url: str, prefer_browser: bool = False) -> tuple[str, str]:
    """Diretta e poi browser, o subito il browser per le pagine fatte in JavaScript."""
    if not prefer_browser:
        try:
            return _fetch_html(url)
        except ReadError:
            if not settings.SCRAPER_URL:
                raise
    return scrape_html(url)


# ----------------------------------------------------------------- Amazon --

_AMAZON_HOST = re.compile(r"(^|\.)amazon\.[a-z.]+$", re.I)
_AMAZON_LIST = re.compile(
    r"/(?:hz/wishlist/(?:ls|genericItemsPage)|registry/wishlist|gp/registry/wishlist)/"
    r"([A-Z0-9]{8,20})",
    re.I,
)
_ITEM_FIELD = re.compile(r"^(itemName|itemImage|itemComment|itemRequested|itemPrice)_(\w+)$")


def is_amazon_list(url: str) -> bool:
    parts = urlsplit(url)
    return bool(_AMAZON_HOST.search(parts.hostname or "")) and bool(
        _AMAZON_LIST.search(parts.path)
    )


class _AmazonParser(HTMLParser):
    """I regali di una pagina di lista desideri Amazon.

    Ogni regalo e' un ``<li data-itemid="X" data-price="29.99">`` e i suoi
    campi hanno id col suffisso ``_X``: ``itemName_X`` (link e titolo),
    ``itemImage_X`` (la foto dentro), ``itemComment_X``, ``itemRequested_X``.
    Le pagine successive sono nell'input nascosto ``showMoreUrl``.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items: dict[str, dict] = {}
        self.list_title = ""
        self.next_url = ""
        self._capture: tuple[str, str] | None = None
        self._depth = 0
        self._image_for: str | None = None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        attr = {key: value or "" for key, value in attrs}
        if self._capture is not None:
            self._depth += 1
        if tag == "li" and attr.get("data-itemid"):
            entry = self.items.setdefault(attr["data-itemid"], {})
            entry["price"] = attr.get("data-price", "")
        if tag == "input" and attr.get("name") == "showMoreUrl" and attr.get("value"):
            self.next_url = attr["value"]
        if attr.get("id") == "profile-list-name":
            self._in_title = True
        if tag == "img" and self._image_for:
            src = attr.get("src") or ""
            if src and not src.startswith("data:"):
                self.items.setdefault(self._image_for, {}).setdefault("image", src)
            self._image_for = None
        match = _ITEM_FIELD.match(attr.get("id", ""))
        if not match:
            return
        name, item_id = match.groups()
        entry = self.items.setdefault(item_id, {})
        if name == "itemName":
            entry["url"] = attr.get("href", "")
            if attr.get("title"):
                entry["title"] = attr["title"]
        if name == "itemImage":
            self._image_for = item_id
            return
        if self._capture is None and not (name == "itemName" and entry.get("title")):
            self._capture = (item_id, name)
            self._depth = 0

    def handle_endtag(self, tag):
        if self._in_title:
            self._in_title = False
        if self._capture is not None:
            if self._depth == 0:
                self._capture = None
            else:
                self._depth -= 1

    def handle_data(self, data):
        if self._in_title:
            self.list_title += data
        if self._capture is None:
            return
        item_id, name = self._capture
        key = {"itemName": "title", "itemComment": "notes", "itemRequested": "quantity"}.get(
            name, "price_text"
        )
        entry = self.items.setdefault(item_id, {})
        entry[key] = (entry.get(key, "") + data)[:2000]


# Le Amazon in euro: sulle altre il prezzo e' in un'altra valuta e non si prende.
_AMAZON_EURO = re.compile(r"\.amazon\.(it|de|fr|es|nl|ie|com\.be)$", re.I)


def _amazon_items(parser: _AmazonParser, base: str) -> list[ImportItem]:
    euro = bool(_AMAZON_EURO.search("." + (urlsplit(base).hostname or "")))
    items = []
    for data in parser.items.values():
        price = data.get("price", "")
        # "-Infinity" = prezzo non disponibile (prodotto con piu' venditori).
        if not re.match(r"^\d", price):
            price = data.get("price_text", "")
        quantity = re.search(r"\d+", data.get("quantity", "") or "")
        entry = _item(
            data.get("title"),
            url=data.get("url"),
            price=price,
            quantity=quantity.group(0) if quantity else 1,
            notes=data.get("notes", ""),
            image=data.get("image", ""),
            base=base,
            currency="EUR" if euro else "XXX",
        )
        if entry is not None:
            items.append(entry)
    return items


def parse_amazon(html: str, base: str) -> tuple[str, list[ImportItem], str]:
    """Titolo della lista, regali e link della pagina successiva (o "")."""
    parser = _AmazonParser()
    try:
        parser.feed(html)
    except Exception:  # HTML rotto: si tiene quello letto fin li'
        pass
    next_url = urljoin(base, parser.next_url) if parser.next_url else ""
    return _clean_text(parser.list_title, MAX_LIST_TITLE), _amazon_items(parser, base), next_url


def read_amazon(url: str, html: str | None = None) -> list[ImportList]:
    if html is None:
        html, url = _page(url)
    title, items, next_url = parse_amazon(html, url)
    seen = {next_url}
    pages = 1
    while next_url and pages < MAX_PAGES and len(items) < MAX_ITEMS:
        try:
            more = _fetch_html(next_url)[0]
        except ImageError:
            break
        extra, next_url = parse_amazon(more, url)[1:]
        if not extra or next_url in seen:
            items += extra
            break
        seen.add(next_url)
        items += extra
        pages += 1
    if not items:
        raise ImportFailed(
            _(
                "Non trovo regali in questa lista Amazon: controlla che sia pubblica o "
                "condivisa col link."
            )
        )
    return [ImportList(title=title or _("Lista Amazon"), items=items, source=url)]


# ------------------------------------------------ pagina qualsiasi e Gemini --

_SKIP_TAGS = {"script", "style", "noscript", "svg", "head", "template", "iframe", "button"}
_BLOCK_TAGS = {
    "p", "div", "li", "ul", "ol", "section", "article", "header", "footer", "main",
    "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "br", "nav", "aside",
}  # fmt: skip


class _OutlineParser(HTMLParser):
    """La pagina ridotta a testo con ``[testo](link)`` e ``![alt](foto)``.

    E' quello che legge Gemini: poche decine di KB invece dei MB dell'HTML,
    e con i link e le foto veri accanto al testo a cui appartengono.
    """

    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.out: list[str] = []
        self.links: set[str] = set()
        self.images: set[str] = set()
        self._skip = 0
        self._href: list[str] = []
        self._link_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        attr = {key: value or "" for key, value in attrs}
        if tag in _BLOCK_TAGS:
            self.out.append("\n")
        if tag == "a":
            self._href.append(_url(attr.get("href"), self.base))
            self._link_text = []
        if tag == "img":
            src = attr.get("src") or attr.get("data-src") or ""
            if not src and attr.get("srcset"):
                src = attr["srcset"].split(",")[0].split(" ")[0]
            src = _url(src, self.base)
            if src:
                self.images.add(src)
                self.out.append(f" ![{_clean_text(attr.get('alt'), 80)}]({src}) ")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "a" and self._href:
            href = self._href.pop()
            text = _clean_text(" ".join(self._link_text), 200)
            if href and text:
                self.links.add(href)
                self.out.append(f" [{text}]({href}) ")
            elif text:
                self.out.append(f" {text} ")
            self._link_text = []
        elif tag in _BLOCK_TAGS:
            self.out.append("\n")

    def handle_data(self, data):
        if self._skip:
            return
        if self._href:
            self._link_text.append(data)
        else:
            self.out.append(data)

    def text(self) -> str:
        raw = "".join(self.out)
        raw = re.sub(r"[ \t]+", " ", raw)
        return re.sub(r"\s*\n\s*", "\n", raw).strip()


def page_outline(html: str, base: str) -> tuple[str, set[str], set[str]]:
    parser = _OutlineParser(base)
    try:
        parser.feed(html)
    except Exception:
        pass
    return parser.text()[:MAX_OUTLINE], parser.links, parser.images


def _json_ld_items(html: str, base: str) -> tuple[str, list[ImportItem]]:
    """Una ``ItemList`` dichiarata in JSON-LD, se la pagina e' cosi' gentile."""
    title, items = "", []
    for blob in re.findall(
        r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", html, re.S | re.I
    ):
        try:
            data = json.loads(blob.strip())
        except ValueError:
            continue
        for node in data if isinstance(data, list) else [data]:
            if not isinstance(node, dict) or node.get("@type") != "ItemList":
                continue
            title = title or _clean_text(node.get("name"), MAX_LIST_TITLE)
            for element in node.get("itemListElement") or []:
                if not isinstance(element, dict):
                    continue
                product = element.get("item") if isinstance(element.get("item"), dict) else element
                offers = product.get("offers") or {}
                offer = offers[0] if isinstance(offers, list) and offers else offers
                offer = offer if isinstance(offer, dict) else {}
                image = product.get("image")
                image = image[0] if isinstance(image, list) and image else image
                entry = _item(
                    product.get("name"),
                    url=product.get("url") or element.get("url"),
                    price=offer.get("price"),
                    currency=offer.get("priceCurrency") or "",
                    notes=product.get("description") or "",
                    image=image if isinstance(image, str) else "",
                    base=base,
                )
                if entry is not None:
                    items.append(entry)
    return title, items


def _from_gemini(html: str, base: str) -> tuple[str, list[ImportItem], list[tuple[str, str]]]:
    """Titolo, regali e altre liste collegate, letti da Gemini nella pagina compatta."""
    outline, links, images = page_outline(html, base)
    data = ai.extract_gift_list(url=base, outline=outline)
    if data is None:
        raise ImportFailed(
            _("Non riesco a leggere i regali di questa pagina. Riprova tra poco.")
        )
    items = []
    for raw in data.get("items") or []:
        if not isinstance(raw, dict):
            continue
        # Solo link e foto che ci sono davvero nella pagina: il resto e' inventato.
        url = _url(raw.get("url"), base)
        image = _url(raw.get("image"), base)
        entry = _item(
            raw.get("title"),
            url=url if url in links else "",
            price=raw.get("price"),
            currency=str(raw.get("currency") or ""),
            quantity=raw.get("quantity") or 1,
            notes=raw.get("notes") or "",
            image=image if image in images else "",
        )
        if entry is not None:
            items.append(entry)
    others = []
    for raw in data.get("other_lists") or []:
        if not isinstance(raw, dict):
            continue
        url = _url(raw.get("url"), base)
        if url and url in links:
            others.append((_clean_text(raw.get("title"), MAX_LIST_TITLE), url))
    return _clean_text(data.get("title"), MAX_LIST_TITLE), items, others


_ELFSTER_HOST = re.compile(r"(^|\.)elfster\.[a-z.]+$", re.I)
# /u/<profilo>/w/<lista>: una wishlist; /u/<profilo>: il profilo con le sue liste.
_ELFSTER_LIST = re.compile(r"^/u/[^/]+/w/[^/]+/?$")


def _same_site(url: str, base: str) -> bool:
    a, b = urlsplit(url).hostname or "", urlsplit(base).hostname or ""
    return a.removeprefix("www.") == b.removeprefix("www.")


def read_page_lists(url: str, html: str | None = None, depth: int = 0) -> list[ImportList]:
    """Una pagina qualsiasi (Elfster compreso): dati dichiarati, poi Gemini.

    Le altre liste che la pagina collega (un profilo con piu' liste) si
    aprono anche loro, una volta sola e solo sullo stesso sito: diventano
    liste dentro questa.
    """
    elfster = bool(_ELFSTER_HOST.search(urlsplit(url).hostname or ""))
    if html is None:
        html, url = _page(url, prefer_browser=elfster)
    title, items = _json_ld_items(html, url)
    others: list[tuple[str, str]] = []
    if not items:
        if not ai.enabled():
            raise ImportFailed(
                _("Per leggere le liste di questo sito serve Gemini, che non e' configurato.")
            )
        title, items, others = _from_gemini(html, url)
    if elfster:
        # I link alle wishlist del profilo si riconoscono anche senza Gemini.
        links = page_outline(html, url)[1]
        known = {link for _title, link in others}
        for link in sorted(links):
            if _ELFSTER_LIST.match(urlsplit(link).path) and link not in known:
                others.append(("", link))
    children: list[ImportList] = []
    if depth == 0:
        seen = {clean_url(url)}
        for other_title, link in others:
            if len(children) >= MAX_LINKED_LISTS:
                break
            if link in seen or not _same_site(link, url):
                continue
            seen.add(link)
            try:
                found = read_page_lists(link, depth=1)
            except (ImageError, ImportFailed) as exc:
                logger.info("Lista collegata non letta (%s): %s", link, exc)
                continue
            for entry in found:
                entry.title = entry.title or other_title
                children.append(entry)
    if not items and not children:
        raise ImportFailed(_("In questa pagina non trovo una lista di regali."))
    return [
        ImportList(
            title=title or _("Lista importata"), items=items, lists=children, source=url
        )
    ]


def read_url(url: str, html: str | None = None) -> list[ImportList]:
    """Dal link (e, dall'estensione, dalla pagina gia' aperta) all'anteprima."""
    url = url.strip()
    html = html[:MAX_HTML_BYTES] if html else None
    try:
        if is_amazon_list(url):
            lists = read_amazon(url, html)
        else:
            lists = read_page_lists(url, html)
    except ImageError as exc:
        raise ImportFailed(str(exc)) from None
    return _limit(lists)


# ---------------------------------------------------------------- file --

_TITLE_KEYS = ("title", "name", "nome", "titolo", "regalo", "item", "product", "prodotto")
_URL_KEYS = ("url", "link", "href", "product_url", "negozio")
_PRICE_KEYS = ("price", "prezzo", "cost", "costo", "amount")
_QUANTITY_KEYS = ("quantity", "qty", "quantita", "quantità", "quanti", "pezzi")
_NOTES_KEYS = ("notes", "note", "description", "descrizione", "comment", "commento")
_IMAGE_KEYS = ("image", "image_url", "foto", "immagine", "picture", "img")
_LIST_KEYS = ("list", "lista", "wishlist", "categoria", "category")
_ITEMS_KEYS = ("items", "wishes", "regali", "gifts", "products", "prodotti")
_CHILDREN_KEYS = ("lists", "liste", "sublists", "children", "wishlists")


def _pick(data: dict, keys: tuple[str, ...]):
    lowered = {str(key).strip().lower(): value for key, value in data.items()}
    for key in keys:
        if lowered.get(key) not in (None, ""):
            return lowered[key]
    return None


def _item_from_dict(data: dict) -> ImportItem | None:
    return _item(
        _pick(data, _TITLE_KEYS),
        url=_pick(data, _URL_KEYS) or "",
        price=_pick(data, _PRICE_KEYS),
        quantity=_pick(data, _QUANTITY_KEYS) or 1,
        notes=_pick(data, _NOTES_KEYS) or "",
        image=_pick(data, _IMAGE_KEYS) or "",
        currency="EUR",
    )


def _list_from_json(data: dict, fallback: str, depth: int = 0) -> ImportList:
    items = [
        entry
        for raw in (_pick(data, _ITEMS_KEYS) or [])
        if isinstance(raw, dict) and (entry := _item_from_dict(raw)) is not None
    ]
    children = []
    if depth < 3:
        children = [
            _list_from_json(raw, fallback, depth + 1)
            for raw in (_pick(data, _CHILDREN_KEYS) or [])
            if isinstance(raw, dict)
        ]
    title = _clean_text(_pick(data, _TITLE_KEYS), MAX_LIST_TITLE) or fallback
    return ImportList(title=title, items=items, lists=children)


def parse_json(text: str, fallback: str) -> list[ImportList]:
    try:
        data = json.loads(text)
    except ValueError:
        raise ImportFailed(_("Il file JSON non e' valido.")) from None
    if isinstance(data, dict) and _pick(data, _CHILDREN_KEYS) and not _pick(data, _ITEMS_KEYS):
        # {"lists": [...]}: solo liste, nessun contenitore.
        data = _pick(data, _CHILDREN_KEYS)
    if isinstance(data, dict):
        return [_list_from_json(data, fallback)]
    if not isinstance(data, list):
        raise ImportFailed(_("Il file JSON non contiene una lista di regali."))
    if all(isinstance(raw, dict) and _pick(raw, _ITEMS_KEYS + _CHILDREN_KEYS) for raw in data):
        return [_list_from_json(raw, fallback) for raw in data]
    # Un elenco di regali, senza liste.
    items = [e for raw in data if isinstance(raw, dict) and (e := _item_from_dict(raw))]
    return [ImportList(title=fallback, items=items)]


def parse_csv(text: str, fallback: str) -> list[ImportList]:
    """Una riga per regalo; la colonna ``lista`` ("Natale > Libri") fa le liste."""
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not rows.fieldnames or _pick(dict.fromkeys(rows.fieldnames, "x"), _TITLE_KEYS) is None:
        raise ImportFailed(
            _("Nel CSV manca la colonna col nome del regalo (title, nome o titolo).")
        )
    order: list[ImportList] = []

    def node(path: list[str]) -> ImportList:
        siblings, current = order, None
        for name in path:
            current = next((entry for entry in siblings if entry.title == name), None)
            if current is None:
                current = ImportList(title=name)
                siblings.append(current)
            siblings = current.lists
        assert current is not None
        return current

    for row in rows:
        entry = _item_from_dict({k: v for k, v in row.items() if k is not None})
        if entry is None:
            continue
        raw_path = str(_pick(row, _LIST_KEYS) or "").strip()
        path = [_clean_text(p, MAX_LIST_TITLE) for p in raw_path.split(">") if p.strip()]
        node(path[:3] or [fallback]).items.append(entry)
    return order


def read_file(name: str, data: bytes) -> list[ImportList]:
    if len(data) > MAX_FILE_BYTES:
        raise ImportFailed(_("Il file e' troppo grande (al massimo 2 MB)."))
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = data.decode("latin-1")
    fallback = _clean_text(PurePath(name or "").stem.replace("_", " "), MAX_LIST_TITLE)
    fallback = fallback or _("Lista importata")
    if (name or "").lower().endswith(".json") or text.lstrip().startswith(("{", "[")):
        lists = parse_json(text, fallback)
    else:
        lists = parse_csv(text, fallback)
    lists = _limit([entry for entry in lists if entry.count()[1]])
    if not lists:
        raise ImportFailed(_("Nel file non trovo regali."))
    return lists


# --------------------------------------------------------------- salvare --


def from_data(entries: list[dict]) -> list[ImportList]:
    """L'anteprima confermata dal browser (gia' validata) di nuovo in ``ImportList``."""
    return [
        ImportList(
            title=entry["title"],
            items=[
                ImportItem(
                    title=item["title"],
                    url=_url(item.get("url")),
                    price=item.get("price"),
                    quantity=item.get("quantity") or 1,
                    notes=item.get("notes") or "",
                    image_url=_url(item.get("image_url")),
                )
                for item in entry.get("items") or []
            ],
            lists=from_data(entry.get("lists") or []),
        )
        for entry in entries
    ]


def _flatten(entries: list[ImportList]) -> list[ImportList]:
    """Tutte le liste sotto queste, a ogni livello: diventano liste incluse."""
    out = []
    for entry in entries:
        out.append(entry)
        out += _flatten(entry.lists)
    return out


def _new_list(user, entry: ImportList, jobs: list[tuple[str, str]]) -> WishList:
    wish_list = WishList.objects.create(owner=user, title=entry.title[:MAX_LIST_TITLE])
    for item in entry.items:
        wish = Wish.objects.create(
            wish_list=wish_list,
            title=item.title[:160],
            url=item.url,
            price=item.price,
            quantity=item.quantity,
            notes=item.notes,
        )
        seed_price(wish)
        if item.image_url or item.url:
            jobs.append((str(wish.pk), item.image_url or item.url))
    return wish_list


@transaction.atomic
def create_lists(
    user, entries: list[ImportList], group_title: str = ""
) -> tuple[list[WishList], list[tuple[str, str]]]:
    """Crea le liste e i regali; torna le liste "in cima" e le foto da prendere.

    Con ``group_title`` tutte finiscono dentro una lista nuova con quel nome.
    Senza, ogni lista in cima include le sue sotto-liste (a ogni livello:
    le liste incluse hanno un livello solo, ADR 0008). Le liste vuote che
    servivano solo da contenitore non si creano.
    """
    jobs: list[tuple[str, str]] = []
    entries = _limit(entries)
    if group_title:
        parent = WishList.objects.create(owner=user, title=group_title[:MAX_LIST_TITLE])
        for entry in _flatten(entries):
            if entry.items:
                child = _new_list(user, entry, jobs)
                WishListInclusion.objects.create(parent=parent, child=child)
        return [parent], jobs

    top = []
    for entry in entries:
        children = [child for child in _flatten(entry.lists) if child.items]
        if not entry.items and not children:
            continue
        # Senza regali suoi resta come contenitore (il profilo con piu' liste).
        wish_list = _new_list(user, entry, jobs)
        for child_entry in children:
            child = _new_list(user, child_entry, jobs)
            WishListInclusion.objects.create(parent=wish_list, child=child)
        top.append(wish_list)
    return top, jobs
