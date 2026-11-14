"""Segnalazione degli errori (ADR 0019): accesa solo con una DSN, mai nei test."""

from __future__ import annotations

import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.django import DjangoIntegration

from config.sentry import init_sentry

DSN = "https://chiave@glitchtip.invalid/1"


def test_nei_test_l_sdk_e_spento():
    assert not sentry_sdk.get_client().is_active()


def test_senza_dsn_non_parte(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert init_sentry() is False
    monkeypatch.setenv("SENTRY_DSN", "  ")
    assert init_sentry() is False
    assert calls == []


def test_con_la_dsn_parte_senza_dati_personali_ne_tracce(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setenv("SENTRY_DSN", DSN)
    monkeypatch.delenv("SENTRY_ENVIRONMENT", raising=False)
    assert init_sentry() is True
    [options] = calls
    assert options["dsn"] == DSN
    assert options["environment"] == "production"
    assert options["send_default_pii"] is False
    assert options["traces_sample_rate"] == 0
    assert options["max_request_body_size"] == "never"
    assert options["include_local_variables"] is False
    kinds = {type(integration) for integration in options["integrations"]}
    assert kinds == {DjangoIntegration, CeleryIntegration}


def test_l_ambiente_viene_dal_env(monkeypatch):
    calls = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    monkeypatch.setenv("SENTRY_DSN", DSN)
    monkeypatch.setenv("SENTRY_ENVIRONMENT", "staging")
    init_sentry()
    assert calls[0]["environment"] == "staging"
