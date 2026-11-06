"""Liste incluse in altre liste (ADR 0008): un solo livello, sezioni sul link."""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.conftest import WishFactory, WishListFactory

pytestmark = pytest.mark.django_db


def _include(client, parent, *children):
    return client.patch(
        f"/api/lists/{parent.id}",
        {"included_list_ids": [str(c.id) for c in children]},
        format="json",
    )


def test_includere_e_togliere_una_lista(wish_list, user, api):
    books = WishListFactory(owner=user, title="Libri")
    WishFactory(wish_list=books)
    WishFactory(wish_list=books)
    client = api(user)
    response = _include(client, wish_list, books)
    assert response.status_code == 200
    [included] = response.data["included_lists"]
    assert included["title"] == "Libri"
    assert included["item_count"] == 2
    assert client.get(f"/api/lists/{books.id}").data["included_in"] == [
        {"id": str(wish_list.id), "title": wish_list.title}
    ]
    # Il conteggio della lista madre resta il suo.
    assert response.data["item_count"] == 0

    assert _include(client, wish_list).data["included_lists"] == []
    assert client.get(f"/api/lists/{books.id}").data["included_in"] == []


def test_un_solo_livello_e_solo_liste_proprie(wish_list, user, other_user, api):
    client = api(user)
    books = WishListFactory(owner=user, title="Libri")
    foreign = WishListFactory(owner=other_user)
    assert _include(client, wish_list, wish_list).status_code == 400
    assert _include(client, wish_list, foreign).status_code == 400
    assert _include(client, wish_list, books).status_code == 200
    # "Libri" sta dentro "wish_list": non puo' includere a sua volta.
    other = WishListFactory(owner=user)
    assert _include(client, books, other).status_code == 400
    # E una lista che include non si puo' includere.
    assert _include(client, other, wish_list).status_code == 400
    # La stessa lista puo' stare in due liste diverse.
    assert _include(client, other, books).status_code == 200


def test_il_link_mostra_le_sezioni_e_si_spunta_anche_li(wish_list, user, api):
    books = WishListFactory(owner=user, title="Libri")
    book = WishFactory(wish_list=books, title="Dune")
    WishFactory(wish_list=wish_list, title="Cuffie")
    _include(api(user), wish_list, books)

    data = api().get(f"/api/shared/{wish_list.share_token}").data
    assert [i["title"] for i in data["items"]] == ["Cuffie"]
    [section] = data["sections"]
    assert section["title"] == "Libri"
    assert [i["title"] for i in section["items"]] == ["Dune"]

    url = f"/api/shared/{wish_list.share_token}/items/{book.id}/gift"
    claimed = api().post(url, {"name": "Zia"}, format="json")
    assert claimed.status_code == 201
    assert api().post(url, {}, format="json").status_code == 409
    # Spuntato una volta sola: anche dal link di "Libri" risulta preso.
    [own] = api().get(f"/api/shared/{books.share_token}").data["items"]
    assert own["gifted"] is True and own["gifted_by_name"] == "Zia"
    # Con la chiave si toglie anche dal link della lista madre.
    released = api().delete(url, {"claim_key": claimed.data["claim_key"]}, format="json")
    assert released.status_code == 200
    assert released.data["gifted"] is False


def test_chi_scrive_la_lista_inclusa_non_ne_vede_le_spunte(wish_list, user, other_user, api):
    """Anna include la lista di Luca: Luca sul link di Anna non spunta i suoi, spunta gli altri."""
    lucas = WishListFactory(owner=other_user, title="Di Luca")
    lucas_gift = WishFactory(wish_list=lucas, gifted_at=timezone.now(), gifted_by_name="Zia")
    annas_gift = WishFactory(wish_list=wish_list)
    # Per includerla Anna deve poterla scrivere: Luca la invita.
    from apps.gifts.models import WishListMember

    WishListMember.objects.create(wish_list=lucas, user=user)
    assert _include(api(user), wish_list, lucas).status_code == 200

    luca = api(other_user)
    data = luca.get(f"/api/shared/{wish_list.share_token}").data
    assert data["is_owner"] is False
    [section] = data["sections"]
    assert section["items"][0]["gifted"] is None
    base = f"/api/shared/{wish_list.share_token}/items"
    assert luca.post(f"{base}/{lucas_gift.id}/gift", {}, format="json").status_code == 403
    assert luca.post(f"{base}/{annas_gift.id}/gift", {}, format="json").status_code == 201


def test_la_lista_inclusa_eliminata_sparisce(wish_list, user, api):
    books = WishListFactory(owner=user, title="Libri")
    book = WishFactory(wish_list=books)
    client = api(user)
    _include(client, wish_list, books)
    books.delete()
    assert client.get(f"/api/lists/{wish_list.id}").data["included_lists"] == []
    data = api().get(f"/api/shared/{wish_list.share_token}").data
    assert data["sections"] == []
    url = f"/api/shared/{wish_list.share_token}/items/{book.id}/gift"
    assert api().post(url, {}, format="json").status_code == 404
