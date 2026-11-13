"""Import di liste da Amazon, Elfster (o altre pagine) e file (ADR 0015)."""

from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.gifts import ai, imports
from apps.gifts.models import Wish, WishList
from apps.gifts.tests.conftest import PUBLIC_IP, png_bytes

pytestmark = pytest.mark.django_db

AMAZON_URL = "https://www.amazon.it/hz/wishlist/ls/3ABCDEF12345"


def amazon_item(item_id, asin, title, price, image="", comment="", requested=""):
    return f"""
    <li data-id="X" data-itemid="{item_id}" data-price="{price}">
      <div id="itemImage_{item_id}"><a href="/dp/{asin}"><img src="{image}" alt=""></a></div>
      <h2><a id="itemName_{item_id}" title="{title}" href="/dp/{asin}/?coliid={item_id}&ref_=wl">
        {title[:10]}</a></h2>
      <span id="itemComment_{item_id}">{comment}</span>
      <span id="itemRequested_{item_id}">{requested}</span>
    </li>"""


AMAZON_PAGE_1 = f"""<html><head><title>Lista</title></head><body>
  <span id="profile-list-name">Compleanno di Anna</span>
  <ul id="g-items">
    {amazon_item("I1", "B000000001", "Echo Dot (5a generazione)", "64.99",
                 "https://m.media-amazon.com/images/I/dot.jpg", "Colore antracite", "Richiesti: 2")}
    {amazon_item("I2", "B000000002", "Libro di cucina", "-Infinity")}
  </ul>
  <input type="hidden" name="showMoreUrl" value="/hz/wishlist/slv/items?lid=3ABCDEF12345&page=2">
</body></html>""".encode()

AMAZON_PAGE_2 = f"""<ul>
    {amazon_item("I3", "B000000003", "Tazza", "9.90")}
</ul>""".encode()


@pytest.fixture
def amazon(dns, web):
    dns["www.amazon.it"] = PUBLIC_IP
    html = {"content-type": "text/html; charset=utf-8"}
    web[AMAZON_URL] = (200, html, AMAZON_PAGE_1)
    web["https://www.amazon.it/hz/wishlist/slv/items?lid=3ABCDEF12345&page=2"] = (
        200, html, AMAZON_PAGE_2,
    )  # fmt: skip
    return web


def read(client, **data):
    response = client.post("/api/imports/read", data, format="json")
    if response.status_code == 202:
        response = client.get(f"/api/imports/read/{response.data['job_id']}")
    return response


# ----------------------------------------------------------------- Amazon --


def test_lista_amazon_con_le_pagine_successive(user, api, amazon):
    response = read(api(user), url=AMAZON_URL)
    assert response.status_code == 200, response.data
    assert response.data["status"] == "done", response.data
    [wishlist] = response.data["lists"]
    assert wishlist["title"] == "Compleanno di Anna"
    titles = [item["title"] for item in wishlist["items"]]
    assert titles == ["Echo Dot (5a generazione)", "Libro di cucina", "Tazza"]
    dot = wishlist["items"][0]
    assert dot["url"] == "https://www.amazon.it/dp/B000000001"
    assert dot["price"] == "64.99"
    assert dot["quantity"] == 2
    assert dot["notes"] == "Colore antracite"
    assert dot["image_url"] == "https://m.media-amazon.com/images/I/dot.jpg"
    # "-Infinity": Amazon non ha un prezzo unico, si lascia vuoto.
    assert wishlist["items"][1]["price"] is None


def test_lista_amazon_con_le_altre_liste_della_persona(user, api, amazon):
    # Dall'estensione, sulla propria lista: accanto c'e' l'elenco delle altre.
    other = "https://www.amazon.it/hz/wishlist/ls/9ZZZZZZZZZZZ"
    amazon[other] = (200, {"content-type": "text/html"}, AMAZON_PAGE_2.replace(
        b"<ul>", b'<span id="profile-list-name">Libri</span><ul>'
    ))  # fmt: skip
    nav = (
        '<a href="/hz/wishlist/ls/3ABCDEF12345?ref_=wl">Compleanno di Anna</a>'
        '<a href="/hz/wishlist/ls/9ZZZZZZZZZZZ?ref_=wl">Libri</a>'
        '<a href="/hz/wishlist/ls/8PRIVATA0000?ref_=wl">Privata</a>'
    )
    html = AMAZON_PAGE_1.decode().replace("<ul", nav + "<ul", 1)
    response = read(api(user), url=AMAZON_URL, html=html)
    [wishlist] = response.data["lists"]
    assert [child["title"] for child in wishlist["lists"]] == ["Libri"]
    assert wishlist["lists"][0]["items"][0]["title"] == "Tazza"


