"""Liste dei regali e idee "da regalare".

Due cose diverse, che non si toccano:

- ``WishList`` + ``Wish``: i regali che *io* vorrei ricevere. La lista si
  condivide con un link segreto (``share_token``): chi lo ha vede i regali e
  puo' spuntarli come fatti, senza account.
- ``GiftIdea``: i regali che ho in mente *per gli altri*. Privata, la vede solo
  chi l'ha scritta.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _
from simple_history.models import HistoricalRecords

from apps.core.methods import random_token
from apps.core.models import BaseModel


def new_share_token() -> str:
    return random_token(18)


class WishList(BaseModel):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wish_lists"
    )
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    # Compleanno, Natale, matrimonio: solo per ordinare e mostrarla a chi regala.
    event_date = models.DateField(null=True, blank=True)
    # Il link pubblico e' /l/<share_token>. Rigenerarlo spegne quello vecchio.
    share_token = models.CharField(max_length=40, unique=True, default=new_share_token)
    # Di default il proprietario non vede cosa e' gia' stato regalato: la
    # sorpresa resta. Chi preferisce saperlo (es. per non ricevere doppioni
    # dalla stessa persona) lo accende.
    show_gifted = models.BooleanField(default=False)

    history = HistoricalRecords()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


class Wish(BaseModel):
    wish_list = models.ForeignKey(WishList, on_delete=models.CASCADE, related_name="items")
    title = models.CharField(max_length=160)
    notes = models.TextField(blank=True)
    url = models.URLField(max_length=500, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # Spuntato da chi ha il link. ``claim_key_hash`` e' l'hash della chiave data
    # a chi ha spuntato: solo lui (o l'utente loggato che l'ha fatto) puo'
    # togliere la spunta.
    gifted_at = models.DateTimeField(null=True, blank=True)
    gifted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="gifts_made",
    )
    gifted_by_name = models.CharField(max_length=80, blank=True)
    claim_key_hash = models.CharField(max_length=64, blank=True)

    history = HistoricalRecords(excluded_fields=["claim_key_hash"])

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.title

    @property
    def is_gifted(self) -> bool:
        return self.gifted_at is not None

    def clear_gift(self) -> None:
        self.gifted_at = None
        self.gifted_by = None
        self.gifted_by_name = ""
        self.claim_key_hash = ""
        self.save(
            update_fields=[
                "gifted_at",
                "gifted_by",
                "gifted_by_name",
                "claim_key_hash",
                "updated_at",
            ]
        )


class GiftIdea(BaseModel):
    class Status(models.TextChoices):
        IDEA = "idea", _("Idea")
        BOUGHT = "bought", _("Comprato")
        GIVEN = "given", _("Regalato")

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gift_ideas"
    )
    # Per chi: testo libero, non un utente (la mamma non ha un account).
    recipient = models.CharField(max_length=80)
    title = models.CharField(max_length=160)
    notes = models.TextField(blank=True)
    url = models.URLField(max_length=500, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    occasion = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.IDEA)

    history = HistoricalRecords()

    class Meta:
        ordering = ["recipient", "created_at"]

    def __str__(self) -> str:
        return f"{self.title} → {self.recipient}"
