"""Foto dei regali: upload, presa dal link, protezione SSRF, pulizia (ADR 0003)."""

from __future__ import annotations

import os
import socket
from datetime import timedelta
from io import BytesIO

import httpx
import pytest
from django.utils import timezone
from PIL import Image

from apps.conftest import GiftIdeaFactory, UserFactory, WishFactory
from apps.gifts import images
from apps.gifts.models import GiftImage
from apps.gifts.tasks import delete_orphan_images

pytestmark = pytest.mark.django_db

PUBLIC_IP = "93.184.215.14"


@pytest.fixture(autouse=True)
def media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    return tmp_path


def png_bytes(size=(2000, 1000), color=(200, 30, 80, 255), mode="RGBA") -> bytes:
    out = BytesIO()
    Image.new(mode, size, color).save(out, format="PNG")
    return out.getvalue()


def jpeg_with_gps() -> bytes:
    image = Image.new("RGB", (800, 600), (10, 120, 200))
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (44.0, 42.0, 0.0)}  # GPSInfo
    exif[0x0112] = 6  # Orientation: ruotata di 90°
    out = BytesIO()
    image.save(out, format="JPEG", exif=exif)
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


# ------------------------------------------------------------ elaborazione --


def test_upload_riduce_converte_e_toglie_i_metadati(user, api, media):
    response = api(user).post(
        "/api/images", {"file": BytesIO(jpeg_with_gps())}, format="multipart"
    )
    assert response.status_code == 201, response.data
    assert response.data["url"].startswith("/media/images/")
    assert response.data["url"].endswith(".webp")
    image = GiftImage.objects.get(pk=response.data["id"])
    with Image.open(image.file.path) as saved:
        assert saved.format == "WEBP"
        # L'orientamento EXIF e' applicato: 800x600 ruotata diventa 600x800.
        assert saved.size == (600, 800)
        assert not saved.getexif()
    assert image.owner == user


def test_upload_grande_viene_ridotto_e_la_trasparenza_va_su_bianco(user, api):
    response = api(user).post(
        "/api/images", {"file": BytesIO(png_bytes(color=(0, 0, 0, 0)))}, format="multipart"
    )
    assert response.status_code == 201
    assert (response.data["width"], response.data["height"]) == (1280, 640)
    image = GiftImage.objects.get(pk=response.data["id"])
    with Image.open(image.file.path) as saved:
        assert saved.convert("RGB").getpixel((10, 10)) == (255, 255, 255)


def test_upload_di_un_file_che_non_e_un_immagine(user, api):
    response = api(user).post(
        "/api/images", {"file": BytesIO(b"%PDF-1.4 non sono una foto")}, format="multipart"
    )
    assert response.status_code == 400
    assert "file" in response.data
    assert GiftImage.objects.count() == 0


def test_upload_troppo_grande(user, api, settings):
    settings.IMAGE_MAX_BYTES = 1000
    response = api(user).post("/api/images", {"file": BytesIO(png_bytes())}, format="multipart")
    assert response.status_code == 400


def test_upload_serve_il_login(api):
    response = api().post("/api/images", {"file": BytesIO(png_bytes())}, format="multipart")
    assert response.status_code == 401


# ------------------------------------------------------- collegare la foto --


def _upload(client) -> str:
    return client.post("/api/images", {"file": BytesIO(png_bytes())}, format="multipart").data[
        "id"
    ]


def test_foto_collegata_al_regalo_e_visibile_dal_link(wish_list, user, api):
    client = api(user)
    image_id = _upload(client)
    wish = client.post(
        f"/api/lists/{wish_list.id}/items",
        {"title": "Lampada", "image_id": image_id},
        format="json",
    )
    assert wish.status_code == 201
    assert wish.data["image"].startswith("/media/images/")
    shared = api().get(f"/api/shared/{wish_list.share_token}").data
    assert shared["items"][0]["image"] == wish.data["image"]

    removed = client.patch(
        f"/api/lists/{wish_list.id}/items/{wish.data['id']}", {"image_id": None}, format="json"
    )
    assert removed.data["image"] is None


def test_la_foto_di_un_altro_non_si_collega(wish_list, user, api):
    stranger = UserFactory()
    image_id = _upload(api(stranger))
    response = api(user).post(
        f"/api/lists/{wish_list.id}/items", {"title": "X", "image_id": image_id}, format="json"
    )
    assert response.status_code == 400
    assert "image_id" in response.data
    idea = api(user).post(
        "/api/ideas", {"recipient": "Luca", "title": "Y", "image_id": image_id}, format="json"
    )
    assert idea.status_code == 400


def test_foto_sulle_idee(user, api):
    client = api(user)
    image_id = _upload(client)
    idea = client.post(
        "/api/ideas", {"recipient": "Luca", "title": "Vinile", "image_id": image_id}, format="json"
    )
    assert idea.status_code == 201
    assert idea.data["image"].endswith(".webp")


# ------------------------------------------------------------ dal link -----


