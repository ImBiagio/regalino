from __future__ import annotations

from django.conf import settings
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import get_language
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.methods import hash_secret, random_token

from . import ai
from .images import ImageError, process_image
from .links import (
    can_describe,
    declared_details,
    details_of,
    image_from_url,
    image_of,
    read_page,
    recall_page,
    remember_page,
)
from .models import (
    GiftIdea,
    GiftImage,
    Notification,
    PriceWatch,
    SavedList,
    Wish,
    WishList,
    WishListMember,
    new_share_token,
    seed_price,
)
from .serializers import (
    GiftClaimSerializer,
    GiftIdeaSerializer,
    GiftImageSerializer,
    GiftReleaseSerializer,
    ImageFromUrlSerializer,
    ImageUploadSerializer,
    InviteSerializer,
    LinkDescribeSerializer,
    LinkDescriptionSerializer,
    LinkDetailsSerializer,
    LinkReadSerializer,
    NotificationSerializer,
    SavedListSerializer,
    SharedSuggestSerializer,
    SharedWishListSerializer,
    SharedWishSerializer,
    SuggestionSerializer,
    SuggestSerializer,
    WatchSerializer,
    WishListSerializer,
    WishSerializer,
    invite_data,
)

# Le liste di regali sono corte: niente paginazione, il client riceve tutto.
NO_PAGINATION = None

ALIVE_ITEMS = Q(items__deleted_at__isnull=True)


def lists_of(user):
    """Le liste che l'utente scrive (sue o condivise con lui), coi contatori.

    ``distinct=True`` nei conteggi: il join sui membri ripete le righe.
    """
    return (
        WishList.for_user(user)
        .select_related("owner")
        .prefetch_related("memberships__user")
        .annotate(
            item_count=Count("items", filter=ALIVE_ITEMS, distinct=True),
            gifted_total=Count(
                "items", filter=ALIVE_ITEMS & Q(items__gifted_at__isnull=False), distinct=True
            ),
        )
    )


def _owner_only(request, wish_list: WishList) -> None:
    """Eliminare la lista, rigenerare il link, togliere gli altri: solo chi l'ha creata."""
    if request.user.pk != wish_list.owner_id:
        raise PermissionDenied(_("Solo chi ha creato la lista puo' farlo."))


