from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "display_name",
            "avatar",
            "email_verified_at",
            "language",
            "notify_by",
        ]
        # Nome ed email si cambiano su cornhub (account unico della suite):
        # qui restano le impostazioni dell'app (avvisi, lingua).
        read_only_fields = ["id", "email", "display_name", "email_verified_at"]


class UserBriefSerializer(serializers.ModelSerializer):
    """Usato ovunque si mostri di chi e' una lista o chi ha fatto un regalo."""

    class Meta:
        model = User
        fields = ["id", "email", "display_name", "avatar"]
        read_only_fields = fields


class TokenPairSerializer(serializers.Serializer):
    """Solo l'access token esce nel body: il refresh vive in un cookie httpOnly."""

    access = serializers.CharField(read_only=True)
    user = UserSerializer(read_only=True)
