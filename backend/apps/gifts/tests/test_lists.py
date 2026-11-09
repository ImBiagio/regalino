"""Liste dei regali del proprietario: CRUD, isolamento, sorpresa."""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.conftest import GiftIdeaFactory, WishFactory, WishListFactory

pytestmark = pytest.mark.django_db


def test_crea_lista_e_regali(user, api):
    client = api(user)
    created = client.post("/api/lists", {"title": "Compleanno"}, format="json")
    assert created.status_code == 201
    list_id = created.data["id"]
    assert created.data["share_token"]
    assert created.data["show_gifted"] is False

    item = client.post(
        f"/api/lists/{list_id}/items",
        {"title": "Libro", "price": "19.90", "url": "https://esempio.it/libro"},
        format="json",
    )
    assert item.status_code == 201
    assert item.data["price"] == "19.90"
    assert item.data["gifted"] is None

    [row] = client.get("/api/lists").data
    assert row["item_count"] == 1
    assert row["gifted_count"] is None


def test_link_lungo_salvato_pulito(wish_list, user, api):
    """Un link Amazon con 600 caratteri di tracciamento entra e resta solo ``/dp/ASIN``."""
    long_url = "https://www.amazon.it/dp/B08P3G898S/ref=sr_1_1?" + "&".join(
        f"pd_rd_{i}=abcdefghijklmnopqrstuvwxyz" for i in range(20)
    )
    assert len(long_url) > 500
    client = api(user)
    item = client.post(
        f"/api/lists/{wish_list.id}/items", {"title": "Gioco", "url": long_url}, format="json"
    )
    assert item.status_code == 201
    assert item.data["url"] == "https://www.amazon.it/dp/B08P3G898S"

    idea = client.post(
        "/api/ideas",
        {"recipient": "Anna", "title": "Gioco", "url": long_url + "&utm_source=x"},
        format="json",
    )
    assert idea.status_code == 201
    assert idea.data["url"] == "https://www.amazon.it/dp/B08P3G898S"

    # Un link lungo di un altro negozio, senza tracciamento, entra intero fino a 2000.
    other = "https://www.negozio.it/p/" + "x" * 1500
    item = client.post(
        f"/api/lists/{wish_list.id}/items", {"title": "Altro", "url": other}, format="json"
    )
    assert item.status_code == 201
    assert item.data["url"] == other
    too_long = "https://www.negozio.it/p/" + "x" * 2000
    item = client.post(
        f"/api/lists/{wish_list.id}/items", {"title": "Altro", "url": too_long}, format="json"
    )
    assert item.status_code == 400


def test_prezzo_negativo_rifiutato(wish_list, user, api):
    response = api(user).post(
        f"/api/lists/{wish_list.id}/items", {"title": "X", "price": "-1"}, format="json"
    )
    assert response.status_code == 400
    assert "price" in response.data


def test_liste_e_idee_altrui_non_si_vedono(wish_list, other_user, api):
    wish = WishFactory(wish_list=wish_list)
    idea = GiftIdeaFactory()
    client = api(other_user)
    assert client.get("/api/lists").data == []
    assert client.get(f"/api/lists/{wish_list.id}").status_code == 404
    assert client.get(f"/api/lists/{wish_list.id}/items").status_code == 404
    assert client.patch(
        f"/api/lists/{wish_list.id}/items/{wish.id}", {"title": "Mio"}, format="json"
    ).status_code == 404
    assert client.post(
        f"/api/lists/{wish_list.id}/items", {"title": "Intruso"}, format="json"
    ).status_code == 404
    assert client.get("/api/ideas").data == []
    assert client.delete(f"/api/ideas/{idea.id}").status_code == 404


def test_serve_il_login(wish_list, api):
    assert api().get("/api/lists").status_code == 401
    assert api().get(f"/api/lists/{wish_list.id}/items").status_code == 401
    assert api().get("/api/ideas").status_code == 401


def test_la_sorpresa_resta_finche_non_la_si_toglie(wish_list, user, api):
    wish = WishFactory(wish_list=wish_list, gifted_at=timezone.now(), gifted_by_name="Zia")
    client = api(user)
    [hidden] = client.get(f"/api/lists/{wish_list.id}/items").data
    assert hidden["gifted"] is None
    assert hidden["gifted_by_name"] == ""
    # Senza "mostrami" la spunta non si tocca: toglierla direbbe che c'era.
    assert client.delete(f"/api/lists/{wish_list.id}/items/{wish.id}/gift").status_code == 400

    client.patch(f"/api/lists/{wish_list.id}", {"show_gifted": True}, format="json")
    [shown] = client.get(f"/api/lists/{wish_list.id}/items").data
    assert shown["gifted"] is True
    assert shown["gifted_by_name"] == "Zia"
    assert client.get("/api/lists").data[0]["gifted_count"] == 1

    cleared = client.delete(f"/api/lists/{wish_list.id}/items/{wish.id}/gift")
    assert cleared.status_code == 200
    assert cleared.data["gifted"] is False


def test_rigenerare_il_link_spegne_quello_vecchio(wish_list, user, api):
    old = wish_list.share_token
    response = api(user).post(f"/api/lists/{wish_list.id}/regenerate-link")
    assert response.status_code == 200
    assert response.data["share_token"] != old
    assert api().get(f"/api/shared/{old}").status_code == 404
    assert api().get(f"/api/shared/{response.data['share_token']}").status_code == 200


def test_eliminare_la_lista_spegne_il_link(wish_list, user, api):
    assert api(user).delete(f"/api/lists/{wish_list.id}").status_code == 204
    assert api().get(f"/api/shared/{wish_list.share_token}").status_code == 404


def test_regali_eliminati_non_contano(wish_list, user, api):
    WishFactory(wish_list=wish_list)
    WishFactory(wish_list=wish_list).delete()
    [row] = api(user).get("/api/lists").data
    assert row["item_count"] == 1


def test_idee_da_regalare(user, api):
    client = api(user)
    created = client.post(
        "/api/ideas",
        {"recipient": "  Mamma   Rosa ", "title": "Sciarpa", "occasion": "Natale"},
        format="json",
    )
    assert created.status_code == 201
    assert created.data["recipient"] == "Mamma Rosa"
    assert created.data["status"] == "idea"
    client.post("/api/ideas", {"recipient": "Papà", "title": "Vino"}, format="json")

    idea_id = created.data["id"]
    assert client.patch(
        f"/api/ideas/{idea_id}", {"status": "bought"}, format="json"
    ).data["status"] == "bought"
    bought = client.get("/api/ideas", {"status": "bought"}).data
    assert [i["title"] for i in bought] == ["Sciarpa"]
    blank = client.post("/api/ideas", {"recipient": " ", "title": "X"}, format="json")
    assert blank.status_code == 400


def test_liste_di_altri_utenti_restano_separate(user, other_user, api):
    WishListFactory(owner=user, title="Mia")
    WishListFactory(owner=other_user, title="Sua")
    assert [row["title"] for row in api(user).get("/api/lists").data] == ["Mia"]
