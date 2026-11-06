"""Un regalo che "va con" un altro (ADR 0009): si spunta solo dopo quello."""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.conftest import WishFactory

pytestmark = pytest.mark.django_db


def _set(client, wish_list, wish, requires):
    return client.patch(
        f"/api/lists/{wish_list.id}/items/{wish.id}",
        {"requires_id": str(requires.id) if requires else None},
        format="json",
    )


def test_va_con_un_regalo_della_stessa_lista(wish_list, user, api):
    phones = WishFactory(wish_list=wish_list, title="Cuffie")
    case = WishFactory(wish_list=wish_list, title="Custodia")
    client = api(user)
    response = _set(client, wish_list, case, phones)
    assert response.status_code == 200
    assert str(response.data["requires_id"]) == str(phones.id)
    assert response.data["requires_title"] == "Cuffie"
    assert _set(client, wish_list, case, None).data["requires_id"] is None

    foreign = WishFactory()
    assert _set(client, wish_list, case, foreign).status_code == 400
    assert _set(client, wish_list, case, case).status_code == 400
    # Niente giri: Custodia → Cuffie, poi Cuffie → Custodia no.
    assert _set(client, wish_list, case, phones).status_code == 200
    assert _set(client, wish_list, phones, case).status_code == 400
    # Anche a tre: Cavo → Custodia → Cuffie, poi Cuffie → Cavo no.
    cable = WishFactory(wish_list=wish_list, title="Cavo")
    assert _set(client, wish_list, cable, case).status_code == 200
    assert _set(client, wish_list, phones, cable).status_code == 400


def test_sul_link_si_spunta_solo_dopo_il_regalo_con_cui_va(wish_list, api):
    phones = WishFactory(wish_list=wish_list, title="Cuffie")
    case = WishFactory(wish_list=wish_list, title="Custodia", requires=phones)
    base = f"/api/shared/{wish_list.share_token}"
    data = api().get(base).data
    by_id = {item["id"]: item for item in data["items"]}
    assert by_id[str(case.id)]["requires_id"] == str(phones.id)
    assert by_id[str(phones.id)]["requires_id"] is None

    blocked = api().post(f"{base}/items/{case.id}/gift", {}, format="json")
    assert blocked.status_code == 409
    assert "Cuffie" in blocked.data["detail"]
    assert api().post(f"{base}/items/{phones.id}/gift", {}, format="json").status_code == 201
    assert api().post(f"{base}/items/{case.id}/gift", {}, format="json").status_code == 201


def test_il_regalo_con_cui_va_eliminato_libera_l_altro(wish_list, user, api):
    phones = WishFactory(wish_list=wish_list, title="Cuffie")
    case = WishFactory(wish_list=wish_list, title="Custodia", requires=phones)
    phones.delete()
    [item] = api(user).get(f"/api/lists/{wish_list.id}/items").data
    assert item["requires_id"] is None and item["requires_title"] == ""
    url = f"/api/shared/{wish_list.share_token}/items/{case.id}/gift"
    assert api().post(url, {}, format="json").status_code == 201


def test_il_regalo_gia_preso_sblocca_anche_chi_ci_va(wish_list, api):
    phones = WishFactory(wish_list=wish_list, gifted_at=timezone.now())
    case = WishFactory(wish_list=wish_list, requires=phones)
    url = f"/api/shared/{wish_list.share_token}/items/{case.id}/gift"
    assert api().post(url, {}, format="json").status_code == 201
