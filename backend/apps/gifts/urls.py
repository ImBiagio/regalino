from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import GiftIdeaViewSet, SharedGiftView, SharedListView, WishListViewSet, WishViewSet

router = SimpleRouter(trailing_slash=False)
router.register("lists", WishListViewSet, basename="wish-list")
router.register("ideas", GiftIdeaViewSet, basename="gift-idea")

wish_list = WishViewSet.as_view({"get": "list", "post": "create"})
wish_detail = WishViewSet.as_view(
    {"get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"}
)
wish_gift = WishViewSet.as_view({"delete": "clear_gift"})

urlpatterns = [
    path("lists/<uuid:list_pk>/items", wish_list, name="wish-list-items"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>", wish_detail, name="wish-detail"),
    path("lists/<uuid:list_pk>/items/<uuid:pk>/gift", wish_gift, name="wish-gift"),
    path("shared/<str:token>", SharedListView.as_view(), name="shared-list"),
    path(
        "shared/<str:token>/items/<uuid:item_id>/gift",
        SharedGiftView.as_view(),
        name="shared-gift",
    ),
    *router.urls,
]
