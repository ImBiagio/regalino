from __future__ import annotations

from decimal import Decimal

from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .links import clean_url
from .models import GiftIdea, GiftImage, Notification, Wish, WishList, WishListMember


def validate_price(value: Decimal | None) -> Decimal | None:
    if value is not None and value < 0:
        raise serializers.ValidationError(_("Il prezzo non puo' essere negativo."))
    return value


def validate_url(value: str) -> str:
    """Il link si salva ripulito dal tracciamento: su Amazon resta solo ``/dp/ASIN``."""
    return clean_url(value) if value else value


def image_url(image: GiftImage | None) -> str | None:
    """Percorso pubblico della foto (``/media/...``): il client ci mette l'origine."""
    return image.file.url if image and image.file else None


class GiftImageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = GiftImage
        fields = ["id", "url", "width", "height", "source_url"]
        read_only_fields = fields

    def get_url(self, obj: GiftImage) -> str | None:
        return image_url(obj)


class ImageFieldsMixin(serializers.Serializer):
    """``image`` in lettura (l'URL), ``image_id`` in scrittura (``null`` toglie la foto).

    La foto deve essere dell'utente che salva: l'id di una foto altrui non si
    puo' attaccare ai propri regali.
    """

    image = serializers.SerializerMethodField()
    image_id = serializers.PrimaryKeyRelatedField(
        source="image",
        queryset=GiftImage.objects.none(),
        required=False,
        allow_null=True,
        write_only=True,
    )

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            fields["image_id"].queryset = GiftImage.objects.filter(owner=request.user)
        return fields

    def get_image(self, obj) -> str | None:
        return image_url(obj.image)


class PricePointSerializer(serializers.Serializer):
    at = serializers.DateTimeField(source="seen_at", read_only=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)


class PriceMixin(serializers.Serializer):
    """Andamento del prezzo e campanella di chi guarda (ADR 0011).

    ``price_points`` e ``watches`` sono prefetchati dalle viste: niente query
    per card. Chi guarda e' ``request.user`` o, sul link, ``viewer_id``.
    """

    price_history = serializers.SerializerMethodField()
    watching = serializers.SerializerMethodField()

    @extend_schema_field(PricePointSerializer(many=True))
    def get_price_history(self, obj):
        points = list(obj.price_points.all())[-60:]
        return PricePointSerializer(points, many=True).data

    def _viewer_id(self):
        if "viewer_id" in self.context:
            return self.context["viewer_id"]
        request = self.context.get("request")
        return request.user.pk if request is not None and request.user.is_authenticated else None

    def get_watching(self, obj) -> bool:
        viewer = self._viewer_id()
        return viewer is not None and any(w.user_id == viewer for w in obj.watches.all())


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "title", "body", "url", "read_at", "created_at"]
        read_only_fields = fields


class ImageUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class ImageFromUrlSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=2000)


class LinkReadSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=2000)
    # Falso quando nel form c'e' gia' una foto scelta a mano.
    image = serializers.BooleanField(default=True)