def test_lista_amazon_vuota_o_privata(user, api, dns, web):
    dns["www.amazon.it"] = PUBLIC_IP
    web[AMAZON_URL] = (200, {"content-type": "text/html"}, b"<html><body>Accedi</body></html>")
    response = read(api(user), url=AMAZON_URL)
    assert response.data["status"] == "error"
    assert "pubblica" in response.data["error"]


def test_amazon_in_dollari_senza_prezzo(dns, web):
    items = imports.parse_amazon(
        AMAZON_PAGE_1.decode(), "https://www.amazon.com/hz/wishlist/ls/3ABCDEF12345"
    )[1]
    assert items[0].price is None


def test_la_lettura_e_solo_di_chi_l_ha_chiesta(user, other_user, api, amazon):
    response = api(user).post("/api/imports/read", {"url": AMAZON_URL}, format="json")
    job = response.data["job_id"]
    assert api(other_user).get(f"/api/imports/read/{job}").status_code == 404
    assert api().get(f"/api/imports/read/{job}").status_code == 401


# --------------------------------------------- Elfster e pagine qualsiasi --

ELFSTER_PROFILE = "https://www.elfster.com/u/anna/"
ELFSTER_LIST = "https://www.elfster.com/u/anna/w/natale/"

PROFILE_HTML = """<html><body><h1>Anna</h1>
  <a href="/u/anna/w/natale/">Natale</a>
  <a href="/u/anna/w/compleanno/">Compleanno</a>
  <a href="https://altro.sito/u/x/w/y/">Fuori</a>
</body></html>"""

LIST_HTML = """<html><body><h1>Natale</h1>
  <div><img src="https://img.elfster.com/lego.jpg" alt="Lego">
    <a href="https://www.negozio.it/lego?utm_source=elfster">Lego Titanic</a> 49,99 €
    Taglia unica</div>
  <div><a href="https://www.negozio.it/sciarpa">Sciarpa</a></div>
  <aside><a href="/shop">Shop Elfster</a></aside>
</body></html>"""


@pytest.fixture
def gemini(settings, monkeypatch):
    """Gemini finto: ``gemini.answers[url]`` e' quello che "legge" in ogni pagina."""
    settings.GEMINI_API_KEY = "chiave-di-prova"

    class Fake:
        answers: dict = {}
        asked: list[str] = []

    def fake_post(url, **kwargs):
        assert url.startswith("https://generativelanguage.googleapis.com/")
        text = kwargs["json"]["contents"][0]["parts"][0]["text"]
        page = text.split("\n", 1)[0].removeprefix("Link: ")
        Fake.asked.append(text)
        answer = json.dumps(Fake.answers.get(page, {"items": []}))
        body = {"candidates": [{"content": {"parts": [{"text": answer}]}}]}
        return httpx.Response(200, json=body)

    Fake.answers = {}
    Fake.asked = []
    monkeypatch.setattr(ai.httpx, "post", fake_post)
    return Fake


@pytest.fixture
def browser(monkeypatch):
    """Il browser dello scraper finto: ``browser.pages[url]`` e' l'HTML costruito."""

    class Fake:
        pages: dict = {}
        asked: list[str] = []

    def fake_scrape_html(url):
        Fake.asked.append(url)
        if url not in Fake.pages:
            raise imports.ReadError("non trovata")
        return Fake.pages[url], url

    Fake.pages = {}
    Fake.asked = []
    monkeypatch.setattr(imports, "scrape_html", fake_scrape_html)
    return Fake


LIST_ANSWER = {
    "title": "Natale",
    "items": [
        {
            "title": "Lego Titanic",
            "url": "https://www.negozio.it/lego",
            "image": "https://img.elfster.com/lego.jpg",
            "price": "49.99",
            "currency": "EUR",
            "quantity": 1,
            "notes": "Taglia unica",
        },
        # Link e foto inventati da Gemini: il regalo resta, link e foto no.
        {
            "title": "Sciarpa",
            "url": "https://www.inventato.it/x",
            "image": "https://img.inventate.it/s.jpg",
        },
        {"title": ""},
    ],
}


def test_lista_elfster_letta_col_browser_e_gemini(user, api, gemini, browser):
    browser.pages[ELFSTER_LIST] = LIST_HTML
    gemini.answers[ELFSTER_LIST] = LIST_ANSWER
    response = read(api(user), url=ELFSTER_LIST)
    assert response.data["status"] == "done", response.data
    [wishlist] = response.data["lists"]
    assert wishlist["title"] == "Natale"
    lego, scarf = wishlist["items"]
    assert lego["url"] == "https://www.negozio.it/lego"  # ripulito dal tracciamento
    assert lego["image_url"] == "https://img.elfster.com/lego.jpg"
    assert lego["price"] == "49.99"
    assert scarf["url"] == "" and scarf["image_url"] == ""
    # A Gemini va la pagina compatta, coi link veri accanto al testo.
    assert "[Lego Titanic](https://www.negozio.it/lego)" in gemini.asked[0]
    # Elfster e' fatta in JavaScript: subito il browser.
    assert browser.asked == [ELFSTER_LIST]


