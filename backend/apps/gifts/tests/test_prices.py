"""Andamento del prezzo, campanella e avvisi (ADR 0011)."""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.core import mail

from apps.conftest import GiftIdeaFactory, UserFactory, WishFactory, WishListFactory
from apps.gifts import prices
from apps.gifts.models import Notification, PricePoint, PriceWatch, record_price
from apps.gifts.tasks import check_prices
from apps.gifts.tests.conftest import PUBLIC_IP

pytestmark = pytest.mark.django_db


def page(price: str) -> bytes:
    offer = f'{{"@type": "Offer", "price": "{price}", "priceCurrency": "EUR"}}'
    return f"""<html><head><title>Cuffie Wave | Negozio</title>
    <script type="application/ld+json">{{"@context": "https://schema.org", "@type": "Product",
    "name": "Cuffie Wave", "offers": {offer}}}</script></head>
    <body><h1>Cuffie Wave</h1></body></html>""".encode()


@pytest.fixture
def shop(dns, web):
    dns["www.negozio.it"] = PUBLIC_IP
    web["https://www.negozio.it/wave"] = (200, {"content-type": "text/html"}, page("99.00"))
    return web


def test_il_prezzo_iniziale_e_il_primo_punto(wish_list, user, api):
    client = api(user)
    created = client.post(
        f"/api/lists/{wish_list.id}/items", {"title": "Cuffie", "price": "120.00"}, format="json"
    )
    assert [p["price"] for p in created.data["price_history"]] == ["120.00"]
    assert created.data["watching"] is False
    # Senza prezzo niente punto; arrivato il prezzo, il primo punto.
    empty = client.post(f"/api/lists/{wish_list.id}/items", {"title": "Libro"}, format="json")
    assert empty.data["price_history"] == []
    updated = client.patch(
        f"/api/lists/{wish_list.id}/items/{empty.data['id']}", {"price": "15.00"}, format="json"
    )
    assert [p["price"] for p in updated.data["price_history"]] == ["15.00"]
    idea = client.post("/api/ideas", {"recipient": "Mamma", "title": "Vino", "price": "28.00"},
                       format="json")
    assert [p["price"] for p in idea.data["price_history"]] == ["28.00"]


def test_un_punto_nuovo_solo_se_il_prezzo_cambia(wish_list):
    wish = WishFactory(wish_list=wish_list, price="10.00")
    assert record_price(wish, Decimal("10.00")) is not None
    assert record_price(wish, Decimal("10.00")) is None
    assert record_price(wish, Decimal("9.00")) is not None
    assert PricePoint.objects.filter(wish=wish).count() == 2


def test_la_campanella_sul_link_e_sulla_lista(wish_list, user, other_user, api):
    wish = WishFactory(wish_list=wish_list)
    shared = f"/api/shared/{wish_list.share_token}/items/{wish.id}/watch"
    assert api().post(shared).status_code == 401
    guest = api(other_user)
    assert guest.post(shared).data["watching"] is True
    assert guest.post(shared).data["watching"] is True  # due volte, una campanella
    assert PriceWatch.objects.filter(user=other_user, wish=wish).count() == 1
    [item] = guest.get(f"/api/shared/{wish_list.share_token}").data["items"]
    assert item["watching"] is True
    assert api().get(f"/api/shared/{wish_list.share_token}").data["items"][0]["watching"] is False
    assert guest.delete(shared).data["watching"] is False

    owner = api(user)
    own = f"/api/lists/{wish_list.id}/items/{wish.id}/watch"
    assert owner.post(own).data["watching"] is True
    assert owner.delete(own).data["watching"] is False
    idea = GiftIdeaFactory(owner=user)
    assert owner.post(f"/api/ideas/{idea.id}/watch").data["watching"] is True
    assert api(other_user).post(f"/api/ideas/{idea.id}/watch").status_code == 404


