"""La schermata "Campanelle": i regali e le idee con la campanella dell'utente."""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.utils import timezone

from apps.conftest import GiftIdeaFactory, WishFactory, WishListFactory
from apps.gifts.models import PriceWatch, WishListMember, record_price

pytestmark = pytest.mark.django_db


def test_elenco_con_prezzo_attuale_e_dove_sta(user, other_user, api):
    mine = WishListFactory(owner=user, title="Compleanno")
    theirs = WishListFactory(owner=other_user, title="Natale")
    own_wish = WishFactory(wish_list=mine, title="Cuffie", price="100.00", url="https://x.it/c")
    their_wish = WishFactory(wish_list=theirs, title="Libro", url="https://x.it/l")
    idea = GiftIdeaFactory(owner=user, recipient="Mamma", title="Vino", price="20.00")
    record_price(own_wish, Decimal("100.00"))
    record_price(own_wish, Decimal("80.00"))
    for target in ({"wish": own_wish}, {"wish": their_wish}, {"idea": idea}):
        PriceWatch.objects.create(user=user, **target)

    rows = {row["title"]: row for row in api(user).get("/api/watches").data}
    assert set(rows) == {"Cuffie", "Libro", "Vino"}

    cuffie = rows["Cuffie"]
    assert cuffie["kind"] == "wish"
    assert cuffie["price"] == "80.00"
    assert [p["price"] for p in cuffie["price_history"]] == ["100.00", "80.00"]
    assert cuffie["where"] == "Compleanno"
    assert cuffie["path"] == f"/liste/{mine.id}"
    # La sorpresa: il proprietario non sa se e' stato preso.
    assert cuffie["gifted"] is None

    libro = rows["Libro"]
    assert libro["where"] == f"Natale di {other_user.display_name}"
    assert libro["path"] == f"/l/{theirs.share_token}"
    assert libro["gifted"] is False
    assert libro["price"] is None

    vino = rows["Vino"]
    assert (vino["kind"], vino["where"], vino["path"]) == ("idea", "Per Mamma", "/da-regalare")
    assert vino["price"] == "20.00"
    assert vino["gifted"] is False


def test_un_membro_vede_la_lista_come_sua(user, other_user, api):
    theirs = WishListFactory(owner=other_user, title="Casa")
    WishListMember.objects.create(wish_list=theirs, user=user)
    wish = WishFactory(wish_list=theirs, gifted_at=timezone.now())
    PriceWatch.objects.create(user=user, wish=wish)
    [row] = api(user).get("/api/watches").data
    assert (row["where"], row["path"], row["gifted"]) == ("Casa", f"/liste/{theirs.id}", None)


def test_regalo_preso_si_vede_a_chi_non_scrive_la_lista(user, other_user, api):
    wish = WishFactory(wish_list=WishListFactory(owner=other_user), gifted_at=timezone.now())
    PriceWatch.objects.create(user=user, wish=wish)
    [row] = api(user).get("/api/watches").data
    assert row["gifted"] is True


def test_niente_eliminati_e_solo_le_mie(user, other_user, api):
    deleted = WishFactory(wish_list=WishListFactory(owner=user))
    deleted.delete()
    gone_list = WishListFactory(owner=user)
    in_gone_list = WishFactory(wish_list=gone_list)
    gone_list.delete()
    idea = GiftIdeaFactory(owner=user)
    idea.delete()
    for target in ({"wish": deleted}, {"wish": in_gone_list}, {"idea": idea}):
        PriceWatch.objects.create(user=user, **target)
    PriceWatch.objects.create(user=other_user, wish=WishFactory())
    assert api(user).get("/api/watches").data == []


def test_togli_la_campanella(user, other_user, api):
    watch = PriceWatch.objects.create(user=user, wish=WishFactory())
    assert api(other_user).delete(f"/api/watches/{watch.id}").status_code == 404
    assert api(user).delete(f"/api/watches/{watch.id}").status_code == 204
    assert not PriceWatch.objects.exists()


def test_serve_un_account(api):
    assert api().get("/api/watches").status_code == 401
