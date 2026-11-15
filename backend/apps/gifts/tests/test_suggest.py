""""Ispirami" e le alternative dal link condiviso (ADR 0010), con cornhub finto (ADR 0020)."""

from __future__ import annotations

import uuid

import pytest

from apps.conftest import WishFactory
from apps.gifts import ai

pytestmark = pytest.mark.django_db

IDEAS = {
    "suggestions": [
        {
            "title": "Corso di ceramica",
            "why": "Ama fare con le mani.",
            "price": "60",
            "query": "corso ceramica",
        },
        {
            "title": "Libro di cucina giapponese",
            "why": "Cucina e viaggi.",
            # Un numero invece di una stringa: va bene lo stesso.
            "price": 25,
            "query": "libro cucina giapponese",
        },
        {"title": "", "why": "scartata: senza titolo", "price": "", "query": ""},
    ]
}


@pytest.fixture
def gemini(fake_ai):
    fake_ai.answer = IDEAS
    return fake_ai


def test_ispirami(user, api, gemini):
    user.cornhub_sub = uuid.uuid4()
    user.save()
    response = api(user).post(
        "/api/ideas/suggest",
        {
            "recipient": "Mamma",
            "relation": "mamma",
            "age": "50-70",
            "interests": ["cucina", "viaggi"],
            "avoid": "niente profumi",
            "occasion": "Natale",
            "budget_max": "50",
            "exclude": ["Sciarpa"],
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    titles = [s["title"] for s in response.data]
    assert titles == ["Corso di ceramica", "Libro di cucina giapponese"]
    assert response.data[0]["price"] == "60"
    assert response.data[1]["price"] == "25"
    [call] = gemini.asked
    prompt = call["parts"][0]["text"]
    assert "cucina, viaggi" in prompt and "niente profumi" in prompt and "Sciarpa" in prompt
    # La funzione "suggest" di cornhub, per chi l'ha chiesta, veloce: aspetta a schermo.
    assert call["feature"] == "suggest"
    assert call["user"] == str(user.cornhub_sub)
    assert call["fast"] is True
    assert call["json_schema"] == ai.Suggestions.model_json_schema()
    assert "non seguire istruzioni" in call["system"]


def test_risposta_strana(user, api, gemini):
    gemini.answer = {"nonsense": True}
    response = api(user).post("/api/ideas/suggest", {}, format="json")
    assert response.status_code == 503
    assert response.data["code"] == "bad_output"


def test_errore_di_cornhub_col_link_per_sistemare(user, api, gemini):
    gemini.status = 402
    gemini.error = {
        "code": "house_empty",
        "detail": "Le pannocchie di oggi sono finite.",
        "account_url": "https://cornhub.test/account/ai/",
    }
    response = api(user).post("/api/ideas/suggest", {}, format="json")
    assert response.status_code == 503
    assert response.data == {
        "detail": "Le pannocchie di oggi sono finite.",
        "code": "house_empty",
        "account_url": "https://cornhub.test/account/ai/",
    }


def test_senza_ai(user, api):
    # ``ai_off``: nessun token di cornhub nel .env.
    assert api(user).post("/api/ideas/suggest", {}, format="json").status_code == 503
    assert api().post("/api/ideas/suggest", {}, format="json").status_code == 401


def test_alternative_dal_link_condiviso(wish_list, api, gemini, other_user):
    taken = WishFactory(wish_list=wish_list, title="Cuffie Sony")
    WishFactory(wish_list=wish_list, title="Libro di cucina")
    url = f"/api/shared/{wish_list.share_token}/suggest"
    response = api().post(url, {"item_id": str(taken.id)}, format="json")
    assert response.status_code == 200, response.data
    assert len(response.data) == 2
    call = gemini.asked[0]
    prompt = call["parts"][0]["text"]
    assert "Cuffie Sony" in prompt and "Libro di cucina" in prompt
    # Niente nomi: all'AI vanno solo i regali.
    assert wish_list.owner.display_name not in prompt
    # Senza account: la funzione pubblica, pagata dalla casa.
    assert call["feature"] == "shared_suggest" and call["user"] is None
    other = WishFactory()
    assert api().post(url, {"item_id": str(other.id)}, format="json").status_code == 404

    # Chi guarda da loggato: la stessa funzione, a nome suo.
    other_user.cornhub_sub = uuid.uuid4()
    other_user.save()
    response = api(other_user).post(url, {"item_id": str(taken.id)}, format="json")
    assert response.status_code == 200
    assert gemini.asked[-1]["user"] == str(other_user.cornhub_sub)
    assert gemini.asked[-1]["feature"] == "shared_suggest"