def test_link_diretto_a_un_immagine(user, api, dns, web):
    dns["cdn.negozio.it"] = PUBLIC_IP
    web["https://cdn.negozio.it/foto.png"] = (200, {"content-type": "image/png"}, png_bytes())
    response = api(user).post(
        "/api/images/from-url", {"url": "https://cdn.negozio.it/foto.png"}, format="json"
    )
    assert response.status_code == 201, response.data
    assert response.data["source_url"] == "https://cdn.negozio.it/foto.png"
    # Ci si collega all'IP controllato, col nome giusto nell'Host.
    [request] = web.seen
    assert request.url.host == PUBLIC_IP
    assert request.headers["host"] == "cdn.negozio.it"
    assert request.extensions["sni_hostname"] == "cdn.negozio.it"


def test_pagina_del_negozio_con_og_image(user, api, dns, web):
    dns["www.negozio.it"] = PUBLIC_IP
    dns["img.negozio.it"] = PUBLIC_IP
    html = b"""<html><head>
      <meta property="og:title" content="Lampada">
      <meta property="og:image" content="https://img.negozio.it/lampada.png">
    </head><body>...</body></html>"""
    html_type = {"content-type": "text/html; charset=utf-8"}
    web["https://www.negozio.it/p/lampada"] = (200, html_type, html)
    web["https://img.negozio.it/lampada.png"] = (200, {"content-type": "image/png"}, png_bytes())
    response = api(user).post(
        "/api/images/from-url", {"url": "https://www.negozio.it/p/lampada"}, format="json"
    )
    assert response.status_code == 201, response.data
    assert response.data["source_url"] == "https://img.negozio.it/lampada.png"


def test_pagina_senza_immagine(user, api, dns, web):
    dns["www.negozio.it"] = PUBLIC_IP
    web["https://www.negozio.it/"] = (200, {"content-type": "text/html"}, b"<html></html>")
    response = api(user).post(
        "/api/images/from-url", {"url": "https://www.negozio.it/"}, format="json"
    )
    assert response.status_code == 400
    assert "caricala tu" in str(response.data["url"][0])


@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "192.168.1.1", "10.0.0.5", "172.17.0.2", "169.254.169.254", "100.64.0.1",
     "::1", "fd00::1", "::ffff:192.168.1.1", "0.0.0.0"],
)
def test_indirizzi_non_pubblici_rifiutati(user, api, dns, web, ip):
    dns["router.casa"] = ip
    response = api(user).post(
        "/api/images/from-url", {"url": "http://router.casa/"}, format="json"
    )
    assert response.status_code == 400
    assert web.seen == []


def test_redirect_verso_la_lan_rifiutato(user, api, dns, web):
    dns["www.negozio.it"] = PUBLIC_IP
    dns["interno.lan"] = "192.168.1.10"
    web["https://www.negozio.it/r"] = (302, {"location": "http://interno.lan/admin"}, b"")
    response = api(user).post(
        "/api/images/from-url", {"url": "https://www.negozio.it/r"}, format="json"
    )
    assert response.status_code == 400
    assert len(web.seen) == 1


@pytest.mark.parametrize(
    "url",
    ["ftp://negozio.it/a.png", "file:///etc/passwd", "https://negozio.it:8443/a.png",
     "https://utente:pass@negozio.it/a.png"],
)
def test_link_non_ammessi(user, api, dns, web, url):
    dns["negozio.it"] = PUBLIC_IP
    response = api(user).post("/api/images/from-url", {"url": url}, format="json")
    assert response.status_code == 400
    assert web.seen == []


def test_sito_con_protezione_anti_bot(user, api, dns, web):
    dns["www.negozio.it"] = PUBLIC_IP
    web["https://www.negozio.it/p"] = (403, {"content-type": "text/html"}, b"blocked")
    response = api(user).post(
        "/api/images/from-url", {"url": "https://www.negozio.it/p"}, format="json"
    )
    assert response.status_code == 400
    assert "Copia indirizzo immagine" in str(response.data["url"][0])


def test_find_page_image_priorita_e_url_relativi():
    html = """<html><head>
      <link rel="image_src" href="/fallback.jpg">
      <meta name="twitter:image" content="/tw.jpg">
      <script type="application/ld+json">{"@type": "Product", "image": ["/ld.jpg"]}</script>
    </head></html>"""
    assert images.find_page_image(html, "https://n.it/p/1") == "https://n.it/tw.jpg"
    only_ld = '<script type="application/ld+json">{"image": {"url": "/ld.jpg"}}</script>'
    assert images.find_page_image(only_ld, "https://n.it/p/1") == "https://n.it/ld.jpg"
    assert images.find_page_image("<p>niente</p>", "https://n.it/") is None


# ------------------------------------------------------------- pulizia -----


def test_pulizia_delle_foto_orfane(user, api):
    client = api(user)
    used_wish, used_idea, orphan, fresh = (_upload(client) for _ in range(4))
    WishFactory(image_id=used_wish).delete()  # eliminato logicamente: la foto resta
    GiftIdeaFactory(owner=user, image_id=used_idea)
    old = timezone.now() - timedelta(hours=30)
    GiftImage.objects.exclude(pk=fresh).update(created_at=old)
    orphan_path = GiftImage.objects.get(pk=orphan).file.path

    assert delete_orphan_images() == 1
    left = {str(pk) for pk in GiftImage.objects.values_list("pk", flat=True)}
    assert left == {used_wish, used_idea, fresh}
    assert not os.path.exists(orphan_path)
