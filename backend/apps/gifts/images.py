"""Foto dei regali: elaborazione e lettura sicura dei link (ADR 0003).

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
la connessione), rifacendo tutto a ogni redirect. Cosa si legge dalla pagina
di un link (foto, nome, prezzo) sta in ``links.py``.
"""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
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
