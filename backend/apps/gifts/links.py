"""Leggere il link di un regalo: foto, nome, prezzo e note (ADR 0003, 0005, 0006).

Prima la lettura diretta, che e' veloce: una richiesta con ``fetch`` e poi i
dati che la pagina dichiara (og:*, JSON-LD, microdata). Se il sito blocca, la
pagina e' fatta in JavaScript o mancano foto o prezzo, la pagina si apre col
browser dello scraper. Le foto le scarica sempre ``fetch``, anche quando i
link arrivano dallo scraper, quindi con le stesse difese SSRF.

Nome e note si possono far scrivere a Gemini (``ai.py``) partendo dal testo
della pagina: senza chiave restano i dati dichiarati, e le note vuote. Gemini
a volte ci mette decine di secondi, quindi va in una seconda richiesta: la
pagina letta si tiene in cache con ``remember_page`` e ``links/describe`` la
riprende (ADR 0006).
"""

from __future__ import annotations

import json
import re
import secrets
from dataclasses import asdict, dataclass, field
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from urllib.parse import urljoin

import httpx
from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.utils.translation import gettext as _

from . import ai
from .images import MAX_HTML_BYTES, ImageError, ReadError, ScraperDown, fetch, process_image

# Quanto testo della pagina tenere: basta per nome, prezzo e varianti.
MAX_TEXT = 12_000
# Sotto questo il testo letto direttamente non basta a Gemini: si apre il browser.
MIN_TEXT = 500
# Le stesse lunghezze dei campi di Wish e GiftIdea.
MAX_TITLE = 160
MAX_NOTES = 500
# Quanto resta in cache la pagina letta, in attesa che il form chieda Gemini.
PAGE_TTL = 10 * 60


@dataclass
class Page:
    """Quello che si e' letto da un link."""

    url: str
    title: str = ""
    description: str = ""
    price: str = ""
    currency: str = ""
    text: str = ""
    images: list[str] = field(default_factory=list)
    # Codice a barre (EAN/GTIN/ISBN) e marca dichiarati: servono a cercare lo
    # stesso prodotto in altri negozi ("Dove trovarlo"), non al form.
    gtin: str = ""
    brand: str = ""
    # Il link era direttamente un'immagine: eccola gia' elaborata.
    image: ContentFile | None = None


@dataclass
class Details:
    """Nome, prezzo e note da proporre nel form, piu' codice e marca."""

    title: str = ""
    price: Decimal | None = None
    notes: str = ""
    gtin: str = ""
    brand: str = ""


# ------------------------------------------------------ lettura diretta --


