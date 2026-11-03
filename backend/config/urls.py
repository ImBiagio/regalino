from django.contrib import admin
from django.http import HttpResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.i18n import CatalogView, LanguageView


def health(request):
    """Per l'healthcheck del container: risponde senza DB, auth ne' redirect."""
    return HttpResponse("ok", content_type="text/plain")


urlpatterns = [
    path("api/health", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/i18n/catalog", CatalogView.as_view(), name="i18n-catalog"),
    path("api/i18n/language", LanguageView.as_view(), name="i18n-language"),
    path("api/", include("apps.users.urls")),
    path("api/", include("apps.gifts.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/docs/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
]
