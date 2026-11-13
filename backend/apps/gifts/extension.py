"""L'estensione Chrome: aggiungere un regalo dalla pagina del negozio (ADR 0016).

L'estensione non usa il login dell'app (cookie di refresh e JWT di 15 minuti,
pensati per il browser sull'app): ha una chiave sua, ``ExtensionToken``, che
l'utente crea dalla pagina ``/estensione`` dell'app con un tocco. La chiave
vale solo per gli endpoint di questo modulo: leggere una pagina, vedere le
proprie liste, aggiungere un regalo, importare una lista. Non cambia password,
non elimina liste, non vede le idee.

La pagina arriva gia' costruita dal browser di chi la guarda (``html``): e'
quella vera, anche sui siti che al server rispondono con un captcha
(Zalando) o che sono fatti in JavaScript. Il server la legge con gli stessi
parser del link (ADR 0006) e scarica la foto con le sue difese SSRF.
"""

from __future__ import annotations

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import authentication, exceptions, serializers, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.methods import hash_secret, random_token

from .images import ImageError
from .links import (
    MAX_URL,
    can_describe,
    declared_details,
    image_of,
    page_from_html,
    read_page,
    remember_page,
)
from .models import ExtensionToken, WishList, seed_price
from .serializers import LinkDetailsSerializer, WishSerializer
from .views import (
    ImportCreateView,
    ImportJobView,
    ImportReadView,
    LinkDescribeView,
    _store_image,
)

# La pagina che manda l'estensione: abbastanza per Amazon, non un upload qualsiasi.
MAX_PAGE_HTML = 3 * 1024 * 1024
# Ogni quanto aggiornare "usata l'ultima volta": non a ogni richiesta.
TOUCH_EVERY = 60 * 60


class ExtensionTokenAuthentication(authentication.BaseAuthentication):
    """``Authorization: Token <chiave>``: solo sulle viste dell'estensione."""

    keyword = "Token"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("latin-1").split()
        if not header or header[0] != self.keyword:
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed(_("Chiave dell'estensione non valida."))
        token = (
            ExtensionToken.objects.select_related("user")
            .filter(key_hash=hash_secret(header[1]))
            .first()
        )
        if token is None or not token.user.is_active:
            raise exceptions.AuthenticationFailed(
                _("L'estensione e' stata scollegata: collegala di nuovo.")
            )
        now = timezone.now()
        if token.last_used_at is None or (now - token.last_used_at).total_seconds() > TOUCH_EVERY:
            ExtensionToken.objects.filter(pk=token.pk).update(last_used_at=now)
        return token.user, token

    def authenticate_header(self, request):
        # Senza, DRF risponde 403 invece di 401 e l'estensione non capisce che va ricollegata.
        return self.keyword


class ExtensionView(APIView):
    authentication_classes = [ExtensionTokenAuthentication]


# ------------------------------------------------- chiavi (dall'app web) --


class ExtensionTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExtensionToken
        fields = ["id", "name", "created_at", "last_used_at"]
        read_only_fields = fields


class ExtensionTokensView(APIView):
    """Le estensioni collegate (Account) e il collegamento di una nuova.

    Si chiama dall'app, col login normale: la chiave intera torna una volta
    sola, e la pagina ``/estensione`` la passa all'estensione.
    """

    throttle_scope = "auth"

    @extend_schema(responses={200: ExtensionTokenSerializer(many=True)})
    def get(self, request):
        rows = ExtensionToken.objects.filter(user=request.user)
        return Response(ExtensionTokenSerializer(rows, many=True).data)

    @extend_schema(
        request=inline_serializer("ExtensionTokenCreate", {"name": serializers.CharField()}),
        responses={201: None},
    )
    def post(self, request):
        key = random_token(32)
        token = ExtensionToken.objects.create(
            user=request.user,
            name=str(request.data.get("name") or "")[:80],
            key_hash=hash_secret(key),
        )
        data = ExtensionTokenSerializer(token).data
        return Response({**data, "key": key}, status=status.HTTP_201_CREATED)


class ExtensionTokenDetailView(APIView):
    def delete(self, request, pk):
        get_object_or_404(ExtensionToken, pk=pk, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------- viste dell'estensione --


class ExtensionMeView(ExtensionView):
    """Chi e' collegato: il nome nella testata dell'estensione."""

    @extend_schema(responses={200: None})
    def get(self, request):
        user = request.user
        return Response({"name": user.display_name, "email": user.email})


class ExtensionListsView(ExtensionView):
    """Le liste in cui si puo' aggiungere: sue o scritte insieme (ADR 0007)."""

    @extend_schema(responses={200: None})
    def get(self, request):
        rows = (
            WishList.for_user(request.user)
            .annotate(item_count=Count("items", filter=Q(items__deleted_at__isnull=True)))
            .order_by("-updated_at")
        )
        return Response(
            [
                {
                    "id": row.pk,
                    "title": row.title,
                    "event_date": row.event_date,
                    "item_count": row.item_count,
                }
                for row in rows
            ]
        )


class ExtensionReadSerializer(serializers.Serializer):
    url = serializers.URLField(max_length=MAX_URL)
    html = serializers.CharField(
        required=False, allow_blank=True, trim_whitespace=False, max_length=MAX_PAGE_HTML
    )


class ExtensionReadView(ExtensionView):
    """Nome, prezzo e foto dalla pagina aperta nel browser, come ``links/read``.

    Se la pagina mandata non dice niente (o non c'e'), il server la rilegge
    dal link come fa l'app.
    """

    throttle_scope = "images"

    @extend_schema(request=ExtensionReadSerializer, responses={200: LinkDetailsSerializer})
    def post(self, request):
        serializer = ExtensionReadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        url, html = serializer.validated_data["url"], serializer.validated_data.get("html")
        page = page_from_html(html, url) if html else None
        if page is None or not (page.title or page.price):
            try:
                page = read_page(url, details=True)
            except ImageError as exc:
                if page is None:
                    raise ValidationError({"url": [str(exc)]}) from None
        details = declared_details(page)
        image = image_error = None
        try:
            image = _store_image(request, *image_of(page))
        except ImageError as exc:
            image_error = str(exc)
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


class ExtensionDescribeView(ExtensionView, LinkDescribeView):
    """Nome e note migliori con Gemini, come ``links/describe``."""

    authentication_classes = [ExtensionTokenAuthentication]


class ExtensionItemView(ExtensionView):
    """Aggiunge il regalo a una lista: gli stessi campi e controlli del form dell'app."""

    @extend_schema(request=WishSerializer, responses={201: WishSerializer})
    def post(self, request, list_pk):
        wish_list = get_object_or_404(WishList.for_user(request.user), pk=list_pk)
        data = {key: value for key, value in request.data.items() if key != "requires_id"}
        serializer = WishSerializer(data=data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        wish = serializer.save(wish_list=wish_list)
        seed_price(wish)
        data = WishSerializer(wish, context={"request": request}).data
        return Response({**data, "list_title": wish_list.title}, status=status.HTTP_201_CREATED)


class ExtensionImportReadView(ExtensionView, ImportReadView):
    authentication_classes = [ExtensionTokenAuthentication]


class ExtensionImportJobView(ExtensionView, ImportJobView):
    authentication_classes = [ExtensionTokenAuthentication]


class ExtensionImportCreateView(ExtensionView, ImportCreateView):
    authentication_classes = [ExtensionTokenAuthentication]
