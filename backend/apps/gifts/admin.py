from django.contrib import admin
from simple_history.admin import SimpleHistoryAdmin

from .models import GiftIdea, SavedList, Wish, WishList, WishListInclusion, WishListMember


class WishInline(admin.TabularInline):
    model = Wish
    extra = 0
    fields = ["title", "price", "quantity", "url", "gifted_at", "gifted_by_name"]
    readonly_fields = ["gifted_at", "gifted_by_name"]


class InclusionInline(admin.TabularInline):
    model = WishListInclusion
    fk_name = "parent"
    extra = 0
    autocomplete_fields = ["child"]


class MemberInline(admin.TabularInline):
    model = WishListMember
    extra = 0
    autocomplete_fields = ["user"]


@admin.register(WishList)
class WishListAdmin(SimpleHistoryAdmin):
    list_display = ["title", "owner", "event_date", "show_gifted", "created_at"]
    search_fields = ["title", "owner__email"]
    readonly_fields = ["share_token", "invite_token"]
    inlines = [MemberInline, InclusionInline, WishInline]


@admin.register(GiftIdea)
class GiftIdeaAdmin(SimpleHistoryAdmin):
    list_display = ["title", "recipient", "owner", "status", "price"]
    list_filter = ["status"]
    search_fields = ["title", "recipient", "owner__email"]


@admin.register(SavedList)
class SavedListAdmin(admin.ModelAdmin):
    list_display = ["title", "user", "wish_list", "created_at"]
    search_fields = ["title", "user__email"]
    raw_id_fields = ["user", "wish_list"]
