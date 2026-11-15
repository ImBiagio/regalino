"""L'estensione Chrome: chiave, liste, pagina letta, regalo aggiunto, import (ADR 0016)."""

from __future__ import annotations

import uuid

import pytest

from apps.conftest import WishListFactory
from apps.core import cornhub
from apps.gifts.models import ExtensionToken, Wish, WishListMember
from apps.gifts.tests.conftest import PUBLIC_IP, png_bytes

pytestmark = pytest.mark.django_db

PRODUCT = b"""<html><head><title>Borraccia | Negozio</title>
<meta property="og:title" content="Borraccia termica 750 ml">
<meta property="og:image" content="https://img.negozio.it/borraccia.png">
<meta property="product:price:amount" content="24.90">
<meta property="product:price:currency" content="EUR">
</head><body>Borraccia</body></html>"""


@pytest.fixture(autouse=True)
def cornhub_account(db, user, monkeypatch):
    """L'utente e' legato al suo account cornhub; ``status`` e' cio' che cornhub
    risponde al controllo dell'account (ADR 0020)."""
    user.cornhub_sub = uuid.uuid4()
    user.save()
    status = {"active": True, "allowed": True}
    monkeypatch.setattr(cornhub, "user_status", lambda sub: status)
    return status


@pytest.fixture
def key(user, api):
    response = api(user).post("/api/extension/tokens", {"name": "Chrome su Mac"}, format="json")
    assert response.status_code == 201
    return response.data["key"]


def ext(api, key):
    client = api()
    client.credentials(HTTP_AUTHORIZATION=f"Token {key}")
    return client


def test_la_chiave_si_vede_una_volta_e_si_salva_solo_l_hash(user, api, key):
    token = ExtensionToken.objects.get(user=user)
    assert token.key_hash != key and len(token.key_hash) == 64
    listed = api(user).get("/api/extension/tokens").data
    assert listed[0]["name"] == "Chrome su Mac"
    assert "key" not in listed[0]


def test_me_e_le_liste_scrivibili(user, other_user, api, key):
    mine = WishListFactory(owner=user, title="Mia")
    shared = WishListFactory(owner=other_user, title="Insieme")
    WishListMember.objects.create(wish_list=shared, user=user)
    WishListFactory(owner=other_user, title="Altrui")
    client = ext(api, key)
    assert client.get("/api/extension/me").data["email"] == user.email
    titles = {row["title"] for row in client.get("/api/extension/lists").data}
    assert titles == {"Mia", "Insieme"}
    assert mine.pk


def test_la_chiave_vale_solo_per_l_estensione(user, api, key):
    client = ext(api, key)
    assert client.get("/api/lists").status_code == 401
    assert client.get("/api/ideas").status_code == 401
    # Nemmeno per creare altre chiavi.
    assert client.post("/api/extension/tokens", {}, format="json").status_code == 401


def test_chiave_tolta_o_sbagliata(user, api, key):
    token = ExtensionToken.objects.get(user=user)
    assert api(user).delete(f"/api/extension/tokens/{token.pk}").status_code == 204
    response = ext(api, key).get("/api/extension/me")
    assert response.status_code == 401
    assert ext(api, "inventata").get("/api/extension/me").status_code == 401
    assert api().get("/api/extension/me").status_code == 401


def test_account_spento_su_cornhub_perde_l_estensione(user, api, key, cornhub_account):
    client = ext(api, key)
    assert client.get("/api/extension/me").status_code == 200
    cornhub_account["allowed"] = False
    response = client.get("/api/extension/me")
    # 401 (non 403): l'estensione capisce che va ricollegata.
    assert response.status_code == 401
    assert response["WWW-Authenticate"] == "Token"
    # Un utente mai entrato da cornhub non ha un account da controllare.
    cornhub_account["allowed"] = True
    user.cornhub_sub = None
    user.save()
    assert client.get("/api/extension/me").status_code == 401


def test_non_si_tolgono_le_chiavi_altrui(user, other_user, api, key):
    token = ExtensionToken.objects.get(user=user)
    assert api(other_user).delete(f"/api/extension/tokens/{token.pk}").status_code == 404


