from django.urls import path
from rest_framework.routers import SimpleRouter

from .extension import (
    ExtensionDescribeView,
    ExtensionImportCreateView,
    ExtensionImportJobView,
    ExtensionImportReadView,
    ExtensionItemView,
    ExtensionListsView,
    ExtensionMeView,
    ExtensionReadView,
    ExtensionTokenDetailView,
    ExtensionTokensView,
)
from .views import (
    GiftIdeaViewSet,
    ImageFromUrlView,
    ImageUploadView,
    ImportCreateView,
    ImportJobView,
    ImportReadView,
    InviteView,
    LinkDescribeView,
    LinkReadView,
    NotificationsView,
    SavedListDetailView,
    SavedListsView,
    SharedGiftView,
    SharedListView,
    SharedSaveView,
    SharedSuggestView,
    SharedWatchView,
    SuggestView,
    WatchDetailView,
    WatchesView,
    WishListViewSet,
    WishViewSet,
)

router = SimpleRouter(trailing_slash=False)
router.register("lists", WishListViewSet, basename="wish-list")
router.register("ideas", GiftIdeaViewSet, basename="gift-idea")

wish_list = WishViewSet.as_view({"get": "list", "post": "create"})
wish_detail = WishViewSet.as_view(
    {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
)
wish_gift = WishViewSet.as_view({"delete": "clear_gift"})
wish_watch = WishViewSet.as_view({"post": "watch", "delete": "watch"})

urlpatterns = [
    path("images", ImageUploadView.as_view(), name="image-upload"),
    path("images/from-url", ImageFromUrlView.as_view(), name="image-from-url"),
    # L'estensione Chrome (ADR 0016): le chiavi si creano dall'app, il resto
    # lo chiama l'estensione con la sua chiave.
    path("extension/tokens", ExtensionTokensView.as_view(), name="extension-tokens"),
    path(
        "extension/tokens/<uuid:pk>", ExtensionTokenDetailView.as_view(), name="extension-token"
    ),
    path("extension/me", ExtensionMeView.as_view(), name="extension-me"),
    path("extension/lists", ExtensionListsView.as_view(), name="extension-lists"),
    path(
        "extension/lists/<uuid:list_pk>/items",
        ExtensionItemView.as_view(),
        name="extension-items",
    ),
    path("extension/read", ExtensionReadView.as_view(), name="extension-read"),
    path("extension/describe", ExtensionDescribeView.as_view(), name="extension-describe"),
    path("extension/imports", ExtensionImportCreateView.as_view(), name="extension-import"),
    path(
        "extension/imports/read",
        ExtensionImportReadView.as_view(),
        name="extension-import-read",
    ),
    path(
        "extension/imports/read/<str:job_id>",
        ExtensionImportJobView.as_view(),
        name="extension-import-job",
    ),
    path("imports", ImportCreateView.as_view(), name="import-create"),
    path("imports/read", ImportReadView.as_view(), name="import-read"),
    path("imports/read/<str:job_id>", ImportJobView.as_view(), name="import-job"),
    path("links/read", LinkReadView.as_view(), name="link-read"),
    path("links/describe", LinkDescribeView.as_view(), name="link-describe"),
    path("lists/<uuid:list_pk>/items", wish_list, name="wish-list-items"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>", wish_detail, name="wish-detail"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>/gift", wish_gift, name="wish-gift"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>/watch", wish_watch, name="wish-watch"),
    path("notifications", NotificationsView.as_view(), name="notifications"),
    path("watches", WatchesView.as_view(), name="watches"),
    path("watches/<uuid:pk>", WatchDetailView.as_view(), name="watch"),
    path("invites/<str:token>", InviteView.as_view(), name="invite"),
    # Prima del router: ``ideas/<pk>`` prenderebbe anche "suggest".
    path("ideas/suggest", SuggestView.as_view(), name="idea-suggest"),
    path("saved-lists", SavedListsView.as_view(), name="saved-lists"),
    path("saved-lists/<uuid:pk>", SavedListDetailView.as_view(), name="saved-list"),
    path("shared/<str:token>/suggest", SharedSuggestView.as_view(), name="shared-suggest"),
    path("shared/<str:token>/save", SharedSaveView.as_view(), name="shared-save"),
    path("shared/<str:token>", SharedListView.as_view(), name="shared-list"),
    path(
        "shared/<str:token>/items/<uuid:item_id>/gift",
        SharedGiftView.as_view(),
        name="shared-gift",
    ),
    path(
        "shared/<str:token>/items/<uuid:item_id>/watch",
        SharedWatchView.as_view(),
        name="shared-watch",
    ),
    *router.urls,
]
