"""Internet, DNS e scraper finti per i test di foto e link (ADR 0003, 0005)."""

from __future__ import annotations

import socket
from io import BytesIO

import httpx
import pytest
from PIL import Image

from apps.gifts import images, links

PUBLIC_IP = "93.184.215.14"


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def png_bytes(size=(2000, 1000), color=(200, 30, 80, 255), mode="RGBA") -> bytes:
    out = BytesIO()
    Image.new(mode, size, color).save(out, format="PNG")
    return out.getvalue()


@pytest.fixture
def dns(monkeypatch):
    """Risolutore finto: ``dns["host"] = "ip"``. Gli host sconosciuti non esistono."""
    table: dict[str, str] = {}

    def fake_getaddrinfo(host, port, *args, **kwargs):
        if host not in table:
            raise socket.gaierror("sconosciuto")
        family = socket.AF_INET6 if ":" in table[host] else socket.AF_INET
        return [(family, socket.SOCK_STREAM, 6, "", (table[host], port))]

    monkeypatch.setattr(images.socket, "getaddrinfo", fake_getaddrinfo)
    return table


class FakeWeb(dict):
    """``web["https://host/path"] = (status, headers, body)`` + le richieste viste."""

    def __init__(self):
        super().__init__()
        self.seen: list[httpx.Request] = []


@pytest.fixture
def web(monkeypatch):
    """Internet finta: registra le richieste, cosi' si vede a quale IP ci si collega."""
    pages = FakeWeb()
    seen = pages.seen

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        url = f"{request.url.scheme}://{request.headers['host']}{request.url.raw_path.decode()}"
        status, headers, body = pages.get(url, (404, {}, b""))
        return httpx.Response(status, headers=headers, content=body)

    real_client = httpx.Client

    def client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(images.httpx, "Client", client)
    return pages


@pytest.fixture
def scraper(settings, monkeypatch):
    """Scraper finto: ``scraper.page`` e' quello che "vede" il browser."""
    settings.SCRAPER_URL = "http://scraper:8000"

    class Fake:
        page: dict = {"images": [], "blocked": False, "status": 200}
        asked: list[str] = []

    def fake_scrape(url):
        Fake.asked.append(url)
        return Fake.page

    Fake.asked = []
    monkeypatch.setattr(links, "scrape", fake_scrape)
    return Fake
