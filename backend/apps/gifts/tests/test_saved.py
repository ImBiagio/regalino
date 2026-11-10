"""Liste salvate: chi ha il link di una lista di un altro la ritrova nella sua area (ADR 0014)."""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.conftest import WishFactory, WishListFactory
from apps.gifts.models import SavedList, WishListInclusion, WishListMember

pytestmark = pytest.mark.django_db


def _save(wish_list) -> str:
    return f"/api/shared/{wish_list.share_token}/save"


def test_salva_la_lista_e_la_ritrova(wish_list, other_user, api):
    WishFactory(wish_list=wish_list)
    WishFactory(wish_list=wish_list, gifted_at=timezone.now())
    client = api(other_user)
    assert client.get(f"/api/shared/{wish_list.share_token}").data["saved"] is False

    assert client.post(_save(wish_list)).data == {"saved": True}
    # Salvarla due volte non la duplica.
    client.post(_save(wish_list))
    assert client.get(f"/api/shared/{wish_list.share_token}").data["saved"] is True

    [row] = client.get("/api/saved-lists").data
    assert row["title"] == wish_list.title
    assert row["owner_name"] == wish_list.owner.display_name
    assert row["share_token"] == wish_list.share_token
    assert row["available"] is True
    assert (row["item_count"], row["free_count"]) == (2, 1)


def test_conta_anche_i_regali_delle_liste_incluse(wish_list, other_user, api):
    child = WishListFactory(owner=wish_list.owner)
    WishListInclusion.objects.create(parent=wish_list, child=child)
    WishFactory(wish_list=wish_list)
    WishFactory(wish_list=child)
    client = api(other_user)
    client.post(_save(wish_list))
    [row] = client.get("/api/saved-lists").data
    assert row["item_count"] == 2


def test_serve_un_account(wish_list, api):
    assert api().post(_save(wish_list)).status_code == 401
    assert api().get("/api/saved-lists").status_code == 401


def test_chi_scrive_la_lista_non_la_salva(wish_list, user, other_user, api):
    assert api(user).post(_save(wish_list)).status_code == 400
    WishListMember.objects.create(wish_list=wish_list, user=other_user)
    assert api(other_user).post(_save(wish_list)).status_code == 400
    assert not SavedList.objects.exists()


def test_togli_dal_link_o_dall_elenco(wish_list, other_user, api):
    client = api(other_user)
    client.post(_save(wish_list))
    assert client.delete(_save(wish_list)).data == {"saved": False}
    assert client.get("/api/saved-lists").data == []

    client.post(_save(wish_list))
    [row] = client.get("/api/saved-lists").data
    assert client.delete(f"/api/saved-lists/{row['id']}").status_code == 204
    assert client.get("/api/saved-lists").data == []


def test_le_liste_salvate_sono_di_chi_le_ha_salvate(wish_list, other_user, user, api):
    api(other_user).post(_save(wish_list))
    row = SavedList.objects.get()
    assert api(user).get("/api/saved-lists").data == []
    assert api(user).delete(f"/api/saved-lists/{row.id}").status_code == 404


def test_link_rigenerato_spegne_anche_la_lista_salvata(wish_list, user, other_user, api):
    """Rigenerare il link toglie l'accesso a tutti: anche a chi l'aveva salvata."""
    client = api(other_user)
    client.post(_save(wish_list))
    api(user).post(f"/api/lists/{wish_list.id}/regenerate-link")
    wish_list.refresh_from_db()

    [row] = client.get("/api/saved-lists").data
    assert row["available"] is False
    assert row["share_token"] is None
    assert row["owner_name"] == ""
    assert row["item_count"] == 0
    # Il titolo resta, per riconoscerla e toglierla.
    assert row["title"] == wish_list.title
    # Col link nuovo non risulta salvata; salvandola di nuovo torna disponibile.
    assert client.get(f"/api/shared/{wish_list.share_token}").data["saved"] is False
    client.post(_save(wish_list))
    [row] = client.get("/api/saved-lists").data
    assert row["available"] is True


def test_lista_eliminata(wish_list, user, other_user, api):
    client = api(other_user)
    client.post(_save(wish_list))
    api(user).delete(f"/api/lists/{wish_list.id}")
    [row] = client.get("/api/saved-lists").data
    assert row["available"] is False
    assert row["share_token"] is None
