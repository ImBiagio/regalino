"""Liste dei regali e idee "da regalare".

Due cose diverse, che non si toccano:

- ``WishList`` + ``Wish``: i regali che *io* vorrei ricevere. La lista si
  condivide con un link segreto (``share_token``): chi lo ha vede i regali e
  puo' spuntarli come fatti, senza account. Una lista puo' essere scritta da
  piu' utenti (``WishListMember``, ADR 0007): chi entra col link d'invito
  (``invite_token``) la vede e la modifica come il proprietario. E puo'
  includerne altre (``WishListInclusion``, ADR 0008): i loro regali compaiono
  anche sotto di lei, nel suo link pubblico.
- ``GiftIdea``: i regali che ho in mente *per gli altri*. Privata, la vede solo
  chi l'ha scritta.
- ``SavedList``: le liste degli altri che ho salvato dal loro link, per
  ritrovarle senza cercare il messaggio (ADR 0014).
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _
from simple_history.models import HistoricalRecords

from apps.core.methods import random_token
from apps.core.models import BaseModel

# Oltre non e' piu' una lista dei regali: chi vuole 100 pezzi scrive un regalo a parte.
MAX_QUANTITY = 99


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
    # Le liste incluse (ADR 0008): i loro regali si vedono anche qui e nel
    # link pubblico di questa, come sezioni. Un solo livello: una lista
    # inclusa non ne include altre, cosi' niente cicli e niente alberi.
    included_lists = models.ManyToManyField(
        "self",
        symmetrical=False,
        through="WishListInclusion",
        related_name="included_in",
        blank=True,
    )

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


class WishListInclusion(models.Model):
    """"La lista B sta dentro la lista A" (ADR 0008)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    parent = models.ForeignKey(WishList, on_delete=models.CASCADE, related_name="inclusions")
    child = models.ForeignKey(WishList, on_delete=models.CASCADE, related_name="inclusion_links")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["parent", "child"], name="unique_list_inclusion")
        ]

    def __str__(self) -> str:
        return f"{self.child} ⊂ {self.parent}"


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