def test_il_prezzo_sceso_avvisa_chi_ha_la_campanella(
    wish_list, user, other_user, shop, api, django_capture_on_commit_callbacks
):
    wish = WishFactory(wish_list=wish_list, title="Cuffie", url="https://www.negozio.it/wave",
                       price="120.00")
    record_price(wish, Decimal("120.00"))
    both = other_user  # default: app e mail
    only_app = UserFactory(notify_by="app")
    only_mail = UserFactory(notify_by="email", language="en")
    nobody = UserFactory()
    for watcher in (both, only_app, only_mail):
        PriceWatch.objects.create(user=watcher, wish=wish)

    # Le mail partono dopo il commit: qui si esegue il callback a mano.
    with django_capture_on_commit_callbacks(execute=True):
        assert prices.check_price(wish) == Decimal("99.00")
    assert [str(p.price) for p in wish.price_points.all()] == ["120.00", "99.00"]
    wish.refresh_from_db()
    assert wish.price_checked_at is not None

    notes = {n.user_id: n for n in Notification.objects.all()}
    assert set(notes) == {both.pk, only_app.pk}
    assert notes[both.pk].title == "È sceso: Cuffie"
    assert "120,00 €" in notes[both.pk].body and "99,00 €" in notes[both.pk].body
    assert "-18%" in notes[both.pk].body
    # Chi non e' membro va sul link pubblico, non sulla pagina della lista.
    assert notes[both.pk].url == f"/l/{wish_list.share_token}"
    sent = {m.to[0]: m for m in mail.outbox}
    assert set(sent) == {both.email, only_mail.email}
    assert "Cuffie" in sent[only_mail.email].subject
    assert "99,00 €" in sent[only_mail.email].body
    assert nobody.notifications.count() == 0

    # Stesso prezzo la notte dopo: niente punto, niente avviso.
    assert prices.check_price(wish) == Decimal("99.00")
    assert wish.price_points.count() == 2
    assert Notification.objects.count() == 2


def test_cosa_si_rilegge_di_notte(user, settings):
    settings.PRICE_CHECKS_PER_NIGHT = 10
    settings.CELERY_TASK_ALWAYS_EAGER = True
    active = WishListFactory(owner=user)
    past = WishListFactory(owner=user, event_date="2000-01-01")
    todo = WishFactory(wish_list=active, url="https://www.negozio.it/a")
    WishFactory(wish_list=active)  # senza link
    WishFactory(wish_list=active, url="https://www.negozio.it/b", gifted_at="2026-01-01T00:00Z")
    WishFactory(wish_list=past, url="https://www.negozio.it/c")
    idea = GiftIdeaFactory(owner=user, url="https://www.negozio.it/d")
    GiftIdeaFactory(owner=user, url="https://www.negozio.it/e", status="bought")
    assert prices.targets_due(10) == [("wish", str(todo.pk)), ("idea", str(idea.pk))]
    # Il task prova a leggerli (il negozio finto non risponde: resta segnato come letto).
    assert check_prices() == 2
    todo.refresh_from_db()
    assert todo.price_checked_at is not None


def test_avvisi_dell_utente(user, other_user, api):
    Notification.objects.create(user=user, title="È sceso: Cuffie", body="…", url="/l/x")
    Notification.objects.create(user=other_user, title="Altro", body="", url="")
    client = api(user)
    data = client.get("/api/notifications").data
    assert data["unread"] == 1
    assert [n["title"] for n in data["items"]] == ["È sceso: Cuffie"]
    assert client.post("/api/notifications").status_code == 204
    assert client.get("/api/notifications").data["unread"] == 0
    assert api().get("/api/notifications").status_code == 401


def test_preferenza_avvisi_nel_profilo(user, api):
    client = api(user)
    assert client.get("/api/me").data["notify_by"] == "both"
    changed = client.patch("/api/me", {"notify_by": "email"}, format="json")
    assert changed.data["notify_by"] == "email"
    assert client.patch("/api/me", {"notify_by": "sms"}, format="json").status_code == 400
