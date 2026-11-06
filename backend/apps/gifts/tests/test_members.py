"""Liste scritte da piu' utenti (ADR 0007): invito, cosa puo' fare un membro."""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.conftest import UserFactory, WishFactory
from apps.gifts.models import WishListMember

pytestmark = pytest.mark.django_db


@pytest.fixture
def member(wish_list):
    user = UserFactory(display_name="Anna")
    WishListMember.objects.create(wish_list=wish_list, user=user)
    return user


def _invite(client, wish_list) -> str:
    response = client.post(f"/api/lists/{wish_list.id}/invite-link")
    assert response.status_code == 200
    return response.data["invite_token"]


def test_invito_col_link(wish_list, user, other_user, api):
    owner = api(user)
    assert owner.get(f"/api/lists/{wish_list.id}").data["invite_token"] is None
    token = _invite(owner, wish_list)
    assert token

    # Serve un account: l'ospite non entra.
    assert api().get(f"/api/invites/{token}").status_code == 401
    guest = api(other_user)
    preview = guest.get(f"/api/invites/{token}")
    assert preview.status_code == 200
    assert preview.data["title"] == wish_list.title
    assert preview.data["owner_name"] == user.display_name
    assert preview.data["already_member"] is False

    joined = guest.post(f"/api/invites/{token}")
    assert joined.status_code == 200
    assert joined.data["id"] == str(wish_list.id)
    assert joined.data["is_owner"] is False
    assert [m["display_name"] for m in joined.data["members"]] == [other_user.display_name]
    # Due volte non fa due membri.
    assert guest.post(f"/api/invites/{token}").status_code == 200
    assert WishListMember.objects.filter(wish_list=wish_list).count() == 1
    assert guest.get(f"/api/invites/{token}").data["already_member"] is True
    # Il proprietario che apre il proprio invito non diventa membro di se stesso.
    assert owner.post(f"/api/invites/{token}").status_code == 200
    assert WishListMember.objects.filter(wish_list=wish_list).count() == 1


def test_link_di_invito_spento_o_sbagliato(wish_list, user, other_user, api):
    owner = api(user)
    token = _invite(owner, wish_list)
    assert owner.delete(f"/api/lists/{wish_list.id}/invite-link").data["invite_token"] is None
    assert api(other_user).get(f"/api/invites/{token}").status_code == 404
    assert api(other_user).post(f"/api/invites/{token}").status_code == 404
    assert api(other_user).get("/api/invites/non-esiste").status_code == 404
    # Rinnovare il link spegne quello di prima.
    first = _invite(owner, wish_list)
    second = _invite(owner, wish_list)
    assert first != second
    assert api(other_user).get(f"/api/invites/{first}").status_code == 404


def test_il_membro_scrive_la_lista_come_il_proprietario(wish_list, user, member, api):
    client = api(member)
    [row] = client.get("/api/lists").data
    assert row["id"] == str(wish_list.id)
    assert row["is_owner"] is False
    assert row["owner"]["display_name"] == user.display_name
    assert row["owner"].keys() == {"id", "display_name"}

    item = client.post(f"/api/lists/{wish_list.id}/items", {"title": "Libro"}, format="json")
    assert item.status_code == 201
    assert client.patch(
        f"/api/lists/{wish_list.id}/items/{item.data['id']}", {"title": "Libro nuovo"},
        format="json",
    ).status_code == 200
    assert client.patch(
        f"/api/lists/{wish_list.id}", {"title": "Nostra", "show_gifted": True}, format="json"
    ).status_code == 200
    # Il membro puo' invitare altri.
    assert client.post(f"/api/lists/{wish_list.id}/invite-link").status_code == 200
    # Anche il proprietario vede il membro e un solo conteggio dei regali.
    [mine] = api(user).get("/api/lists").data
    assert [m["display_name"] for m in mine["members"]] == ["Anna"]
    assert mine["item_count"] == 1


def test_solo_il_proprietario_elimina_rigenera_e_toglie_gli_altri(
    wish_list, user, member, other_user, api
):
    WishListMember.objects.create(wish_list=wish_list, user=other_user)
    client = api(member)
    assert client.delete(f"/api/lists/{wish_list.id}").status_code == 403
    assert client.post(f"/api/lists/{wish_list.id}/regenerate-link").status_code == 403
    assert client.delete(f"/api/lists/{wish_list.id}/members/{other_user.pk}").status_code == 403
    # Se stesso si': esce dalla lista e non la vede piu'.
    assert client.delete(f"/api/lists/{wish_list.id}/members/{member.pk}").status_code == 204
    assert client.get("/api/lists").data == []
    assert client.get(f"/api/lists/{wish_list.id}/items").status_code == 404

    owner = api(user)
    removed = owner.delete(f"/api/lists/{wish_list.id}/members/{other_user.pk}")
    assert removed.status_code == 200
    assert removed.data["members"] == []
    assert api(other_user).get("/api/lists").data == []
    assert owner.delete(f"/api/lists/{wish_list.id}/members/{other_user.pk}").status_code == 404
    assert owner.delete(f"/api/lists/{wish_list.id}").status_code == 204


def test_il_membro_sul_link_condiviso_e_come_il_proprietario(wish_list, member, api):
    wish = WishFactory(wish_list=wish_list, gifted_at=timezone.now(), gifted_by_name="Zia")
    free = WishFactory(wish_list=wish_list)
    client = api(member)
    data = client.get(f"/api/shared/{wish_list.share_token}").data
    assert data["is_owner"] is True
    assert {item["gifted"] for item in data["items"]} == {None}
    url = f"/api/shared/{wish_list.share_token}/items/{free.id}/gift"
    assert client.post(url, {}, format="json").status_code == 403
    assert wish.gifted_by_name == "Zia"


def test_gli_estranei_restano_fuori(wish_list, other_user, api):
    client = api(other_user)
    assert client.get(f"/api/lists/{wish_list.id}").status_code == 404
    assert client.post(f"/api/lists/{wish_list.id}/invite-link").status_code == 404
    assert client.delete(f"/api/lists/{wish_list.id}/members/{other_user.pk}").status_code == 404
