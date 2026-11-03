"""Foto dei regali: elaborazione e presa da un link (ADR 0003).

Ogni immagine, caricata o scaricata, passa da ``process_image``: si apre con
Pillow (cosi' un file che non e' un'immagine viene rifiutato), si raddrizza
secondo l'EXIF, si riduce a ``IMAGE_MAX_SIDE`` e si salva in WebP *senza*
metadati. I metadati vanno via apposta: la foto fatta col telefono porta la
posizione GPS di casa, e la lista si condivide con un link.

Il link invece e' un URL scelto dall'utente che il *server* va a leggere, cioe'
la porta d'ingresso classica per un SSRF: dal homeserver si raggiungono il
router, la LAN e i container accanto. Per questo ``fetch`` accetta solo
http/https, risolve il nome, rifiuta ogni indirizzo non pubblico e si collega
proprio all'IP controllato (niente seconda risoluzione DNS fra il controllo e
la connessione), rifacendo tutto a ogni redirect.
"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import urljoin, urlsplit

import httpx
from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.translation import gettext as _
from PIL import Image, ImageOps, UnidentifiedImageError

# Un'immagine piu' grande di cosi' (in pixel) e' quasi certamente una bomba di
# decompressione, non una foto di un regalo.
Image.MAX_IMAGE_PIXELS = 40_000_000

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
)
MAX_REDIRECTS = 4
MAX_HTML_BYTES = 3 * 1024 * 1024


class ImageError(Exception):
    """Errore da mostrare all'utente cosi' com'e'."""


class ReadError(ImageError):
    """Il link e' ammesso ma il sito non ha dato la foto (blocco, errore,
    pagina fatta in JavaScript): e' il caso in cui provare con lo scraper."""


class ScraperDown(ReadError):
    """Lo scraper non risponde: vale l'errore della lettura diretta."""


# ---------------------------------------------------------------- Pillow --


def process_image(data: bytes) -> ContentFile:
    """Dai byte di un'immagine qualsiasi al WebP ridotto e senza metadati."""
    if len(data) > settings.IMAGE_MAX_BYTES:
        raise ImageError(_("L'immagine e' troppo grande (massimo 10 MB)."))
    try:
        with Image.open(BytesIO(data)) as source:
            source.load()
            image = ImageOps.exif_transpose(source)
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
        raise ImageError(_("Il file non e' un'immagine che riesco a leggere.")) from None

    # Trasparenza su bianco: una foto di prodotto con lo sfondo trasparente
    # diventerebbe nera in certi visualizzatori.
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, (255, 255, 255))
        background.paste(image, mask=image.getchannel("A"))
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    side = settings.IMAGE_MAX_SIDE
    image.thumbnail((side, side), Image.Resampling.LANCZOS)
    out = BytesIO()
    # Nessun exif=/icc_profile=: il WebP esce senza metadati.
    image.save(out, format="WEBP", quality=82, method=4)
    return ContentFile(out.getvalue(), name="image.webp")


# ----------------------------------------------------------------- rete ---


def _public_ip(host: str, port: int) -> str:
    """Il primo IP pubblico di ``host``; errore se uno qualsiasi non lo e'."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise ImageError(_("Non trovo il sito del link.")) from None
    addresses = []
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            address = address.ipv4_mapped
        # is_global esclude privati, loopback, link-local, CGNAT, riservati.
        if not address.is_global or address.is_multicast:
            raise ImageError(_("Questo link punta a un indirizzo non pubblico."))
        addresses.append(str(address))
    if not addresses:
        raise ImageError(_("Non trovo il sito del link."))
    return addresses[0]


@dataclass
class Fetched:
    url: str
    content_type: str
    body: bytes


def _get(url: str, max_bytes: int) -> httpx.Response | Fetched:
    """Una sola richiesta, collegata all'IP controllato. Redirect restituiti."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ImageError(_("Il link deve iniziare con http:// o https://."))
    if parts.username or parts.password:
        raise ImageError(_("Il link non puo' contenere credenziali."))
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if port not in (80, 443):
        raise ImageError(_("Il link usa una porta non ammessa."))

    host = parts.hostname
    ip = _public_ip(host, port)
    ip_host = f"[{ip}]" if ":" in ip else ip
    target = parts._replace(netloc=f"{ip_host}:{port}").geturl()
    headers = {
        "Host": parts.netloc.rsplit("@", 1)[-1],
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    }
    timeout = httpx.Timeout(settings.IMAGE_FETCH_TIMEOUT, connect=5.0)
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False) as client:
            request = client.build_request(
                "GET", target, headers=headers, extensions={"sni_hostname": host}
            )
            response = client.send(request, stream=True)
            try:
                if response.is_redirect:
                    response.read()
                    return response
                if response.status_code in (401, 403, 429, 503):
                    # Protezioni anti-bot (Zalando, Decathlon, Amazon...): non si
                    # aggirano. Ci prova poi lo scraper, che apre la pagina col browser.
                    raise ReadError(
                        _(
                            "Il sito non si lascia leggere in automatico: carica la foto, "
                            "oppure incolla il link diretto dell'immagine (tasto destro "
                            "sulla foto → Copia indirizzo immagine)."
                        )
                    )
                if response.status_code >= 400:
                    raise ReadError(
                        _("Il sito ha risposto con un errore (%s).") % response.status_code
                    )
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise ImageError(_("Il file del link e' troppo grande."))
                content_type = response.headers.get("content-type", "").split(";")[0]
                return Fetched(url, content_type.strip().lower(), bytes(body))
            finally:
                response.close()
    except httpx.TimeoutException:
        raise ReadError(_("Il sito non risponde.")) from None
    except httpx.HTTPError:
        raise ReadError(_("Non riesco a leggere il link.")) from None


