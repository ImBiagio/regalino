from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import (
    GiftIdeaViewSet,
    ImageFromUrlView,
    ImageUploadView,
    InviteView,
    LinkDescribeView,
    LinkReadView,
    NotificationsView,
    SharedGiftView,
    SharedListView,
    SharedSuggestView,
    SharedWatchView,
    SuggestView,
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
    path("links/read", LinkReadView.as_view(), name="link-read"),
    path("links/describe", LinkDescribeView.as_view(), name="link-describe"),
    path("lists/<uuid:list_pk>/items", wish_list, name="wish-list-items"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>", wish_detail, name="wish-detail"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>/gift", wish_gift, name="wish-gift"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>/watch", wish_watch, name="wish-watch"),
    path("notifications", NotificationsView.as_view(), name="notifications"),
    path("invites/<str:token>", InviteView.as_view(), name="invite"),
    # Prima del router: ``ideas/<pk>`` prenderebbe anche "suggest".
    path("ideas/suggest", SuggestView.as_view(), name="idea-suggest"),
    path("shared/<str:token>/suggest", SharedSuggestView.as_view(), name="shared-suggest"),
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
