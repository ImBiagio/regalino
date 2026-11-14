from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model, password_validation
from django.utils import translation
from django.utils.crypto import constant_time_compare
from django.utils.translation import gettext as _
from rest_framework import serializers

from apps.core.methods import normalize_email

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
        read_only_fields = ["id", "email", "email_verified_at"]


class UserBriefSerializer(serializers.ModelSerializer):
    """Usato ovunque si mostri di chi e' una lista o chi ha fatto un regalo."""

    class Meta:
        model = User
        fields = ["id", "email", "display_name", "avatar"]
        read_only_fields = fields


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    display_name = serializers.CharField(required=False, allow_blank=True)
    # Codice d'invito (ADR 0018): conta solo se SIGNUP_CODE e' impostato.
    invite_code = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default=""
    )

    def to_internal_value(self, data):
        # Prima di ogni altro campo: chi non ha il codice non deve poter
        # scoprire, dall'errore sull'email, chi e' gia' registrato.
        if settings.SIGNUP_CODE:
            given = data.get("invite_code") if hasattr(data, "get") else None
            given = given.strip() if isinstance(given, str) else ""
            # Confronto a tempo costante: il tempo di risposta non rivela
            # quanti caratteri del codice sono giusti.
            if not constant_time_compare(given, settings.SIGNUP_CODE):
                raise serializers.ValidationError(
                    {"invite_code": [_("Codice d'invito non valido.")]}
                )
        return super().to_internal_value(data)

    def validate_email(self, value: str) -> str:
        value = normalize_email(value)
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError(_("Esiste gia' un account con questa email."))
        return value

    def validate_password(self, value: str) -> str:
        password_validation.validate_password(value)
        return value

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data["email"],
            password=validated_data["password"],
            display_name=validated_data.get("display_name", ""),
            # La lingua in cui si sta registrando: anche la mail di conferma.
            language=translation.get_language() or settings.LANGUAGE_CODE,
        )


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value: str) -> str:
        password_validation.validate_password(value, self.context["request"].user)
        return value


class TokenPairSerializer(serializers.Serializer):
    """Solo l'access token esce nel body: il refresh vive in un cookie httpOnly."""

    access = serializers.CharField(read_only=True)
    user = UserSerializer(read_only=True)


class EmailSerializer(serializers.Serializer):
    """Reinvio della conferma e richiesta di reset: basta l'indirizzo."""

    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)