def test_profilo_con_piu_liste_diventa_liste_dentro_una_lista(user, api, gemini, browser):
    browser.pages[ELFSTER_PROFILE] = PROFILE_HTML
    browser.pages[ELFSTER_LIST] = LIST_HTML
    browser.pages["https://www.elfster.com/u/anna/w/compleanno/"] = LIST_HTML
    gemini.answers[ELFSTER_PROFILE] = {"title": "Le liste di Anna", "items": []}
    gemini.answers[ELFSTER_LIST] = LIST_ANSWER
    gemini.answers["https://www.elfster.com/u/anna/w/compleanno/"] = {
        "title": "Compleanno",
        "items": [{"title": "Profumo"}],
    }
    response = read(api(user), url=ELFSTER_PROFILE)
    assert response.data["status"] == "done", response.data
    [profile] = response.data["lists"]
    assert profile["title"] == "Le liste di Anna"
    assert profile["items"] == []
    assert sorted(child["title"] for child in profile["lists"]) == ["Compleanno", "Natale"]
    # Solo le liste dello stesso sito.
    assert "https://altro.sito/u/x/w/y/" not in browser.asked


def test_pagina_senza_gemini(user, api, browser):
    browser.pages[ELFSTER_LIST] = LIST_HTML
    response = read(api(user), url=ELFSTER_LIST)
    assert response.data["status"] == "error"
    assert "Gemini" in response.data["error"]


def test_itemlist_dichiarata_senza_gemini(user, api, dns, web):
    dns["www.negozio.it"] = PUBLIC_IP
    page = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Lista nozze",
        "itemListElement": [
            {"@type": "ListItem", "item": {
                "@type": "Product", "name": "Pentola", "url": "/pentola",
                "offers": {"price": "89.00", "priceCurrency": "EUR"}}},
        ],
    }  # fmt: skip
    html = f'<script type="application/ld+json">{json.dumps(page)}</script>'.encode()
    web["https://www.negozio.it/lista"] = (200, {"content-type": "text/html"}, html)
    response = read(api(user), url="https://www.negozio.it/lista")
    [wishlist] = response.data["lists"]
    assert wishlist["title"] == "Lista nozze"
    assert wishlist["items"][0]["url"] == "https://www.negozio.it/pentola"
    assert wishlist["items"][0]["price"] == "89.00"


def test_dall_estensione_arriva_la_pagina_gia_costruita(user, api, gemini, browser):
    gemini.answers[ELFSTER_LIST] = LIST_ANSWER
    response = read(api(user), url=ELFSTER_LIST, html=LIST_HTML)
    assert response.data["status"] == "done", response.data
    assert browser.asked == []  # il server non riapre la pagina


# ------------------------------------------------------------------- file --


def upload(client, name, content: bytes):
    return client.post(
        "/api/imports/read", {"file": SimpleUploadedFile(name, content)}, format="multipart"
    )


def test_csv_con_le_liste_annidate(user, api):
    content = (
        "lista;nome;link;prezzo;quantità;note\n"
        "Natale > Libri;Il nome della rosa;https://www.libri.it/rosa;12,50;1;copertina rigida\n"
        "Natale > Libri;Dune;;9.90;;\n"
        "Natale;Sciarpa;;;2;\n"
        "Compleanno;Profumo;;€ 45;;\n"
        ";;;;;\n"
    ).encode()
    response = upload(api(user), "regali.csv", content)
    assert response.status_code == 200, response.data
    natale, compleanno = response.data["lists"]
    assert natale["title"] == "Natale"
    assert [item["title"] for item in natale["items"]] == ["Sciarpa"]
    assert natale["items"][0]["quantity"] == 2
    [libri] = natale["lists"]
    assert libri["title"] == "Libri"
    assert libri["items"][0]["price"] == "12.50"
    assert libri["items"][0]["notes"] == "copertina rigida"
    assert compleanno["items"][0]["price"] == "45.00"


def test_csv_senza_colonna_lista_usa_il_nome_del_file(user, api):
    response = upload(api(user), "lista_di_anna.csv", b"title,url\nLego,https://x.it/lego\n")
    [wishlist] = response.data["lists"]
    assert wishlist["title"] == "lista di anna"


def test_csv_senza_nome_del_regalo(user, api):
    response = upload(api(user), "regali.csv", b"link,prezzo\nhttps://x.it,3\n")
    assert response.status_code == 400
    assert "colonna" in str(response.data["file"][0])