def fetch(url: str, max_bytes: int) -> Fetched:
    """GET con i redirect seguiti a mano, ognuno ricontrollato."""
    for _hop in range(MAX_REDIRECTS + 1):
        result = _get(url, max_bytes)
        if isinstance(result, Fetched):
            return result
        location = result.headers.get("location")
        if not location:
            raise ImageError(_("Non riesco a leggere il link."))
        url = urljoin(url, location)
    raise ImageError(_("Il link rimanda troppe volte altrove."))


# ------------------------------------------------- immagine di una pagina --


class _MetaImageParser(HTMLParser):
    """Raccoglie le immagini che una pagina dichiara per le anteprime."""

    PRIORITY = ("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src")

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.others: list[str] = []
        self._json_ld: list[str] | None = None
        self.json_ld: list[str] = []

    def handle_starttag(self, tag, attrs):
        values = {key.lower(): (value or "") for key, value in attrs}
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            if key in self.PRIORITY and values.get("content"):
                self.meta.setdefault(key, values["content"])
            elif values.get("itemprop") == "image" and values.get("content"):
                self.others.append(values["content"])
        elif tag == "link" and values.get("rel", "").lower() == "image_src" and values.get("href"):
            self.others.append(values["href"])
        elif tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._json_ld = []

    def handle_data(self, data):
        if self._json_ld is not None:
            self._json_ld.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._json_ld is not None:
            self.json_ld.append("".join(self._json_ld))
            self._json_ld = None


def _json_ld_images(blobs: list[str]) -> list[str]:
    found: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            image = node.get("image")
            if isinstance(image, str):
                found.append(image)
            elif isinstance(image, list):
                for item in image:
                    if isinstance(item, str):
                        found.append(item)
                    elif isinstance(item, dict) and isinstance(item.get("url"), str):
                        found.append(item["url"])
            elif isinstance(image, dict) and isinstance(image.get("url"), str):
                found.append(image["url"])
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
    return [url for url in found if url]


def find_page_image(html: str, base_url: str) -> str | None:
    """L'immagine "di anteprima" di una pagina: og:image, poi le altre."""
    parser = _MetaImageParser()
    try:
        parser.feed(html)
    except Exception:
        pass
    candidates = [parser.meta[key] for key in parser.PRIORITY if key in parser.meta]
    candidates += _json_ld_images(parser.json_ld) + parser.others
    for candidate in candidates:
        candidate = candidate.strip()
        if candidate and not candidate.startswith("data:"):
            return urljoin(base_url, candidate)
    return None


_CHARSET = re.compile(rb"charset=[\"']?([\w-]+)", re.I)


def _decode(body: bytes) -> str:
    match = _CHARSET.search(body[:2048])
    encoding = match.group(1).decode("ascii") if match else "utf-8"
    try:
        return body.decode(encoding, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def _image_direct(url: str) -> tuple[ContentFile, str]:
    """Lettura semplice: il link e' l'immagine, o una pagina che la dichiara."""
    first = fetch(url, max(settings.IMAGE_MAX_BYTES, MAX_HTML_BYTES))
    if "html" not in first.content_type:
        # image/* o un tipo generico (certi CDN mandano octet-stream): decide Pillow.
        if first.content_type.startswith(("image/", "application/octet-stream", "binary/")):
            return process_image(first.body), first.url
        raise ImageError(_("Il link non e' ne' un'immagine ne' una pagina web."))

    image_url = find_page_image(_decode(first.body), first.url)
    if not image_url:
        raise ReadError(
            _("In quella pagina non trovo un'immagine del prodotto: caricala tu dal telefono.")
        )
    second = fetch(image_url, settings.IMAGE_MAX_BYTES)
    if "html" in second.content_type:
        raise ReadError(_("L'immagine indicata dalla pagina non si apre."))
    return process_image(second.body), second.url


def scrape(url: str) -> dict:
    """Chiede allo scraper (ADR 0005) di aprire la pagina col browser.

    Restituisce quello che ha letto: ``images`` (in ordine di affidabilita'),
    ``title``, ``description``, ``price``, ``currency``, ``blocked``. Lo
    scraper e' un servizio interno: la richiesta non passa da ``fetch``.
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


def _image_scraped(url: str) -> tuple[ContentFile, str]:
    """La pagina aperta dallo scraper; la foto la scarica comunque ``fetch``."""
    page = scrape(url)
    if page.get("blocked"):
        raise ImageError(
            _(
                "Il sito chiede di dimostrare di non essere un robot: carica la foto, "
                "oppure incolla il link diretto dell'immagine (tasto destro sulla "
                "foto → Copia indirizzo immagine)."
            )
        )
    status = page.get("status")
    if not page.get("images") and status and status >= 400:
        raise ReadError(_("Il sito ha risposto con un errore (%s).") % status)
    for candidate in page.get("images", [])[:4]:
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
    """Dal link (di un'immagine o della pagina di un negozio) all'immagine pronta.

    Prima la lettura diretta, che e' veloce; se il sito blocca o la foto non si
    trova, la pagina si apre col browser dello scraper. Gli errori sul link in
    se' (indirizzo non pubblico, porta, credenziali) non arrivano allo scraper.
    Restituisce il file elaborato e l'URL da cui e' arrivata davvero.
    """
    try:
        return _image_direct(url)
    except ReadError as direct:
        if not settings.SCRAPER_URL:
            raise
        direct_error = direct
    try:
        return _image_scraped(url)
    except ScraperDown:
        raise direct_error from None
