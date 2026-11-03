from __future__ import annotations

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.methods import hash_secret, random_token

from .models import GiftIdea, Wish, WishList, new_share_token
from .serializers import (
    GiftClaimSerializer,
    GiftIdeaSerializer,
    GiftReleaseSerializer,
    SharedWishListSerializer,
    SharedWishSerializer,
    WishListSerializer,
    WishSerializer,
)

# Le liste di regali sono corte: niente paginazione, il client riceve tutto.
NO_PAGINATION = None

ALIVE_ITEMS = Q(items__deleted_at__isnull=True)


class WishListViewSet(viewsets.ModelViewSet):
    """Le liste dell'utente: ognuno vede e tocca solo le sue."""

    serializer_class = WishListSerializer
    pagination_class = NO_PAGINATION

    def get_queryset(self):
        return WishList.objects.filter(owner=self.request.user).annotate(
            item_count=Count("items", filter=ALIVE_ITEMS),
            gifted_total=Count("items", filter=ALIVE_ITEMS & Q(items__gifted_at__isnull=False)),
        )

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @extend_schema(request=None, responses={200: WishListSerializer})
    @action(detail=True, methods=["post"], url_path="regenerate-link")
    def regenerate_link(self, request, pk=None):
        """Link nuovo: chi aveva il vecchio non vede piu' la lista."""
        wish_list = self.get_object()
        wish_list.share_token = new_share_token()
        wish_list.save(update_fields=["share_token", "updated_at"])
        return Response(self.get_serializer(self.get_object()).data)


class WishViewSet(viewsets.ModelViewSet):
    """I regali di una lista, sotto ``lists/<list_pk>/items``."""

    serializer_class = WishSerializer
    pagination_class = NO_PAGINATION

    def get_wish_list(self) -> WishList:
        # 404 e non 403 anche per le liste altrui: la loro esistenza non si dice.
        if getattr(self, "_wish_list", None) is None:
            self._wish_list = get_object_or_404(
                WishList.objects.filter(owner=self.request.user), pk=self.kwargs["list_pk"]
            )
        return self._wish_list

    def get_queryset(self):
        return (
            Wish.objects.filter(wish_list=self.get_wish_list())
            .select_related("wish_list")
            .order_by("created_at")
        )

    def perform_create(self, serializer):
        serializer.save(wish_list=self.get_wish_list())

    @extend_schema(request=None, responses={200: WishSerializer})
    @action(detail=True, methods=["delete"], url_path="gift")
    def clear_gift(self, request, list_pk=None, pk=None):
        """Toglie una spunta sbagliata. Solo se il proprietario vede le spunte."""
        wish = self.get_object()
        if not wish.wish_list.show_gifted:
            raise ValidationError(
                {"detail": _("Attiva \"Mostrami cosa e' stato regalato\" per gestire le spunte.")}
            )
        wish.clear_gift()
        return Response(self.get_serializer(wish).data)


class GiftIdeaViewSet(viewsets.ModelViewSet):
    """La lista "Da regalare": idee per gli altri, private."""

    serializer_class = GiftIdeaSerializer
    pagination_class = NO_PAGINATION
    filterset_fields = ["status", "recipient"]

    def get_queryset(self):
        return GiftIdea.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


# ------------------------------------------------------- lista condivisa --


def _shared_list(token: str) -> WishList:
    return get_object_or_404(WishList.objects.select_related("owner"), share_token=token)


def _is_owner(request, wish_list: WishList) -> bool:
    return request.user.is_authenticated and request.user.pk == wish_list.owner_id


def _shared_context(request, wish_list: WishList) -> dict:
    is_owner = _is_owner(request, wish_list)
    return {
        "is_owner": is_owner,
        "hide_gifted": is_owner and not wish_list.show_gifted,
        "viewer_id": request.user.pk if request.user.is_authenticated else None,
    }


class SharedListView(APIView):
    """La lista vista da chi ha il link: basta il token, nessun account."""

    permission_classes = [AllowAny]
    throttle_scope = "shared"

    @extend_schema(responses={200: SharedWishListSerializer})
    def get(self, request, token: str):
        wish_list = _shared_list(token)
        context = _shared_context(request, wish_list)
        return Response(SharedWishListSerializer(wish_list, context=context).data)


ClaimResponse = inline_serializer(
    "GiftClaimResponse",
    {"claim_key": serializers.CharField(), "item": SharedWishSerializer()},
)


class SharedGiftView(APIView):
    """Spunta "regalato" (POST) e la toglie (DELETE) dalla lista condivisa."""

    permission_classes = [AllowAny]
    throttle_scope = "shared"

    def _wish(self, token: str, item_id) -> tuple[WishList, Wish]:
        wish_list = _shared_list(token)
        # select_for_update: due persone che spuntano insieme non vincono entrambe.
        wish = get_object_or_404(
            Wish.objects.select_for_update().filter(wish_list=wish_list), pk=item_id
        )
        return wish_list, wish

    @extend_schema(request=GiftClaimSerializer, responses={201: ClaimResponse})
    def post(self, request, token: str, item_id):
        serializer = GiftClaimSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        wish_list, wish = self._wish(token, item_id)
        if _is_owner(request, wish_list):
            return Response(
                {"detail": _("Non puoi spuntare i regali della tua lista.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        if wish.is_gifted:
            return Response(
                {"detail": _("Qualcuno l'ha appena regalato: ricarica la lista.")},
                status=status.HTTP_409_CONFLICT,
            )

        user = request.user if request.user.is_authenticated else None
        name = (serializer.validated_data.get("name") or "").strip()
        if not name and user is not None:
            name = user.display_name
        claim_key = random_token(24)
        wish.gifted_at = timezone.now()
        wish.gifted_by = user
        wish.gifted_by_name = name
        wish.claim_key_hash = hash_secret(claim_key)
        wish.save(
            update_fields=[
                "gifted_at",
                "gifted_by",
                "gifted_by_name",
                "claim_key_hash",
                "updated_at",
            ]
        )
        context = _shared_context(request, wish_list)
        return Response(
            {"claim_key": claim_key, "item": SharedWishSerializer(wish, context=context).data},
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(request=GiftReleaseSerializer, responses={200: SharedWishSerializer})
    def delete(self, request, token: str, item_id):
        serializer = GiftReleaseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        wish_list, wish = self._wish(token, item_id)
        context = _shared_context(request, wish_list)
        if not wish.is_gifted:
            return Response(SharedWishSerializer(wish, context=context).data)

        claim_key = serializer.validated_data.get("claim_key") or ""
        by_key = bool(claim_key) and hash_secret(claim_key) == wish.claim_key_hash
        by_user = request.user.is_authenticated and wish.gifted_by_id == request.user.pk
        if not (by_key or by_user):
            return Response(
                {"detail": _("Solo chi l'ha spuntato puo' togliere la spunta.")},
                status=status.HTTP_403_FORBIDDEN,
            )
        wish.clear_gift()
        return Response(SharedWishSerializer(wish, context=context).data)

