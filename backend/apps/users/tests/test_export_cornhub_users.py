"""Export degli utenti verso cornhub (ADR 0020)."""

from __future__ import annotations

import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.conftest import UserFactory

pytestmark = pytest.mark.django_db


def _export() -> list[dict]:
    out = StringIO()
    call_command("export_cornhub_users", stdout=out)
    return json.loads(out.getvalue())


def test_export_con_hash_e_nome_diviso():
    anna = UserFactory(email="anna@regalino.test", display_name="Anna Maria Bianchi",
                       language="en", email_verified_at=timezone.now())
    anna.last_login = timezone.now()
    anna.save()
    senza = UserFactory(email="zeta@regalino.test", display_name="Zeta", is_active=False)
    senza.set_unusable_password()
    senza.save()

    rows = {row["email"]: row for row in _export()}
    row = rows["anna@regalino.test"]
    assert row["password"] == anna.password and row["password"].startswith("md5$")
    assert (row["first_name"], row["last_name"]) == ("Anna", "Maria Bianchi")
    assert row["display_name"] == "Anna Maria Bianchi"
    assert row["language"] == "en"
    assert row["email_verified"] is True and row["is_active"] is True
    assert row["date_joined"].startswith(str(anna.date_joined.year))
    assert row["last_login"] is not None

    row = rows["zeta@regalino.test"]
    assert row["password"] == ""
    assert (row["first_name"], row["last_name"]) == ("Zeta", "")
    assert row["email_verified"] is False and row["is_active"] is False
    assert row["last_login"] is None
    assert set(row) == {
        "email", "password", "first_name", "last_name", "display_name", "language",
        "email_verified", "is_active", "date_joined", "last_login",
    }