class LinkDescriptionSerializer(serializers.Serializer):
    """Proposte per il form: il form le usa solo nei campi ancora liberi."""

    title = serializers.CharField(allow_blank=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    notes = serializers.CharField(allow_blank=True)
    gtin = serializers.CharField(allow_blank=True)
    brand = serializers.CharField(allow_blank=True)


class LinkDetailsSerializer(LinkDescriptionSerializer):
    image = GiftImageSerializer(allow_null=True)
    image_error = serializers.CharField(allow_null=True)
    # Per ``links/describe``; null se Gemini non si usa.
    describe_id = serializers.CharField(allow_null=True)


class SuggestSerializer(serializers.Serializer):
    """Cosa sa il wizard "Ispirami" della persona (ADR 0010). Tutto facoltativo."""

    recipient = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    relation = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    age = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    interests = serializers.ListField(
        child=serializers.CharField(max_length=60), required=False, default=list, max_length=20
    )
    avoid = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    occasion = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    budget_min = serializers.CharField(max_length=12, required=False, allow_blank=True, default="")
    budget_max = serializers.CharField(max_length=12, required=False, allow_blank=True, default="")
    # Titoli gia' proposti, per "altre idee".
    exclude = serializers.ListField(
        child=serializers.CharField(max_length=160), required=False, default=list, max_length=40
    )


class SharedSuggestSerializer(serializers.Serializer):
    """Alternative a un regalo gia' preso, dal link condiviso."""

    item_id = serializers.UUIDField()
    exclude = serializers.ListField(
        child=serializers.CharField(max_length=160), required=False, default=list, max_length=40
    )


class SuggestionSerializer(serializers.Serializer):
    title = serializers.CharField()
    why = serializers.CharField(allow_blank=True)
    price = serializers.CharField(allow_blank=True)
    query = serializers.CharField(allow_blank=True)


class LinkDescribeSerializer(serializers.Serializer):
    describe_id = serializers.CharField(max_length=64)


class WishSerializer(ImageFieldsMixin, PriceMixin, serializers.ModelSerializer):
    """Un regalo visto dal proprietario della lista.

    Lo stato "regalato" esce solo se la lista ha ``show_gifted``: altrimenti
    ``gifted`` e' ``None``, cosi' il frontend non puo' rovinare la sorpresa
    nemmeno per sbaglio.
    """

    gifted = serializers.SerializerMethodField()
    gifted_by_name = serializers.SerializerMethodField()
    # "Va con": in scrittura l'id di un regalo della stessa lista (``null`` lo toglie).
    requires_id = serializers.PrimaryKeyRelatedField(
        source="requires", queryset=Wish.objects.all(), required=False, allow_null=True
    )
    requires_title = serializers.SerializerMethodField()

    class Meta:
        model = Wish
        fields = [
            "id",
            "title",
            "notes",
            "url",
            "price",
            "quantity",
            "image",
            "image_id",
            "gtin",
            "brand",
            "requires_id",
            "requires_title",
            "price_history",
            "watching",
            "gifted",
            "gifted_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_price(self, value):
        return validate_price(value)

    def validate_url(self, value: str) -> str:
        return validate_url(value)

    def validate_requires_id(self, value: Wish | None) -> Wish | None:
        """Della stessa lista, non se stesso, e senza giri (A va con B che va con A)."""
        if value is None:
            return None
        wish_list = self.context["view"].get_wish_list()
        if value.wish_list_id != wish_list.pk:
            raise serializers.ValidationError(_("Scegli un regalo di questa lista."))
        if self.instance is not None:
            if value.pk == self.instance.pk:
                raise serializers.ValidationError(_("Un regalo non puo' andare con se stesso."))
            current: Wish | None = value
            for _step in range(50):
                if current is None:
                    break
                if current.pk == self.instance.pk:
                    raise serializers.ValidationError(
                        _("«%(title)s» va gia' con questo regalo: sarebbe un giro.")
                        % {"title": value.title}
                    )
                current = current.required_gift
        return value

    def get_requires_title(self, obj: Wish) -> str:
        required = obj.required_gift
        return required.title if required else ""

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Un regalo cancellato non si mostra piu' come "va con".
        if instance.required_gift is None:
            data["requires_id"] = None
        return data

    def _reveals(self, obj: Wish) -> bool:
        return obj.wish_list.show_gifted

    def get_gifted(self, obj: Wish) -> bool | None:
        return obj.is_gifted if self._reveals(obj) else None

    def get_gifted_by_name(self, obj: Wish) -> str:
        return obj.gifted_by_name if self._reveals(obj) and obj.is_gifted else ""


class PersonSerializer(serializers.Serializer):
    """Chi e' (proprietario, membro): solo id e nome, mai l'email."""

    id = serializers.UUIDField(read_only=True)
    display_name = serializers.CharField(read_only=True)


class IncludedListSerializer(serializers.Serializer):
    """Una lista vista da quella che la include: quanto basta per la sezione."""

    id = serializers.UUIDField(read_only=True)
    title = serializers.CharField(read_only=True)
    event_date = serializers.DateField(read_only=True, allow_null=True)
    item_count = serializers.SerializerMethodField()

    def get_item_count(self, obj: WishList) -> int:
        return obj.items.count()


class ListRefSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    title = serializers.CharField(read_only=True)


def alive_children(wish_list: WishList) -> list[WishList]:
    """Le liste incluse ancora vive, nell'ordine in cui sono state incluse."""
    links = wish_list.inclusions.filter(child__deleted_at__isnull=True).select_related("child")
    return [link.child for link in links]


class WishListSerializer(serializers.ModelSerializer):
    item_count = serializers.IntegerField(read_only=True, default=0)
    gifted_count = serializers.SerializerMethodField()
    owner = PersonSerializer(read_only=True)
    members = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    included_lists = serializers.SerializerMethodField()
    included_in = serializers.SerializerMethodField()
    # In scrittura: gli id delle liste da includere (tutte, non la differenza).
    included_list_ids = serializers.ListField(
        child=serializers.UUIDField(), write_only=True, required=False
    )

    class Meta:
        model = WishList
        fields = [
            "id",
            "title",
            "description",
            "event_date",
            "show_gifted",
            "share_token",
            "invite_token",
            "owner",
            "members",
            "is_owner",
            "included_lists",
            "included_in",
            "included_list_ids",
            "item_count",
            "gifted_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "share_token", "invite_token", "created_at", "updated_at"]

    def get_gifted_count(self, obj: WishList) -> int | None:
        if not obj.show_gifted:
            return None
        return getattr(obj, "gifted_total", None) or 0

    @extend_schema_field(PersonSerializer(many=True))
    def get_members(self, obj: WishList):
        # ``memberships`` e' prefetchato dalla vista: ordinato per ingresso.
        return PersonSerializer([m.user for m in obj.memberships.all()], many=True).data

    def get_is_owner(self, obj: WishList) -> bool:
        request = self.context.get("request")
        return request is not None and request.user.pk == obj.owner_id

    @extend_schema_field(IncludedListSerializer(many=True))
    def get_included_lists(self, obj: WishList):
        return IncludedListSerializer(alive_children(obj), many=True).data

    @extend_schema_field(ListRefSerializer(many=True))
    def get_included_in(self, obj: WishList):
        parents = obj.inclusion_links.filter(parent__deleted_at__isnull=True).select_related(
            "parent"
        )
        return ListRefSerializer([link.parent for link in parents], many=True).data

    def validate_included_list_ids(self, ids: list) -> list[WishList]:
        """Le liste da includere: proprie, vive, non questa, e un solo livello (ADR 0008)."""
        ids = list(dict.fromkeys(ids))
        if not ids:
            return []
        if self.instance is not None and self.instance.pk in ids:
            raise serializers.ValidationError(_("Una lista non puo' includere se stessa."))
        if self.instance is not None and self.instance.inclusion_links.filter(
            parent__deleted_at__isnull=True
        ).exists():
            raise serializers.ValidationError(
                _("Questa lista e' gia' dentro un'altra: non puo' includerne altre a sua volta.")
            )
        user = self.context["request"].user
        found = {wl.pk: wl for wl in WishList.for_user(user).filter(pk__in=ids)}
        if len(found) != len(ids):
            raise serializers.ValidationError(_("Una delle liste non esiste piu'."))
        for wl in found.values():
            if wl.inclusions.filter(child__deleted_at__isnull=True).exists():
                message = _("«%(title)s» include gia' altre liste: una inclusa non ne include.")
                raise serializers.ValidationError(message % {"title": wl.title})
        return [found[pk] for pk in ids]

    def create(self, validated_data):
        children = validated_data.pop("included_list_ids", None)
        wish_list = super().create(validated_data)
        if children:
            wish_list.included_lists.set(children)
        return wish_list

    def update(self, instance, validated_data):
        children = validated_data.pop("included_list_ids", None)
        wish_list = super().update(instance, validated_data)
        if children is not None:
            wish_list.included_lists.set(children)
        return wish_list


class InviteSerializer(serializers.Serializer):
    """L'anteprima di un invito: cosa si accetta, prima di entrare."""

    id = serializers.UUIDField(read_only=True)
    title = serializers.CharField(read_only=True)
    event_date = serializers.DateField(read_only=True, allow_null=True)
    owner_name = serializers.CharField(read_only=True)
    member_count = serializers.IntegerField(read_only=True)
    already_member = serializers.BooleanField(read_only=True)


def invite_data(wish_list: WishList, user) -> dict:
    return {
        "id": wish_list.id,
        "title": wish_list.title,
        "event_date": wish_list.event_date,
        "owner_name": wish_list.owner.display_name,
        "member_count": WishListMember.objects.filter(wish_list=wish_list).count(),
        "already_member": wish_list.is_member(user),
    }


class GiftIdeaSerializer(ImageFieldsMixin, PriceMixin, serializers.ModelSerializer):
    class Meta:
        model = GiftIdea
        fields = [
            "id",
            "recipient",
            "title",
            "notes",
            "url",
            "price",
            "image",
            "image_id",
            "gtin",
            "brand",
            "occasion",
            "status",
            "price_history",
            "watching",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_recipient(self, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError(_("Scrivi per chi e' il regalo."))
        return value

    def validate_price(self, value):
        return validate_price(value)

    def validate_url(self, value: str) -> str:
        return validate_url(value)


# --------------------------------------------------------- lista condivisa --


class SharedWishSerializer(PriceMixin, serializers.ModelSerializer):
    """Un regalo visto da chi ha il link: niente chiavi, niente id utente."""

    gifted = serializers.SerializerMethodField()
    gifted_by_name = serializers.SerializerMethodField()
    # Spuntato dall'utente loggato che sta guardando: puo' togliere la spunta
    # anche da un altro dispositivo, senza la chiave salvata nel browser.
    mine = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()
    # Il regalo con cui va (stessa lista): si spunta solo dopo quello.
    requires_id = serializers.SerializerMethodField()

    class Meta:
        model = Wish
        fields = [
            "id",
            "title",
            "notes",
            "url",
            "price",
            "quantity",
            "image",
            "gtin",
            "brand",
            "requires_id",
            "price_history",
            "watching",
            "gifted",
            "gifted_by_name",
            "mine",
        ]
        read_only_fields = fields

    def get_image(self, obj: Wish) -> str | None:
        return image_url(obj.image)

    def get_requires_id(self, obj: Wish) -> str | None:
        required = obj.required_gift
        return str(required.pk) if required else None

    def _hidden(self) -> bool:
        # Il proprietario che apre il proprio link non deve vedere le spunte,
        # a meno che non abbia scelto di vederle.
        return bool(self.context.get("hide_gifted"))

    def get_gifted(self, obj: Wish) -> bool | None:
        return None if self._hidden() else obj.is_gifted

    def get_gifted_by_name(self, obj: Wish) -> str:
        return "" if self._hidden() or not obj.is_gifted else obj.gifted_by_name

    def get_mine(self, obj: Wish) -> bool:
        viewer = self.context.get("viewer_id")
        return viewer is not None and obj.is_gifted and obj.gifted_by_id == viewer


class SharedSectionSerializer(serializers.Serializer):
    """Una lista inclusa, vista dal link di quella che la include."""

    id = serializers.UUIDField(read_only=True)
    title = serializers.CharField(read_only=True)
    event_date = serializers.DateField(read_only=True, allow_null=True)
    items = SharedWishSerializer(many=True, read_only=True)


class SharedWishListSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source="owner.display_name", read_only=True)
    is_owner = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    sections = serializers.SerializerMethodField()

    class Meta:
        model = WishList
        fields = [
            "title",
            "description",
            "event_date",
            "owner_name",
            "is_owner",
            "items",
            "sections",
        ]
        read_only_fields = fields

    def get_is_owner(self, obj: WishList) -> bool:
        return bool(self.context.get("is_owner"))

    @extend_schema_field(SharedWishSerializer(many=True))
    def get_items(self, obj: WishList):
        items = obj.items.select_related("image", "requires").prefetch_related(
            "price_points", "watches"
        )
        return SharedWishSerializer(items, many=True, context=self.context).data

    @extend_schema_field(SharedSectionSerializer(many=True))
    def get_sections(self, obj: WishList):
        """Le liste incluse, ognuna col contesto suo: chi scrive *quella* non ne vede le spunte."""
        context_of = self.context["context_of"]
        sections = []
        for child in alive_children(obj):
            items = child.items.select_related("image", "requires").prefetch_related(
                "price_points", "watches"
            )
            sections.append(
                {
                    "id": child.id,
                    "title": child.title,
                    "event_date": child.event_date,
                    "items": SharedWishSerializer(items, many=True, context=context_of(child)).data,
                }
            )
        # Gia' dizionari: ripassarli dal serializer li romperebbe.
        return sections


class GiftClaimSerializer(serializers.Serializer):
    """Chi spunta puo' lasciare il nome, cosi' gli altri sanno chi ci ha pensato."""

    name = serializers.CharField(max_length=80, required=False, allow_blank=True)


class GiftReleaseSerializer(serializers.Serializer):
    claim_key = serializers.CharField(required=False, allow_blank=True)