class SavedList(models.Model):
    """Una lista di un altro salvata da chi ha il link (ADR 0014).

    Si ricorda anche il token con cui la si e' salvata: se il proprietario
    rigenera il link, quello vecchio si spegne anche qui (la lista resta in
    "Liste salvate" ma non si apre piu'), come per chiunque altro avesse il
    link. Il titolo e' una copia, per riconoscerla anche quando non si apre.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="saved_lists"
    )
    wish_list = models.ForeignKey(WishList, on_delete=models.CASCADE, related_name="saves")
    share_token = models.CharField(max_length=40)
    title = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "wish_list"], name="unique_saved_list")
        ]

    def __str__(self) -> str:
        return f"{self.user} ★ {self.title}"

    @property
    def is_available(self) -> bool:
        """Il link salvato apre ancora la lista: non e' stata eliminata ne' rigenerata."""
        wish_list = self.wish_list
        return not wish_list.is_deleted and wish_list.share_token == self.share_token


class Wish(BaseModel):
    wish_list = models.ForeignKey(WishList, on_delete=models.CASCADE, related_name="items")
    title = models.CharField(max_length=160)
    notes = models.TextField(blank=True)
    url = models.URLField(max_length=2000, blank=True)
    # Prezzo del singolo pezzo: il totale e' ``price * quantity``.
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Quanti ne servono ("6 bicchieri"): la spunta resta una sola, per tutto
    # l'insieme (ADR 0012); conta solo per il totale e per chi compra.
    quantity = models.PositiveSmallIntegerField(
        default=1, validators=[MinValueValidator(1), MaxValueValidator(MAX_QUANTITY)]
    )
    image = models.ForeignKey(
        GiftImage, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # Codice a barre e marca letti dal link: per cercarlo in altri negozi.
    gtin = models.CharField(max_length=20, blank=True)
    brand = models.CharField(max_length=80, blank=True)
    # "Va con" un altro regalo della stessa lista (ADR 0009): la custodia va
    # con le cuffie. Si puo' spuntare solo quando quello e' gia' preso.
    requires = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="dependents"
    )
    # Quando il task notturno ha riletto il prezzo dal link l'ultima volta (ADR 0011).
    price_checked_at = models.DateTimeField(null=True, blank=True)

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

    @property
    def required_gift(self) -> Wish | None:
        """Il regalo che deve arrivare prima, se c'e' ancora (la cancellazione e' logica)."""
        required = self.requires
        return required if required is not None and not required.is_deleted else None

    @property
    def is_blocked(self) -> bool:
        """Non ancora spuntabile: il regalo con cui va non e' stato preso."""
        required = self.required_gift
        return required is not None and not required.is_gifted

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
    url = models.URLField(max_length=2000, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    occasion = models.CharField(max_length=80, blank=True)
    image = models.ForeignKey(
        GiftImage, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    gtin = models.CharField(max_length=20, blank=True)
    brand = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.IDEA)
    price_checked_at = models.DateTimeField(null=True, blank=True)

    history = HistoricalRecords()

    class Meta:
        ordering = ["recipient", "created_at"]

    def __str__(self) -> str:
        return f"{self.title} → {self.recipient}"


# ------------------------------------------------------------- prezzi --


ONE_TARGET = models.Q(wish__isnull=False, idea__isnull=True) | models.Q(
    wish__isnull=True, idea__isnull=False
)


class PricePoint(models.Model):
    """Un prezzo visto sul link di un regalo o di un'idea, in una data (ADR 0011).

    Il primo punto e' il prezzo con cui il regalo e' stato messo in lista; gli
    altri li scrive il task notturno, solo quando il prezzo cambia.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    wish = models.ForeignKey(
        Wish, on_delete=models.CASCADE, null=True, blank=True, related_name="price_points"
    )
    idea = models.ForeignKey(
        GiftIdea, on_delete=models.CASCADE, null=True, blank=True, related_name="price_points"
    )
    price = models.DecimalField(max_digits=10, decimal_places=2)
    seen_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["seen_at"]
        constraints = [models.CheckConstraint(condition=ONE_TARGET, name="price_point_one_target")]

    def __str__(self) -> str:
        return f"{self.price} @ {self.seen_at:%Y-%m-%d}"


class PriceWatch(models.Model):
    """La campanella: l'utente vuole sapere quando il prezzo scende (ADR 0011)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="price_watches"
    )
    wish = models.ForeignKey(
        Wish, on_delete=models.CASCADE, null=True, blank=True, related_name="watches"
    )
    idea = models.ForeignKey(
        GiftIdea, on_delete=models.CASCADE, null=True, blank=True, related_name="watches"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=ONE_TARGET, name="price_watch_one_target"),
            models.UniqueConstraint(fields=["user", "wish"], name="unique_wish_watch"),
            models.UniqueConstraint(fields=["user", "idea"], name="unique_idea_watch"),
        ]

    def __str__(self) -> str:
        return f"{self.user} ⚲ {self.wish or self.idea}"


class Notification(models.Model):
    """Un avviso nell'app (il prezzo e' sceso): titolo, due righe e dove andare."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    title = models.CharField(max_length=160)
    body = models.CharField(max_length=300, blank=True)
    # Percorso nell'app (``/liste/<id>``, ``/l/<token>``, ``/da-regalare``).
    url = models.CharField(max_length=300, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.title


def record_price(target: Wish | GiftIdea, price, seen_at=None) -> PricePoint | None:
    """Aggiunge un punto se il prezzo e' cambiato rispetto all'ultimo; torna il punto nuovo."""
    last = target.price_points.order_by("-seen_at").first()
    if last is not None and last.price == price:
        return None
    field = "wish" if isinstance(target, Wish) else "idea"
    return PricePoint.objects.create(
        **{field: target}, price=price, seen_at=seen_at or timezone.now()
    )


def seed_price(target: Wish | GiftIdea) -> None:
    """Il primo punto: il prezzo indicativo con cui il regalo entra in lista, se c'e'."""
    if target.price is not None and not target.price_points.exists():
        record_price(target, target.price)


# ----------------------------------------------------------- estensione --


class ExtensionToken(models.Model):
    """La chiave con cui l'estensione Chrome parla con l'API (ADR 0016).

    Una per browser collegato. Sul server resta solo l'hash, come per le
    chiavi di spunta (ADR 0002): la chiave intera la vede solo l'estensione,
    una volta. Vale solo per gli endpoint ``/api/extension/...`` (aggiungere
    un regalo, leggere una pagina, importare), non per il resto dell'account.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="extension_tokens"
    )
    # "Chrome su Mac": lo scrive l'estensione, per riconoscerla in Account.
    name = models.CharField(max_length=80, blank=True)
    key_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.user} ⧉ {self.name or self.pk}"