def test_json_con_liste_dentro_liste(user, api):
    data = {
        "lists": [
            {
                "title": "Natale",
                "items": [{"name": "Sciarpa", "price": 20}],
                "lists": [{"title": "Libri", "items": [{"title": "Dune", "url": "https://x.it/d"}]}],
            }
        ]
    }
    response = upload(api(user), "export.json", json.dumps(data).encode())
    [natale] = response.data["lists"]
    assert natale["items"][0]["title"] == "Sciarpa"
    assert natale["items"][0]["price"] == "20.00"
    assert natale["lists"][0]["items"][0]["url"] == "https://x.it/d"


def test_json_rotto_o_vuoto(user, api):
    assert upload(api(user), "x.json", b"{rotto").status_code == 400
    assert upload(api(user), "x.json", b"[]").status_code == 400


def test_serve_un_link_o_un_file(user, api):
    assert api(user).post("/api/imports/read", {}, format="json").status_code == 400
    assert api().post("/api/imports/read", {}, format="json").status_code == 401


# --------------------------------------------------------------- creare --

TREE = [
    {
        "title": "Natale",
        "items": [{"title": "Sciarpa", "price": "20.00", "quantity": 2}],
        "lists": [
            {
                "title": "Libri",
                "items": [{"title": "Dune", "url": "https://www.libri.it/dune?utm_source=x"}],
                "lists": [{"title": "Fumetti", "items": [{"title": "Tex"}]}],
            },
            {"title": "Vuota", "items": []},
        ],
    },
    {"title": "Compleanno", "items": [{"title": "Profumo"}]},
]


def test_crea_le_liste_con_le_incluse(
    user, api, monkeypatch, django_capture_on_commit_callbacks
):
    images = []
    monkeypatch.setattr(
        imports_tasks(), "schedule_import_images", lambda jobs: images.extend(jobs)
    )
    with django_capture_on_commit_callbacks(execute=True):
        response = api(user).post("/api/imports", {"lists": TREE}, format="json")
    assert response.status_code == 201, response.data
    assert [entry["title"] for entry in response.data] == ["Natale", "Compleanno"]
    natale = WishList.objects.get(owner=user, title="Natale")
    # Un livello solo (ADR 0008): i "Fumetti" dentro "Libri" salgono sotto "Natale".
    assert sorted(child.title for child in natale.included_lists.all()) == ["Fumetti", "Libri"]
    # Le liste vuote che servivano solo da contenitore non si creano.
    assert not WishList.objects.filter(title="Vuota").exists()
    sciarpa = Wish.objects.get(title="Sciarpa")
    assert sciarpa.quantity == 2
    assert sciarpa.price == Decimal("20.00")
    assert sciarpa.price_points.count() == 1  # il primo punto dell'andamento
    dune = Wish.objects.get(title="Dune")
    assert dune.url == "https://www.libri.it/dune"
    # La foto del regalo col link la prende il worker, dopo.
    assert images == [(str(dune.pk), "https://www.libri.it/dune")]


def test_crea_tutto_dentro_una_lista_nuova(user, api):
    response = api(user).post(
        "/api/imports", {"lists": TREE, "group_title": "Da Elfster"}, format="json"
    )
    assert response.status_code == 201, response.data
    [parent] = response.data
    assert parent["title"] == "Da Elfster"
    group = WishList.objects.get(pk=parent["id"])
    assert sorted(child.title for child in group.included_lists.all()) == [
        "Compleanno", "Fumetti", "Libri", "Natale",
    ]  # fmt: skip
    assert group.items.count() == 0


def test_creare_chiede_almeno_una_lista_e_l_account(user, api):
    assert api(user).post("/api/imports", {"lists": []}, format="json").status_code == 400
    assert api().post("/api/imports", {"lists": TREE}, format="json").status_code == 401


def test_quantita_e_prezzo_controllati(user, api):
    bad = [{"title": "X", "items": [{"title": "Y", "quantity": 500, "price": "-3"}]}]
    assert api(user).post("/api/imports", {"lists": bad}, format="json").status_code == 400


def test_foto_del_regalo_importato(user, dns, web):
    dns["img.negozio.it"] = PUBLIC_IP
    web["https://img.negozio.it/a.png"] = (200, {"content-type": "image/png"}, png_bytes())
    wish_list = WishList.objects.create(owner=user, title="L")
    wish = Wish.objects.create(wish_list=wish_list, title="A")
    assert imports_tasks().attach_import_image(str(wish.pk), "https://img.negozio.it/a.png")
    wish.refresh_from_db()
    assert wish.image is not None and wish.image.owner == user


def imports_tasks():
    from apps.gifts import tasks

    return tasks
