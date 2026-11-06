"""Liste dei regali e idee "da regalare".

Due cose diverse, che non si toccano:

- ``WishList`` + ``Wish``: i regali che *io* vorrei ricevere. La lista si
  condivide con un link segreto (``share_token``): chi lo ha vede i regali e
  puo' spuntarli come fatti, senza account. Una lista puo' essere scritta da
  piu' utenti (``WishListMember``, ADR 0007): chi entra col link d'invito
  (``invite_token``) la vede e la modifica come il proprietario.
- ``GiftIdea``: i regali che ho in mente *per gli altri*. Privata, la vede solo
  chi l'ha scritta.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils.translation import gettext_lazy as _
from simple_history.models import HistoricalRecords

from apps.core.methods import random_token
from apps.core.models import BaseModel


def new_share_token() -> str:
    return random_token(18)


def image_path(instance: GiftImage, filename: str) -> str:
    # Nome casuale e niente nome originale: l'URL non dice nulla del file.
    return f"images/{instance.pk.hex[:2]}/{instance.pk.hex}.webp"


class GiftImage(models.Model):
    """Una foto di regalo, gia' ridotta e convertita in WebP.

    Si carica (o si prende da un link) prima di salvare il regalo, cosi' il
    form mostra l'anteprima; poi un ``Wish`` o una ``GiftIdea`` la collegano.
    Quelle mai collegate, o sostituite, le cancella il task notturno
    ``delete_orphan_images``: e' l'unico punto che toglie file dal disco.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gift_images"
    )
    file = models.ImageField(upload_to=image_path, width_field="width", height_field="height")
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    # Da dove arriva, se presa da un link: utile per capire una foto sbagliata.
    source_url = models.URLField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return str(self.pk)


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
    # Il link d'invito per scrivere insieme (``/unisciti/<invite_token>``):
    # chi lo apre da loggato diventa membro. Nullo finche' nessuno lo crea, e
    # di nuovo nullo quando lo si spegne.
    invite_token = models.CharField(max_length=40, unique=True, null=True, blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title

    @classmethod
    def for_user(cls, user) -> models.QuerySet[WishList]:
        """Le liste che l'utente puo' vedere e modificare: sue o in cui e' membro."""
        return cls.objects.filter(Q(owner=user) | Q(memberships__user=user)).distinct()

    def is_member(self, user) -> bool:
        """Proprietario o membro: chi scrive la lista (e non ne spunta i regali)."""
        if user is None or not user.is_authenticated:
            return False
        return user.pk == self.owner_id or self.memberships.filter(user=user).exists()


class WishListMember(models.Model):
    """Un utente che scrive una lista non sua (ADR 0007).

    Nessun ruolo: chi e' dentro fa tutto quello che fa il proprietario, tranne
    eliminare la lista, rigenerare il link pubblico e togliere gli altri.
    Togliere un membro cancella la riga: non c'e' niente da ripristinare.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wish_list = models.ForeignKey(WishList, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="list_memberships"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["wish_list", "user"], name="unique_list_member")
        ]

    def __str__(self) -> str:
        return f"{self.user} ∈ {self.wish_list}"


class Wish(BaseModel):
    wish_list = models.ForeignKey(WishList, on_delete=models.CASCADE, related_name="items")
    title = models.CharField(max_length=160)
    notes = models.TextField(blank=True)
    url = models.URLField(max_length=500, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    image = models.ForeignKey(
        GiftImage, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

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
    image = models.ForeignKey(
        GiftImage, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.IDEA)

    history = HistoricalRecords()

    class Meta:
        ordering = ["recipient", "created_at"]

    def __str__(self) -> str:
        return f"{self.title} → {self.recipient}"
