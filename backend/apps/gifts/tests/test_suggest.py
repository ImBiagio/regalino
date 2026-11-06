""""Ispirami" e le alternative dal link condiviso (ADR 0010), con Gemini finto."""

from __future__ import annotations

import json

import httpx
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
            "price": "25",
            "query": "libro cucina giapponese",
        },
        {"title": "", "why": "scartata: senza titolo", "price": "", "query": ""},
    ]
}


@pytest.fixture
def gemini(settings, monkeypatch):
    settings.GEMINI_API_KEY = "chiave-di-prova"

    class Fake:
        answer: dict | None = IDEAS
        asked: list[dict] = []

    def fake_post(url, **kwargs):
        Fake.asked.append(kwargs["json"])
        body = {"candidates": [{"content": {"parts": [{"text": json.dumps(Fake.answer)}]}}]}
        return httpx.Response(200, json=body)

    Fake.asked = []
    monkeypatch.setattr(ai.httpx, "post", fake_post)
    return Fake


def test_ispirami(user, api, gemini):
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
    prompt = gemini.asked[0]["contents"][0]["parts"][0]["text"]
    assert "cucina, viaggi" in prompt and "niente profumi" in prompt and "Sciarpa" in prompt
    assert gemini.asked[0]["generationConfig"]["responseJsonSchema"] == ai.SUGGEST_SCHEMA


def test_senza_gemini_o_in_errore(user, api, gemini):
    gemini.answer = {"nonsense": True}
    assert api(user).post("/api/ideas/suggest", {}, format="json").status_code == 503


def test_senza_chiave(user, api, settings):
    settings.GEMINI_API_KEY = ""
    assert api(user).post("/api/ideas/suggest", {}, format="json").status_code == 503
    assert api().post("/api/ideas/suggest", {}, format="json").status_code == 401


def test_alternative_dal_link_condiviso(wish_list, api, gemini):
    taken = WishFactory(wish_list=wish_list, title="Cuffie Sony")
    WishFactory(wish_list=wish_list, title="Libro di cucina")
    url = f"/api/shared/{wish_list.share_token}/suggest"
    response = api().post(url, {"item_id": str(taken.id)}, format="json")
    assert response.status_code == 200, response.data
    assert len(response.data) == 2
    prompt = gemini.asked[0]["contents"][0]["parts"][0]["text"]
    assert "Cuffie Sony" in prompt and "Libro di cucina" in prompt
    # Niente nomi: a Gemini vanno solo i regali.
    assert wish_list.owner.display_name not in prompt
    other = WishFactory()
    assert api().post(url, {"item_id": str(other.id)}, format="json").status_code == 404