class WishListViewSet(viewsets.ModelViewSet):
    """Le liste dell'utente: le sue e quelle in cui e' membro (ADR 0007)."""

    serializer_class = WishListSerializer
    pagination_class = NO_PAGINATION

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WishList.objects.none()
        return lists_of(self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_destroy(self, instance):
        _owner_only(self.request, instance)
        instance.delete()

    @extend_schema(request=None, responses={200: WishListSerializer})
    @action(detail=True, methods=["post"], url_path="regenerate-link")
    def regenerate_link(self, request, pk=None):
        """Link nuovo: chi aveva il vecchio non vede piu' la lista."""
        wish_list = self.get_object()
        _owner_only(request, wish_list)
        wish_list.share_token = new_share_token()
        wish_list.save(update_fields=["share_token", "updated_at"])
        return Response(self.get_serializer(self.get_object()).data)

    @extend_schema(request=None, responses={200: WishListSerializer})
    @action(detail=True, methods=["post", "delete"], url_path="invite-link")
    def invite_link(self, request, pk=None):
        """POST crea (o rinnova) il link d'invito, DELETE lo spegne.

        Lo puo' fare ogni membro: chi scrive la lista invita chi vuole.
        """
        wish_list = self.get_object()
        wish_list.invite_token = new_share_token() if request.method == "POST" else None
        wish_list.save(update_fields=["invite_token", "updated_at"])
        return Response(self.get_serializer(self.get_object()).data)

    @extend_schema(request=None, responses={200: WishListSerializer})
    @action(detail=True, methods=["delete"], url_path=r"members/(?P<user_id>[^/]+)")
    def remove_member(self, request, pk=None, user_id=None):
        """Toglie un membro: il proprietario chiunque, un membro solo se stesso."""
        wish_list = self.get_object()
        if str(request.user.pk) != user_id:
            _owner_only(request, wish_list)
        deleted, _n = WishListMember.objects.filter(wish_list=wish_list, user_id=user_id).delete()
        if not deleted:
            raise NotFound()
        if str(request.user.pk) == user_id:
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response(self.get_serializer(self.get_object()).data)


class WishViewSet(viewsets.ModelViewSet):
    """I regali di una lista, sotto ``lists/<list_pk>/items``."""

    serializer_class = WishSerializer
    pagination_class = NO_PAGINATION

    def get_wish_list(self) -> WishList:
        # 404 e non 403 anche per le liste altrui: la loro esistenza non si dice.
        if getattr(self, "_wish_list", None) is None:
            self._wish_list = get_object_or_404(
                WishList.for_user(self.request.user), pk=self.kwargs["list_pk"]
            )
        return self._wish_list

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Wish.objects.none()
        return (
            Wish.objects.filter(wish_list=self.get_wish_list())
            .select_related("wish_list", "image", "requires")
            .prefetch_related("price_points", "watches")
            .order_by("created_at")
        )

    def perform_create(self, serializer):
        seed_price(serializer.save(wish_list=self.get_wish_list()))

    def perform_update(self, serializer):
        seed_price(serializer.save())

    @extend_schema(request=None, responses={200: WishSerializer})
    @action(detail=True, methods=["post", "delete"], url_path="watch")
    def watch(self, request, list_pk=None, pk=None):
        """La campanella sul regalo: POST la mette, DELETE la toglie."""
        wish = self.get_object()
        _toggle_watch(request, wish=wish)
        return Response(self.get_serializer(self.get_object()).data)

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


class InviteView(APIView):
    """L'invito a scrivere una lista insieme: anteprima (GET) e ingresso (POST).

    Serve un account: chi entra scrive la lista, e deve avere un nome e una
    sessione per farlo. Un link spento o sbagliato da' 404, senza dire altro.
    """

    throttle_scope = "shared"

    def _wish_list(self, token: str) -> WishList:
        return get_object_or_404(WishList.objects.select_related("owner"), invite_token=token)

    @extend_schema(responses={200: InviteSerializer})
    def get(self, request, token: str):
        wish_list = self._wish_list(token)
        return Response(InviteSerializer(invite_data(wish_list, request.user)).data)

    @extend_schema(request=None, responses={200: WishListSerializer})
    def post(self, request, token: str):
        wish_list = self._wish_list(token)
        if request.user.pk != wish_list.owner_id:
            WishListMember.objects.get_or_create(wish_list=wish_list, user=request.user)
        data = WishListSerializer(
            lists_of(request.user).get(pk=wish_list.pk), context={"request": request}
        ).data
        return Response(data)


def _suggest(data: dict, *, known_gifts: list[str] = (), alternative_to: str = "") -> Response:
    """Le idee di Gemini, o 503 se non si puo' (chiave assente, errore, quota)."""
    if not ai.enabled():
        return Response(
            {"detail": _("I suggerimenti non sono attivi su questo server.")},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    suggestions = ai.suggest_gifts(
        recipient=data.get("recipient", ""),
        relation=data.get("relation", ""),
        age=data.get("age", ""),
        interests=data.get("interests", []),
        avoid=data.get("avoid", ""),
        occasion=data.get("occasion", ""),
        budget_min=data.get("budget_min", ""),
        budget_max=data.get("budget_max", ""),
        known_gifts=list(known_gifts),
        alternative_to=alternative_to,
        exclude=data.get("exclude", []),
        language=(get_language() or "it")[:2],
    )
    if suggestions is None:
        return Response(
            {"detail": _("Adesso non riesco a trovare idee: riprova tra un momento.")},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    return Response(SuggestionSerializer(suggestions, many=True).data)


class SuggestView(APIView):
    """"Ispirami": idee regalo per una persona, da Gemini (ADR 0010)."""

    throttle_scope = "suggest"

    @extend_schema(request=SuggestSerializer, responses={200: SuggestionSerializer(many=True)})
    def post(self, request):
        serializer = SuggestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return _suggest(serializer.validated_data)


class GiftIdeaViewSet(viewsets.ModelViewSet):
    """La lista "Da regalare": idee per gli altri, private."""

    serializer_class = GiftIdeaSerializer
    pagination_class = NO_PAGINATION
    filterset_fields = ["status", "recipient"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return GiftIdea.objects.none()
        return (
            GiftIdea.objects.filter(owner=self.request.user)
            .select_related("image")
            .prefetch_related("price_points", "watches")
        )

    def perform_create(self, serializer):
        seed_price(serializer.save(owner=self.request.user))

    def perform_update(self, serializer):
        seed_price(serializer.save())

    @extend_schema(request=None, responses={200: GiftIdeaSerializer})
    @action(detail=True, methods=["post", "delete"], url_path="watch")
    def watch(self, request, pk=None):
        idea = self.get_object()
        _toggle_watch(request, idea=idea)
        return Response(self.get_serializer(self.get_object()).data)


def _toggle_watch(request, **target) -> None:
    """Mette (POST) o toglie (DELETE) la campanella dell'utente su un regalo o un'idea."""
    if request.method == "POST":
        PriceWatch.objects.get_or_create(user=request.user, **target)
    else:
        PriceWatch.objects.filter(user=request.user, **target).delete()


class WatchesView(APIView):
    """I regali e le idee con la campanella dell'utente, l'ultima messa in cima.

    Si saltano quelli eliminati (anche con la lista): la campanella resta nel
    database ma non c'e' piu' niente da guardare.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: WatchSerializer(many=True)})
    def get(self, request):
        rows = (
            PriceWatch.objects.filter(user=request.user)
            .filter(
                Q(wish__deleted_at=None, wish__wish_list__deleted_at=None, idea=None)
                | Q(idea__deleted_at=None, wish=None)
            )
            .select_related(
                "wish__image", "wish__wish_list__owner", "idea__image"
            )
            .prefetch_related("wish__price_points", "idea__price_points")
            .order_by("-created_at")
        )
        return Response(WatchSerializer(rows, many=True, context={"request": request}).data)


class WatchDetailView(APIView):
    """Togliere una campanella dalla schermata "Campanelle"."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk):
        get_object_or_404(PriceWatch, pk=pk, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationsView(APIView):
    """Gli avvisi dell'utente: gli ultimi 50 e quanti non letti; POST li segna letti."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={
            200: inline_serializer(
                "NotificationList",
                {
                    "unread": serializers.IntegerField(),
                    "items": NotificationSerializer(many=True),
                },
            )
        }
    )
    def get(self, request):
        rows = Notification.objects.filter(user=request.user)
        return Response(
            {
                "unread": rows.filter(read_at=None).count(),
                "items": NotificationSerializer(rows[:50], many=True).data,
            }
        )

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        Notification.objects.filter(user=request.user, read_at=None).update(
            read_at=timezone.now()
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ foto --


def _store_image(request, content, source_url: str = "") -> GiftImage:
    image = GiftImage(owner=request.user, source_url=source_url[:1000])
    image.file.save(content.name, content, save=False)
    image.save()
    return image


def _save_image(request, content, source_url: str = "") -> Response:
    image = _store_image(request, content, source_url)
    return Response(GiftImageSerializer(image).data, status=status.HTTP_201_CREATED)


class ImageUploadView(APIView):
    """Foto dal telefono o dal computer. Torna l'id da mettere in ``image_id``."""

    parser_classes = [MultiPartParser, FormParser]
    throttle_scope = "images"

    @extend_schema(request={"multipart/form-data": ImageUploadSerializer},
                   responses={201: GiftImageSerializer})
    def post(self, request):
        serializer = ImageUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]
        if upload.size > settings.IMAGE_MAX_BYTES:
            raise ValidationError({"file": [_("L'immagine e' troppo grande (massimo 10 MB).")]})
        try:
            content = process_image(upload.read())
        except ImageError as exc:
            raise ValidationError({"file": [str(exc)]}) from None
        return _save_image(request, content)


class ImageFromUrlView(APIView):
    """Foto presa da un link: un'immagine diretta o la pagina del negozio."""

    throttle_scope = "images"

    @extend_schema(request=ImageFromUrlSerializer, responses={201: GiftImageSerializer})
    def post(self, request):
        serializer = ImageFromUrlSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            content, source = image_from_url(serializer.validated_data["url"])
        except ImageError as exc:
            raise ValidationError({"url": [str(exc)]}) from None
        return _save_image(request, content, source)


class LinkReadView(APIView):
    """Tutto quello che si legge dal link di un regalo, per compilare il form.

    Nome e prezzo che la pagina dichiara (ADR 0006) e, se ``image`` e' vero,
    la foto gia' caricata come quelle di ``images/from-url``. Una foto che non
    si trova non e' un errore se il resto c'e': torna in ``image_error``.
    Gemini non si aspetta qui: se si puo' usare torna ``describe_id``, da
    passare a ``links/describe`` per nome e note migliori.
    """

    throttle_scope = "images"

    @extend_schema(request=LinkReadSerializer, responses={200: LinkDetailsSerializer})
    def post(self, request):
        serializer = LinkReadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            page = read_page(serializer.validated_data["url"], details=True)
        except ImageError as exc:
            raise ValidationError({"url": [str(exc)]}) from None
        details = declared_details(page)
        image = image_error = None
        if serializer.validated_data["image"]:
            try:
                image = _store_image(request, *image_of(page))
            except ImageError as exc:
                image_error = str(exc)
        if image is None and not details.title and details.price is None:
            raise ValidationError(
                {"url": [image_error or _("In quella pagina non trovo il prodotto.")]}
            )
        data = {
            "title": details.title,
            "price": details.price,
            "notes": details.notes,
            "gtin": details.gtin,
            "brand": details.brand,
            "image": image,
            "image_error": image_error,
            "describe_id": remember_page(page, request.user.pk) if can_describe(page) else None,
        }
        return Response(LinkDetailsSerializer(data).data)


class LinkDescribeView(APIView):
    """Nome, prezzo e note scritti da Gemini per una pagina letta da ``links/read``.

    Separata perche' Gemini a volte ci mette decine di secondi: il form intanto
    e' gia' compilato coi dati della pagina, e questi arrivano dopo. Se Gemini
    non risponde tornano gli stessi dati dichiarati.
    """

    throttle_scope = "links"

    @extend_schema(request=LinkDescribeSerializer, responses={200: LinkDescriptionSerializer})
    def post(self, request):
        serializer = LinkDescribeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        page = recall_page(serializer.validated_data["describe_id"], request.user.pk)
        if page is None:
            raise NotFound()
        details = details_of(page, (get_language() or "it")[:2])
        data = {
            "title": details.title,
            "price": details.price,
            "notes": details.notes,
            "gtin": details.gtin,
            "brand": details.brand,
        }
        return Response(LinkDescriptionSerializer(data).data)


# ------------------------------------------------------- lista condivisa --


def _shared_list(token: str) -> WishList:
    return get_object_or_404(WishList.objects.select_related("owner"), share_token=token)


def _is_owner(request, wish_list: WishList) -> bool:
    """Chi scrive la lista (proprietario o membro): non spunta e non vede le spunte."""
    return wish_list.is_member(request.user)


def _shared_context(request, wish_list: WishList) -> dict:
    is_owner = _is_owner(request, wish_list)
    return {
        "is_owner": is_owner,
        "hide_gifted": is_owner and not wish_list.show_gifted,
        "viewer_id": request.user.pk if request.user.is_authenticated else None,
        # Per le sezioni (liste incluse): ognuna ha i suoi "proprietari".
        "context_of": lambda child: _shared_context(request, child),
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


class SharedSuggestView(APIView):
    """Alternative a un regalo gia' preso, per chi ha il link (anche senza account).

    A Gemini vanno i titoli dei regali della lista (pubblici per chi ha il
    link) e quello da sostituire: niente nomi, niente dati di chi guarda.
    """

    permission_classes = [AllowAny]
    throttle_scope = "suggest"

    @extend_schema(
        request=SharedSuggestSerializer, responses={200: SuggestionSerializer(many=True)}
    )
    def post(self, request, token: str):
        serializer = SharedSuggestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        wish_list = _shared_list(token)
        lists = [wish_list, *wish_list.included_lists.all()]
        wish = get_object_or_404(
            Wish.objects.filter(wish_list__in=lists), pk=serializer.validated_data["item_id"]
        )
        titles = list(Wish.objects.filter(wish_list__in=lists).values_list("title", flat=True))
        data = {"occasion": wish_list.title, "exclude": serializer.validated_data["exclude"]}
        return _suggest(data, known_gifts=titles[:40], alternative_to=wish.title)


class SharedSaveView(APIView):
    """Salva (POST) o toglie (DELETE) la lista tra le "Liste salvate" di chi guarda (ADR 0014)."""

    permission_classes = [IsAuthenticated]
    throttle_scope = "shared"

    @extend_schema(
        request=None,
        responses={200: inline_serializer("SavedState", {"saved": serializers.BooleanField()})},
    )
    def post(self, request, token: str):
        wish_list = _shared_list(token)
        if wish_list.is_member(request.user):
            raise ValidationError(
                _("È una lista che scrivi tu: la trovi già in «Le mie liste».")
            )
        SavedList.objects.update_or_create(
            user=request.user,
            wish_list=wish_list,
            defaults={"share_token": token, "title": wish_list.title},
        )
        return Response({"saved": True})

    @extend_schema(
        request=None,
        responses={200: inline_serializer("SavedStateOff", {"saved": serializers.BooleanField()})},
    )
    def delete(self, request, token: str):
        wish_list = _shared_list(token)
        SavedList.objects.filter(user=request.user, wish_list=wish_list).delete()
        return Response({"saved": False})


class SavedListsView(APIView):
    """Le liste degli altri salvate dall'utente, l'ultima salvata in cima."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: SavedListSerializer(many=True)})
    def get(self, request):
        rows = SavedList.objects.filter(user=request.user).select_related("wish_list__owner")
        return Response(SavedListSerializer(rows, many=True).data)


class SavedListDetailView(APIView):
    """Togliere una lista salvata, anche quando il suo link non vale piu'."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def delete(self, request, pk):
        get_object_or_404(SavedList, pk=pk, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class SharedWatchView(APIView):
    """La campanella di chi ha il link: serve un account, l'avviso va a qualcuno."""

    permission_classes = [IsAuthenticated]
    throttle_scope = "shared"

    def _wish(self, token: str, item_id) -> tuple[WishList, Wish]:
        wish_list = _shared_list(token)
        mine = Q(wish_list=wish_list) | Q(wish_list__in=wish_list.included_lists.all())
        wish = get_object_or_404(Wish.objects.select_related("wish_list").filter(mine), pk=item_id)
        return wish.wish_list, wish

    def _respond(self, request, wish_list: WishList, wish: Wish) -> Response:
        fresh = (
            Wish.objects.select_related("image", "requires")
            .prefetch_related("price_points", "watches")
            .get(pk=wish.pk)
        )
        context = _shared_context(request, wish_list)
        return Response(SharedWishSerializer(fresh, context=context).data)

    @extend_schema(request=None, responses={200: SharedWishSerializer})
    def post(self, request, token: str, item_id):
        wish_list, wish = self._wish(token, item_id)
        _toggle_watch(request, wish=wish)
        return self._respond(request, wish_list, wish)

    @extend_schema(request=None, responses={200: SharedWishSerializer})
    def delete(self, request, token: str, item_id):
        wish_list, wish = self._wish(token, item_id)
        _toggle_watch(request, wish=wish)
        return self._respond(request, wish_list, wish)


ClaimResponse = inline_serializer(
    "GiftClaimResponse",
    {"claim_key": serializers.CharField(), "item": SharedWishSerializer()},
)


class SharedGiftView(APIView):
    """Spunta "regalato" (POST) e la toglie (DELETE) dalla lista condivisa."""

    permission_classes = [AllowAny]
    throttle_scope = "shared"

    def _wish(self, token: str, item_id) -> tuple[WishList, Wish]:
        """Il regalo: della lista del link o di una che quella include (ADR 0008).

        Torna la lista *del regalo*, non quella del link: e' lei che dice chi
        la scrive (e quindi non spunta) e se nasconde le spunte.
        """
        wish_list = _shared_list(token)
        mine = Q(wish_list=wish_list) | Q(wish_list__in=wish_list.included_lists.all())
        # select_for_update: due persone che spuntano insieme non vincono entrambe.
        wish = get_object_or_404(
            Wish.objects.select_for_update(of=("self",))
            .select_related("wish_list", "requires")
            .filter(mine),
            pk=item_id,
        )
        return wish.wish_list, wish

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
        if wish.is_blocked:
            return Response(
                {
                    "detail": _("Va con «%(title)s»: prima serve che qualcuno regali quello.")
                    % {"title": wish.required_gift.title}
                },
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

