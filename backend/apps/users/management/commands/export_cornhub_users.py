"""Esporta gli utenti di regalino per importarli su cornhub (ADR 0020).

Stampa su stdout un elenco JSON, un oggetto per utente, che cornhub legge
per creare gli account della suite con la stessa password: l'hash di Django
passa cosi' com'e' (cornhub usa gli stessi hasher), quindi nessuno deve
sceglierne una nuova. Al primo login da cornhub l'utente locale si aggancia
per email verificata e tiene liste, regali e idee.

    docker compose -f compose.prod.yaml exec -T backend \
        python manage.py export_cornhub_users > utenti-regalino.json

Su cornhub: ``manage.py import_users utenti-regalino.json --app regalino``.
Il file contiene gli hash delle password (non le password): resta sul
server e si cancella appena importato.
"""

from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _split_name(display_name: str) -> tuple[str, str]:
    """Il modello ha solo ``display_name``: prima parola nome, il resto cognome."""
    first, _, last = (display_name or "").strip().partition(" ")
    return first, last.strip()


def user_row(user) -> dict:
    first_name, last_name = _split_name(user.display_name)
    return {
        "email": user.email,
        # Un hash non utilizzabile (``!...``) non vale come password su cornhub.
        "password": user.password if user.has_usable_password() else "",
        "first_name": first_name,
        "last_name": last_name,
        "display_name": user.display_name,
        "language": user.language,
        "email_verified": user.email_verified_at is not None,
        "is_active": user.is_active,
        "date_joined": _iso(user.date_joined),
        "last_login": _last_seen(user),
    }


def _last_seen(user):
    """L'ultimo accesso vero: il login JWT non aggiorna ``last_login``, ma
    ogni login e ogni rinnovo della sessione emette un refresh token. Su
    cornhub serve a far vincere la password dell'app usata per ultima."""
    from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

    token = OutstandingToken.objects.filter(user=user).order_by("-created_at").first()
    seen = [d for d in (user.last_login, token.created_at if token else None) if d]
    return max(seen).isoformat() if seen else None


class Command(BaseCommand):
    help = "Stampa in JSON gli utenti da importare su cornhub."

    def handle(self, *args, **options):
        users = get_user_model().objects.order_by("date_joined")
        self.stdout.write(json.dumps([user_row(user) for user in users], ensure_ascii=False,
                                     indent=2))
