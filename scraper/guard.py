"""Quali indirizzi il browser dello scraper puo' raggiungere (ADR 0005).

Il browser apre link scelti dagli utenti, e con la pagina carica tutto quello
che la pagina chiede: script, immagini, fetch. Dal homeserver si raggiungono
router, LAN e container accanto, quindi ogni richiesta passa da qui prima di
partire: solo http/https sulle porte 80/443, niente credenziali nell'URL, e il
nome deve risolversi solo in indirizzi pubblici. Le stesse regole di
``backend/apps/gifts/images.py``, che pero' qui non si puo' importare.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

# data: e blob: non escono dal browser: si lasciano passare.
LOCAL_SCHEMES = ("data", "blob", "about")


def is_public_ip(raw: str) -> bool:
    address = ipaddress.ip_address(raw)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    # is_global esclude privati, loopback, link-local, CGNAT, riservati.
    return address.is_global and not address.is_multicast


def resolve_public(host: str, port: int) -> bool:
    """Vero se ``host`` si risolve e *tutti* i suoi indirizzi sono pubblici."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        return False
    addresses = [info[4][0] for info in infos]
    return bool(addresses) and all(is_public_ip(address) for address in addresses)


def target_of(url: str) -> tuple[str, int] | None:
    """Host e porta di un URL ammesso, oppure ``None`` se l'URL non va aperto."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https", "ws", "wss") or not parts.hostname:
        return None
    if parts.username or parts.password:
        return None
    secure = parts.scheme in ("https", "wss")
    try:
        port = parts.port or (443 if secure else 80)
    except ValueError:
        return None
    if port not in (80, 443):
        return None
    return parts.hostname, port


class Guard:
    """Decide richiesta per richiesta, con una cache dei nomi gia' controllati."""

    def __init__(self, resolver=resolve_public):
        self._resolver = resolver
        self._seen: dict[tuple[str, int], bool] = {}

    def allows(self, url: str) -> bool:
        if urlsplit(url).scheme in LOCAL_SCHEMES:
            return True
        target = target_of(url)
        if target is None:
            return False
        if target not in self._seen:
            self._seen[target] = self._resolver(*target)
        return self._seen[target]
