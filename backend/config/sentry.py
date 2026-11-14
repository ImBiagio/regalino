"""Segnalazione degli errori a GlitchTip (parla il protocollo di Sentry, ADR 0019).

Parte solo se ``SENTRY_DSN`` non e' vuota: senza, nessuna richiesta esce e
l'SDK resta spento. La chiamano i settings di sviluppo e di produzione, mai
quelli dei test.
"""

from __future__ import annotations

import os


def init_sentry() -> bool:
    """Accende l'SDK se c'e' una DSN; dice se l'ha acceso."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False

    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "").strip() or "production",
        # Django: le eccezioni non gestite delle richieste. Celery: quelle dei
        # task, nel worker (i settings li carica anche lui).
        integrations=[DjangoIntegration(), CeleryIntegration()],
        # Niente dati personali: ne' utente, ne' IP, ne' cookie, ne' il corpo
        # delle richieste, ne' le variabili locali dello stack (dentro ci sono
        # email, regali, codice d'invito). Restano tipo, messaggio e stack.
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        # Solo errori: niente tracce delle prestazioni, niente sessioni
        # (GlitchTip non le usa).
        traces_sample_rate=0,
        auto_session_tracking=False,
    )
    return True
