from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.ai_views import AiQuoteView, AiWalletView
from apps.core.i18n import CatalogView, LanguageView


def health(request):
    """Per l'healthcheck del container: risponde senza DB, auth ne' redirect."""
    return HttpResponse("ok", content_type="text/plain")


urlpatterns = [
    path("api/health", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/i18n/catalog", CatalogView.as_view(), name="i18n-catalog"),
    path("api/i18n/language", LanguageView.as_view(), name="i18n-language"),
    # Chi paga e quanto costa una funzione AI, prima di premere il bottone (ADR 0020).
    path("api/ai/quote", AiQuoteView.as_view(), name="ai-quote"),
    # Le pannocchie rimaste oggi, per il contatore nella barra dell'app.
    path("api/ai/wallet", AiWalletView.as_view(), name="ai-wallet"),
    path("api/", include("apps.users.urls")),
    path("api/", include("apps.gifts.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]

# In sviluppo le foto le serve Django; in produzione il Caddy di ``web`` legge
# lo stesso volume (deploy/Caddyfile).
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
