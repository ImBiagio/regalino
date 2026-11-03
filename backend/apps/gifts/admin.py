from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import GiftIdea, Wish, WishList


class WishInline(admin.TabularInline):
    model = Wish
    extra = 0
    fields = ["title", "price", "url", "gifted_at", "gifted_by_name"]
    readonly_fields = ["gifted_at", "gifted_by_name"]


@admin.register(WishList)
class WishListAdmin(SimpleHistoryAdmin):
    list_display = ["title", "owner", "event_date", "show_gifted", "created_at"]
    search_fields = ["title", "owner__email"]
    readonly_fields = ["share_token"]
    inlines = [WishInline]


@admin.register(GiftIdea)
class GiftIdeaAdmin(SimpleHistoryAdmin):
    list_display = ["title", "recipient", "owner", "status", "price"]
    list_filter = ["status"]
    search_fields = ["title", "recipient", "owner__email"]
