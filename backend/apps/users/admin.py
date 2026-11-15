from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "display_name", "is_active", "cornhub_sub", "is_staff"]
    # Il legame con l'account di cornhub (ADR 0020) si guarda, non si scrive.
    readonly_fields = ["cornhub_sub"]
    search_fields = ["email", "display_name"]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profilo", {"fields": ("display_name", "avatar", "email_verified_at", "cornhub_sub")}),
        ("Permessi", {"fields": ("is_active", "is_staff", "is_superuser", "groups",
                                 "user_permissions")}),
        ("Date", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )
