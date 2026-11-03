from __future__ import annotations

from decimal import Decimal

from django.utils.translation import gettext as _
from rest_framework import serializers

from .models import GiftIdea, Wish, WishList


def validate_price(value: Decimal | None) -> Decimal | None:
    if value is not None and value < 0:
        raise serializers.ValidationError(_("Il prezzo non puo' essere negativo."))
    return value


class WishSerializer(serializers.ModelSerializer):
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


class WishListSerializer(serializers.ModelSerializer):
    item_count = serializers.IntegerField(read_only=True, default=0)
    gifted_count = serializers.SerializerMethodField()

    class Meta:
        model = WishList
        fields = [
            "id",
            "title",
            "description",
            "event_date",
            "show_gifted",
            "share_token",
            "item_count",
            "gifted_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "share_token", "created_at", "updated_at"]

    def get_gifted_count(self, obj: WishList) -> int | None:
        if not obj.show_gifted:
            return None
        return getattr(obj, "gifted_total", None) or 0


class GiftIdeaSerializer(serializers.ModelSerializer):
    class Meta:
        model = GiftIdea
        fields = [
            "id",
            "recipient",
            "title",
            "notes",
            "url",
            "price",
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

    class Meta:
        model = Wish
        fields = ["id", "title", "notes", "url", "price", "gifted", "gifted_by_name", "mine"]
        read_only_fields = fields

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


class SharedWishListSerializer(serializers.ModelSerializer):
    owner_name = serializers.CharField(source="owner.display_name", read_only=True)
    is_owner = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()

    class Meta:
        model = WishList
        fields = ["title", "description", "event_date", "owner_name", "is_owner", "items"]
        read_only_fields = fields

    def get_is_owner(self, obj: WishList) -> bool:
        return bool(self.context.get("is_owner"))

    def get_items(self, obj: WishList):
        return SharedWishSerializer(obj.items.all(), many=True, context=self.context).data


class GiftClaimSerializer(serializers.Serializer):
    """Chi spunta puo' lasciare il nome, cosi' gli altri sanno chi ci ha pensato."""

    name = serializers.CharField(max_length=80, required=False, allow_blank=True)


class GiftReleaseSerializer(serializers.Serializer):
    claim_key = serializers.CharField(required=False, allow_blank=True)
