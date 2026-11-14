"""Codice d'invito alla registrazione (ADR 0018)."""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APIClient

from apps.conftest import UserFactory

pytestmark = pytest.mark.django_db
User = get_user_model()
CODE = "codice-di-prova"


def _register(**extra):
    payload = {"email": "nuova@regalino.test", "password": "una-password-lunga", **extra}
    return APIClient().post("/api/auth/register", payload, format="json")


def test_senza_codice_impostato_la_registrazione_e_aperta():
    assert APIClient().get("/api/auth/signup-config").data == {"invite_code_required": False}
    assert _register().status_code == 201
    # Un codice scritto per sbaglio non da' fastidio.
    other = _register(email="altra@regalino.test", invite_code="qualunque")
    assert other.status_code == 201


@override_settings(SIGNUP_CODE=CODE)
def test_il_form_sa_che_serve_il_codice():
    response = APIClient().get("/api/auth/signup-config")
    assert response.status_code == 200
    # Dice solo che serve, mai qual e'.
    assert response.data == {"invite_code_required": True}


@override_settings(SIGNUP_CODE=CODE)
@pytest.mark.parametrize(
    "extra",
    [
        {},
        {"invite_code": ""},
        {"invite_code": "sbagliato"},
        {"invite_code": CODE.upper()},
        {"invite_code": None},
        {"invite_code": ["codice-di-prova"]},
    ],
)
def test_senza_il_codice_giusto_non_ci_si_registra(extra):
    response = _register(**extra)
    assert response.status_code == 400
    assert list(response.data) == ["invite_code"]
    assert not User.objects.filter(email="nuova@regalino.test").exists()


@override_settings(SIGNUP_CODE=CODE)
def test_col_codice_giusto_ci_si_registra():
    response = _register(invite_code=f"  {CODE} ")
    assert response.status_code == 201
    assert "access" in response.data
    assert User.objects.filter(email="nuova@regalino.test").exists()


@override_settings(SIGNUP_CODE=CODE)
def test_senza_codice_non_si_scopre_chi_e_registrato():
    existing = UserFactory()
    response = _register(email=existing.email, invite_code="sbagliato")
    assert response.status_code == 400
    assert list(response.data) == ["invite_code"]
    # Col codice giusto l'errore sull'email torna.
    response = _register(email=existing.email, invite_code=CODE)
    assert list(response.data) == ["email"]


@override_settings(SIGNUP_CODE=CODE)
def test_chi_ha_gia_un_account_entra_senza_codice(user):
    response = APIClient().post(
        "/api/auth/login", {"email": user.email, "password": "password-di-prova"}, format="json"
    )
    assert response.status_code == 200