def test_legge_la_pagina_aperta_nel_browser(user, api, key, dns, web):
    dns["img.negozio.it"] = PUBLIC_IP
    web["https://img.negozio.it/borraccia.png"] = (
        200, {"content-type": "image/png"}, png_bytes(),
    )  # fmt: skip
    response = ext(api, key).post(
        "/api/extension/read",
        {"url": "https://www.negozio.it/borraccia", "html": PRODUCT.decode()},
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["title"] == "Borraccia termica 750 ml"
    assert response.data["price"] == "24.90"
    assert response.data["image"]["source_url"] == "https://img.negozio.it/borraccia.png"
    # La pagina non si e' riletta dal server: solo la foto.
    assert [r.headers["host"] for r in web.seen] == ["img.negozio.it"]


def test_aggiunge_il_regalo_alla_lista(user, other_user, api, key, wish_list):
    client = ext(api, key)
    body = {
        "title": "Borraccia",
        "url": "https://www.negozio.it/borraccia?utm_source=x",
        "price": "24.90",
        "quantity": 2,
        "notes": "Blu",
    }
    response = client.post(f"/api/extension/lists/{wish_list.pk}/items", body, format="json")
    assert response.status_code == 201, response.data
    assert response.data["list_title"] == wish_list.title
    wish = Wish.objects.get(pk=response.data["id"])
    assert wish.url == "https://www.negozio.it/borraccia"
    assert wish.quantity == 2
    assert wish.price_points.count() == 1
    other = WishListFactory(owner=other_user)
    assert (
        client.post(f"/api/extension/lists/{other.pk}/items", body, format="json").status_code
        == 404
    )


def test_import_dall_estensione(user, api, key):
    client = ext(api, key)
    tree = [{"title": "Natale", "items": [{"title": "Sciarpa"}]}]
    response = client.post("/api/extension/imports", {"lists": tree}, format="json")
    assert response.status_code == 201, response.data
    assert response.data[0]["title"] == "Natale"


# Come Amazon: niente og:image ne' prezzo nei meta, solo il nome nel DOM.
AMAZON_LIKE = """<html><head><title>Cuffie : Amazon.it: Elettronica</title></head>
<body><span id="productTitle">Cuffie senza fili</span><img id="landingImage"></body></html>"""


def test_foto_e_prezzo_visti_dall_estensione(user, api, key, dns, web, scraper):
    dns["m.media-amazon.com"] = PUBLIC_IP
    web["https://m.media-amazon.com/images/I/cuffie.png"] = (
        200, {"content-type": "image/png"}, png_bytes(),
    )  # fmt: skip
    response = ext(api, key).post(
        "/api/extension/read",
        {
            "url": "https://www.amazon.it/dp/B000000001",
            "html": AMAZON_LIKE,
            "images": ["javascript:alert(1)", "https://m.media-amazon.com/images/I/cuffie.png"],
            "price": "59,99 €",
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["title"] == "Cuffie senza fili"
    assert response.data["price"] == "59.99"
    assert response.data["image"]["source_url"] == "https://m.media-amazon.com/images/I/cuffie.png"
    # Bastava la pagina vista dal browser: niente rilettura dal server.
    assert scraper.asked == []
    assert [r.headers["host"] for r in web.seen] == ["m.media-amazon.com"]


def test_senza_foto_il_server_rilegge_il_link(user, api, key, dns, web, scraper):
    dns["www.negozio.it"] = dns["img.negozio.it"] = PUBLIC_IP
    # Il sito risponde al server come a un robot: legge lo scraper.
    web["https://www.negozio.it/borraccia"] = (503, {"content-type": "text/html"}, b"robot?")
    web["https://img.negozio.it/borraccia.png"] = (
        200, {"content-type": "image/png"}, png_bytes(),
    )  # fmt: skip
    scraper.page = {
        "images": ["https://img.negozio.it/borraccia.png"],
        "price": "19.90",
        "currency": "EUR",
        "status": 200,
    }
    response = ext(api, key).post(
        "/api/extension/read",
        {
            "url": "https://www.negozio.it/borraccia",
            "html": "<html><head><title>Borraccia blu</title></head><body></body></html>",
            "price": "24,90",
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert response.data["title"] == "Borraccia blu"
    # Il prezzo visto nel browser vince su quello riletto; la foto arriva dal server.
    assert response.data["price"] == "24.90"
    assert response.data["image"]["source_url"] == "https://img.negozio.it/borraccia.png"
    assert scraper.asked == ["https://www.negozio.it/borraccia"]
