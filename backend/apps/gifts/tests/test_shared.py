"""Lista condivisa: chi ha il link vede i regali e li spunta."""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.conftest import WishFactory

pytestmark = pytest.mark.django_db


def _url(wish_list, wish=None) -> str:
    base = f"/api/shared/{wish_list.share_token}"
    return f"{base}/items/{wish.id}/gift" if wish else base


def test_chi_ha_il_link_vede_la_lista_senza_account(wish_list, api):
    WishFactory(wish_list=wish_list, title="Libro", price="12.00")
    data = api().get(_url(wish_list)).data
    assert data["title"] == wish_list.title
    assert data["owner_name"] == wish_list.owner.display_name
    assert data["is_owner"] is False
    [item] = data["items"]
    assert item["title"] == "Libro"
    assert item["gifted"] is False
    assert "claim_key_hash" not in item


def test_link_sbagliato(api):
    assert api().get("/api/shared/non-esiste").status_code == 404


def test_spunta_e_togli_la_spunta_con_la_chiave(wish_list, api):
    wish = WishFactory(wish_list=wish_list)
    claimed = api().post(_url(wish_list, wish), {"name": "Zia Pina"}, format="json")
    assert claimed.status_code == 201
    assert claimed.data["item"]["gifted"] is True
    assert claimed.data["item"]["gifted_by_name"] == "Zia Pina"
    key = claimed.data["claim_key"]

    # Un altro visitatore non puo' toglierla, ne' rispuntarla.
    fake = api().delete(_url(wish_list, wish), {"claim_key": "falsa"}, format="json")
    assert fake.status_code == 403
    assert api().delete(_url(wish_list, wish)).status_code == 403
    assert api().post(_url(wish_list, wish), {}, format="json").status_code == 409

    released = api().delete(_url(wish_list, wish), {"claim_key": key}, format="json")
    assert released.status_code == 200
    assert released.data["gifted"] is False
    wish.refresh_from_db()
    assert wish.claim_key_hash == ""
    assert wish.gifted_by_name == ""


def test_utente_loggato_spunta_col_suo_nome_e_la_toglie_senza_chiave(wish_list, other_user, api):
    wish = WishFactory(wish_list=wish_list)
    client = api(other_user)
    claimed = client.post(_url(wish_list, wish), {}, format="json")
    assert claimed.data["item"]["gifted_by_name"] == other_user.display_name
    assert claimed.data["item"]["mine"] is True
    assert api().get(_url(wish_list)).data["items"][0]["mine"] is False
    wish.refresh_from_db()
    assert wish.gifted_by == other_user
    assert client.delete(_url(wish_list, wish)).status_code == 200


def test_il_proprietario_non_spunta_e_non_vede_le_spunte(wish_list, user, api):
    gifted = WishFactory(wish_list=wish_list, gifted_at=timezone.now(), gifted_by_name="Zia")
    free = WishFactory(wish_list=wish_list)
    client = api(user)
    data = client.get(_url(wish_list)).data
    assert data["is_owner"] is True
    assert {item["gifted"] for item in data["items"]} == {None}
    assert all(item["gifted_by_name"] == "" for item in data["items"])
    assert client.post(_url(wish_list, free), {}, format="json").status_code == 403

    wish_list.show_gifted = True
    wish_list.save()
    items = {item["id"]: item for item in client.get(_url(wish_list)).data["items"]}
    assert items[str(gifted.id)]["gifted"] is True


def test_regalo_di_un_altra_lista_non_si_spunta(wish_list, api):
    other = WishFactory()
    assert api().post(_url(wish_list, other), {}, format="json").status_code == 404


def test_regalo_eliminato_sparisce_dal_link(wish_list, api):
    wish = WishFactory(wish_list=wish_list)
    wish.delete()
    assert api().get(_url(wish_list)).data["items"] == []
    assert api().post(_url(wish_list, wish), {}, format="json").status_code == 404