class _PageParser(HTMLParser):
    """Meta, JSON-LD, microdata, titolo e testo visibile di una pagina."""

    IMAGE_KEYS = ("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src")
    SKIPPED = {"script", "style", "noscript", "svg", "template", "head"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.itemprop: dict[str, str] = {}
        self.others: list[str] = []
        self.json_ld: list[str] = []
        self.title = ""
        self.heading = ""
        # Amazon e simili: il nome del prodotto sta in un elemento con questo id.
        self.product_title = ""
        self._json_ld: list[str] | None = None
        self._in_title = False
        self._in_h1 = False
        self._in_product_title = 0
        self._skip = 0
        self._text: list[str] = []
        self._text_size = 0

    def handle_starttag(self, tag, attrs):
        values = {key.lower(): (value or "") for key, value in attrs}
        if tag in self.SKIPPED:
            self._skip += 1
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            content = values.get("content", "").strip()
            if key and content:
                self.meta.setdefault(key, content)
            if values.get("itemprop") and content:
                self.itemprop.setdefault(values["itemprop"].lower(), content)
        elif values.get("itemprop") in ("price", "image", *GTIN_KEYS, "brand"):
            # <span itemprop="price" content="29.90"> o <img itemprop="image" src=...>
            value = values.get("content") or values.get("src") or values.get("href")
            if value:
                self.itemprop.setdefault(values["itemprop"].lower(), value.strip())
        if tag == "link" and values.get("rel", "").lower() == "image_src" and values.get("href"):
            self.others.append(values["href"])
        elif tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._json_ld = []
        elif tag == "title":
            self._in_title = True
        elif tag == "h1" and not self.heading:
            self._in_h1 = True
        if self._in_product_title:
            self._in_product_title += 1
        elif values.get("id") == "productTitle" and not self.product_title:
            self._in_product_title = 1

    def handle_endtag(self, tag):
        if tag == "script" and self._json_ld is not None:
            self.json_ld.append("".join(self._json_ld))
            self._json_ld = None
        if tag in self.SKIPPED and self._skip:
            self._skip -= 1
        if tag == "title":
            self._in_title = False
        elif tag == "h1":
            self._in_h1 = False
        if self._in_product_title:
            self._in_product_title -= 1

    def handle_data(self, data):
        if self._json_ld is not None:
            self._json_ld.append(data)
        if self._in_title:
            self.title += data
        if self._in_h1:
            self.heading += data
        if self._in_product_title:
            self.product_title += data
        if not self._skip and self._text_size < MAX_TEXT:
            text = " ".join(data.split())
            if text:
                self._text.append(text)
                self._text_size += len(text) + 1

    @property
    def text(self) -> str:
        return "\n".join(self._text)[:MAX_TEXT]


def _json_ld(blobs: list[str]) -> tuple[list[str], dict | None]:
    """Le immagini dichiarate nel JSON-LD e il primo ``Product``."""
    found: list[str] = []
    product: dict | None = None

    def walk(node):
        nonlocal product
        if isinstance(node, dict):
            types = node.get("@type")
            types = types if isinstance(types, list) else [types]
            if product is None and "Product" in types:
                product = node
            image = node.get("image")
            for item in image if isinstance(image, list) else [image]:
                if isinstance(item, str):
                    found.append(item)
                elif isinstance(item, dict) and isinstance(item.get("url"), str):
                    found.append(item["url"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for blob in blobs:
        try:
            walk(json.loads(blob))
        except ValueError:
            continue
    return [url for url in found if url], product


def _text(value) -> str:
    return " ".join(str(value).split()) if isinstance(value, (str, int, float)) else ""


GTIN_KEYS = ("gtin13", "gtin", "gtin14", "gtin12", "gtin8", "isbn", "ean")


def _gtin(*candidates) -> str:
    """Il primo codice che sembra un codice a barre: solo cifre, 8-14."""
    for candidate in candidates:
        digits = re.sub(r"[^0-9]", "", _text(candidate))
        if 8 <= len(digits) <= 14:
            return digits
    return ""


def _brand(value) -> str:
    # In JSON-LD la marca e' spesso ``{"@type": "Brand", "name": "..."}``.
    if isinstance(value, dict):
        value = value.get("name")
    return _text(value)[:80]


def page_from_html(html: str, base_url: str) -> Page:
    parser = _PageParser()
    try:
        parser.feed(html)
    except Exception:
        pass
    ld_images, product = _json_ld(parser.json_ld)
    meta = parser.meta
    offers = (product or {}).get("offers")
    offer = (offers[0] if offers else {}) if isinstance(offers, list) else (offers or {})
    if not isinstance(offer, dict):
        offer = {}

    candidates = [meta[key] for key in parser.IMAGE_KEYS if key in meta]
    candidates += [*ld_images, parser.itemprop.get("image", ""), *parser.others]
    images = []
    for candidate in candidates:
        candidate = candidate.strip()
        if candidate and not candidate.startswith("data:"):
            url = urljoin(base_url, candidate)
            if url not in images:
                images.append(url)

    return Page(
        url=base_url,
        # Il <title> prima dell'<h1>: il primo <h1> di una pagina non e' sempre
        # il prodotto, il <title> si' (col nome del negozio, che clean_title toglie).
        title=_text(
            meta.get("og:title")
            or (product or {}).get("name")
            or parser.product_title
            or parser.title
            or parser.heading
        ),
        description=_text(
            meta.get("og:description")
            or meta.get("description")
            or (product or {}).get("description")
        ),
        price=_text(
            meta.get("product:price:amount")
            or meta.get("og:price:amount")
            or offer.get("price")
            or offer.get("lowPrice")
            or parser.itemprop.get("price")
        ),
        currency=_text(
            meta.get("product:price:currency")
            or meta.get("og:price:currency")
            or offer.get("priceCurrency")
            or parser.itemprop.get("pricecurrency")
        ),
        text=parser.text,
        images=images,
        gtin=_gtin(
            *[(product or {}).get(key) for key in GTIN_KEYS],
            *[parser.itemprop.get(key) for key in GTIN_KEYS],
            meta.get("product:ean"),
        ),
        brand=_brand(
            (product or {}).get("brand")
            or meta.get("product:brand")
            or parser.itemprop.get("brand")
        ),
    )


def find_page_image(html: str, base_url: str) -> str | None:
    """L'immagine "di anteprima" di una pagina: og:image, poi le altre."""
    images = page_from_html(html, base_url).images
    return images[0] if images else None


_CHARSET = re.compile(rb"charset=[\"']?([\w-]+)", re.I)


def _decode(body: bytes) -> str:
    match = _CHARSET.search(body[:2048])
    encoding = match.group(1).decode("ascii") if match else "utf-8"
    try:
        return body.decode(encoding, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def _page_direct(url: str) -> Page:
    first = fetch(url, max(settings.IMAGE_MAX_BYTES, MAX_HTML_BYTES))
    if "html" not in first.content_type:
        # image/* o un tipo generico (certi CDN mandano octet-stream): decide Pillow.
        if first.content_type.startswith(("image/", "application/octet-stream", "binary/")):
            return Page(url=first.url, image=process_image(first.body))
        raise ImageError(_("Il link non e' ne' un'immagine ne' una pagina web."))
    return page_from_html(_decode(first.body), first.url)


# ---------------------------------------------------------------- scraper --


def scrape(url: str) -> dict:
    """Chiede allo scraper (ADR 0005) di aprire la pagina col browser.

    Restituisce quello che ha letto: ``images`` (in ordine di affidabilita'),
    ``title``, ``description``, ``price``, ``currency``, ``text``,
    ``blocked``. Lo scraper e' un servizio interno: la richiesta non passa da
    ``fetch``.
    """
    try:
        response = httpx.post(
            f"{settings.SCRAPER_URL.rstrip('/')}/scrape",
            json={"url": url},
            timeout=settings.SCRAPER_TIMEOUT,
        )
    except httpx.HTTPError:
        raise ScraperDown(_("Non riesco ad aprire la pagina del link.")) from None
    if response.status_code >= 500:
        raise ScraperDown(_("Non riesco ad aprire la pagina del link."))
    if response.status_code != 200:
        # 400: link rifiutato dalle regole di rete del browser.
        raise ReadError(_("Non riesco ad aprire la pagina del link."))
    return response.json()


def _page_scraped(url: str) -> Page:
    data = scrape(url)
    if data.get("blocked"):
        raise ImageError(
            _(
                "Il sito chiede di dimostrare di non essere un robot: carica la foto, "
                "oppure incolla il link diretto dell'immagine (tasto destro sulla "
                "foto → Copia indirizzo immagine)."
            )
        )
    images = [image for image in data.get("images") or [] if isinstance(image, str)]
    status = data.get("status")
    if not images and status and status >= 400:
        raise ReadError(_("Il sito ha risposto con un errore (%s).") % status)
    return Page(
        url=data.get("url") or url,
        title=_text(data.get("title") or ""),
        description=_text(data.get("description") or ""),
        price=_text(data.get("price") or ""),
        currency=_text(data.get("currency") or ""),
        text=str(data.get("text") or "")[:MAX_TEXT],
        images=images,
    )


def _merge(direct: Page, scraped: Page) -> Page:
    """La lettura diretta vince sui dati dichiarati; il testo del browser e'
    quello vero (la pagina costruita), le foto si sommano."""
    images = direct.images + [url for url in scraped.images if url not in direct.images]
    return Page(
        url=direct.url,
        title=direct.title or scraped.title,
        description=direct.description or scraped.description,
        price=direct.price or scraped.price,
        currency=(direct.currency or scraped.currency) if direct.price else scraped.currency,
        text=scraped.text or direct.text,
        images=images,
    )


def read_page(url: str, details: bool = False) -> Page:
    """Legge il link: diretto, e col browser se serve.

    Con ``details`` si vuole anche il prezzo, quindi lo scraper parte pure se
    la lettura diretta ha la foto ma non il prezzo (o, con Gemini, quasi
    niente testo da fargli leggere). Gli errori sul link in se'
    (indirizzo non pubblico, porta, credenziali) non arrivano allo scraper.
    """
    try:
        page = _page_direct(url)
    except ReadError as direct_error:
        if not settings.SCRAPER_URL:
            raise
        try:
            return _page_scraped(url)
        except ScraperDown:
            raise direct_error from None

    # Con Gemini conta anche il testo: una pagina fatta in JavaScript letta
    # direttamente e' quasi vuota, quella aperta dal browser no.
    needs_text = details and ai.enabled() and len(page.text) < MIN_TEXT
    complete = page.images and (page.price or not details) and not needs_text
    if page.image is not None or complete or not settings.SCRAPER_URL:
        return page
    try:
        return _merge(page, _page_scraped(url))
    except ScraperDown:
        return page
    except ImageError:
        # Il browser e' stato bloccato ma la lettura diretta qualcosa l'ha dato.
        if page.images or details:
            return page
        raise


# ---------------------------------------------------------------- risultati --


def image_of(page: Page) -> tuple[ContentFile, str]:
    """La foto del link, scaricata ed elaborata, e l'URL da cui e' arrivata."""
    if page.image is not None:
        return page.image, page.url
    for candidate in page.images[:4]:
        try:
            image = fetch(candidate, settings.IMAGE_MAX_BYTES)
            if "html" not in image.content_type:
                return process_image(image.body), image.url
        except ImageError:
            continue
    raise ImageError(
        _("In quella pagina non trovo un'immagine del prodotto: caricala tu dal telefono.")
    )


def image_from_url(url: str) -> tuple[ContentFile, str]:
    """Dal link (di un'immagine o della pagina di un negozio) all'immagine pronta."""
    return image_of(read_page(url))


# \s copre anche gli spazi non separabili (1 299,00 €).
_NUMBER = re.compile(r"\d[\d.,'\s]*")
_OTHER_CURRENCY = re.compile(r"[$£¥]|\b(USD|GBP|CHF|JPY)\b", re.I)


def parse_price(raw: str, currency: str = "") -> Decimal | None:
    """Da "1.299,00 €", "29.90", "€ 24" al Decimal; ``None`` se non e' in euro.

    L'app ragiona in euro: un prezzo in un'altra valuta non si propone.
    """
    if currency and currency.strip().upper() != "EUR":
        return None
    if not raw or _OTHER_CURRENCY.search(raw):
        return None
    match = _NUMBER.search(raw)
    if not match:
        return None
    number = re.sub(r"['\s]", "", match.group()).rstrip(".,")
    comma, dot = number.rfind(","), number.rfind(".")
    if comma >= 0 and dot >= 0:
        decimal = "," if comma > dot else "."
    elif comma >= 0 or dot >= 0:
        sep = "," if comma >= 0 else "."
        tail = len(number) - number.rfind(sep) - 1
        # "1.299" o "1,299" sono migliaia; "29,9" e "29.90" decimali.
        decimal = None if tail == 3 or number.count(sep) > 1 else sep
    else:
        decimal = None
    if decimal:
        whole, _sep, fraction = number.rpartition(decimal)
        whole = re.sub(r"[.,]", "", whole)
        number = f"{whole}.{fraction}"
    else:
        number = re.sub(r"[.,]", "", number)
    try:
        value = Decimal(number).quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
    return value if Decimal("0") < value < Decimal("100000000") else None


def clean_title(title: str) -> str:
    """Il nome del prodotto senza il negozio e la lista di caratteristiche.

    "Echo Dot (modello 2022) | Altoparlante intelligente..." diventa
    "Echo Dot (modello 2022)"; "Amazon.it: Libro" e "Libro : Autore : Amazon.it:
    Libri" diventano "Libro".
    """
    title = re.sub(r"^\s*amazon\.\w+\s*:\s*", "", title, flags=re.I)
    # "Nome : Autori : Amazon.it: Libri" -> "Nome"
    if re.search(r"\s:\s*amazon\.\w+", title, re.I):
        title = title.split(" : ")[0]
    first = title.split(" | ")[0].strip()
    if len(first) >= 8:
        title = first
    if len(title) > MAX_TITLE:
        title = title[: MAX_TITLE - 1].rsplit(" ", 1)[0].rstrip(" ,;:-") + "…"
    return title.strip()


def declared_details(page: Page) -> Details:
    """Nome e prezzo che la pagina dichiara: subito, senza Gemini."""
    return Details(
        title=clean_title(page.title),
        price=parse_price(page.price, page.currency),
        gtin=page.gtin,
        brand=page.brand,
    )


def can_describe(page: Page) -> bool:
    """Vale la pena chiedere a Gemini: c'e' la chiave e una pagina da leggere."""
    return ai.enabled() and page.image is None and bool(page.text or page.title)


def remember_page(page: Page, owner_id) -> str:
    """Tiene la pagina letta per ``links/describe``; torna la chiave da usare.

    La chiave e' casuale e legata all'utente: un altro non puo' far leggere a
    Gemini (a spese della chiave) pagine che non ha letto lui.
    """
    key = secrets.token_urlsafe(16)
    data = {k: v for k, v in asdict(page).items() if k != "image"}
    cache.set(f"link-page:{key}", {"owner": str(owner_id), "page": data}, PAGE_TTL)
    return key


def recall_page(key: str, owner_id) -> Page | None:
    stored = cache.get(f"link-page:{key}")
    if not stored or stored.get("owner") != str(owner_id):
        return None
    return Page(**stored["page"])


def details_of(page: Page, language: str = "it") -> Details:
    """Nome, prezzo e note: i dati dichiarati, migliorati da Gemini se c'e' la chiave.

    Il prezzo dichiarato (JSON-LD, meta) vince su quello letto da Gemini nel
    testo: e' quello del prodotto, non di un consigliato accanto.
    """
    details = declared_details(page)
    if not can_describe(page):
        return details
    summary = ai.describe_product(
        url=page.url,
        title=page.title,
        description=page.description,
        price=" ".join(filter(None, [page.price, page.currency])),
        text=page.text,
        language=language,
    )
    if summary:
        details.title = clean_title(summary.get("name") or "") or details.title
        if details.price is None:
            details.price = parse_price(summary.get("price") or "", summary.get("currency") or "")
        notes = " ".join((summary.get("notes") or "").split())
        details.notes = notes[:MAX_NOTES]
    return details
