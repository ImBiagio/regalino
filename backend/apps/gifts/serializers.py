from __future__ import annotations

from decimal import Decimal

from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import GiftIdea, GiftImage, Wish, WishList, WishListMember


def validate_price(value: Decimal | None) -> Decimal | None:
    if value is not None and value < 0:
        raise serializers.ValidationError(_("Il prezzo non puo' essere negativo."))
    return value


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


class ImageUploadSerializer(serializers.Serializer):
    file = serializers.FileField()


class ImageFromUrlSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=1000)


class LinkReadSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=1000)
    # Falso quando nel form c'e' gia' una foto scelta a mano.
    image = serializers.BooleanField(default=True)


class LinkDescriptionSerializer(serializers.Serializer):
    """Proposte per il form: il form le usa solo nei campi ancora liberi."""

    title = serializers.CharField(allow_blank=True)
    price = serializers.DecimalField(max_digits=10, decimal_places=2, allow_null=True)
    notes = serializers.CharField(allow_blank=True)


class LinkDetailsSerializer(LinkDescriptionSerializer):
    image = GiftImageSerializer(allow_null=True)
    image_error = serializers.CharField(allow_null=True)
    # Per ``links/describe``; null se Gemini non si usa.
    describe_id = serializers.CharField(allow_null=True)


class LinkDescribeSerializer(serializers.Serializer):
    describe_id = serializers.CharField(max_length=64)


class WishSerializer(ImageFieldsMixin, serializers.ModelSerializer):
    """Un regalo visto dal proprietario della lista.

    Lo stato "regalato" esce solo se la lista ha ``show_gifted``: altrimenti
    ``gifted`` e' ``None``, cosi' il frontend non puo' rovinare la sorpresa
    nemmeno per sbaglio.
    """

    gifted = serializers.SerializerMethodField()
    gifted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Wish
        fields = [
            "id",
            "title",
            "notes",
            "url",
            "price",
            "image",
            "image_id",
            "gifted",
            "gifted_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_price(self, value):
        return validate_price(value)

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


class GiftIdeaSerializer(ImageFieldsMixin, serializers.ModelSerializer):
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
            "occasion",
            "status",
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


# --------------------------------------------------------- lista condivisa --


class SharedWishSerializer(serializers.ModelSerializer):
    """Un regalo visto da chi ha il link: niente chiavi, niente id utente."""

    gifted = serializers.SerializerMethodField()
    gifted_by_name = serializers.SerializerMethodField()
    # Spuntato dall'utente loggato che sta guardando: puo' togliere la spunta
    # anche da un altro dispositivo, senza la chiave salvata nel browser.
    mine = serializers.SerializerMethodField()
    image = serializers.SerializerMethodField()

    class Meta:
        model = Wish
        fields = [
            "id",
            "title",
            "notes",
            "url",
            "price",
            "image",
            "gifted",
            "gifted_by_name",
            "mine",
        ]
        read_only_fields = fields

    def get_image(self, obj: Wish) -> str | None:
        return image_url(obj.image)

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
        items = obj.items.select_related("image")
        return SharedWishSerializer(items, many=True, context=self.context).data

    @extend_schema_field(SharedSectionSerializer(many=True))
    def get_sections(self, obj: WishList):
        """Le liste incluse, ognuna col contesto suo: chi scrive *quella* non ne vede le spunte."""
        context_of = self.context["context_of"]
        sections = []
        for child in alive_children(obj):
            items = child.items.select_related("image")
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
