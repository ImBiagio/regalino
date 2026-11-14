"""Settings condivisi. Tutto cio' che cambia tra ambienti sta in dev.py / prod.py."""

from __future__ import annotations

import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parents[2]


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def env_bool(key: str, default: bool = False) -> bool:
    return env(key, "1" if default else "0").lower() in {"1", "true", "yes", "on"}


def env_list(key: str, default: str = "") -> list[str]:
    raw = env(key, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


SECRET_KEY = env("DJANGO_SECRET_KEY", "insecure-dev-key")
DEBUG = False
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5176")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    # third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    "simple_history",
    "django_celery_beat",
    # local
    "apps.core",
    "apps.users",
    "apps.gifts",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "simple_history.middleware.HistoryRequestMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "regalino"),
        "USER": env("POSTGRES_USER", "regalino"),
        "PASSWORD": env("POSTGRES_PASSWORD", "regalino"),
        "HOST": env("POSTGRES_HOST", "db"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "ATOMIC_REQUESTS": True,
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "users.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Lingue (ADR 0016): l'italiano e' la lingua sorgente dei msgid, l'inglese sta
# in locale/en. LocaleMiddleware sceglie dal cookie `django_language` (scritto
# da /api/i18n/language) e poi da Accept-Language.
LANGUAGE_CODE = "it"
LANGUAGES = [("it", "Italiano"), ("en", "English")]
LOCALE_PATHS = [BASE_DIR / "locale"]
LANGUAGE_COOKIE_AGE = 60 * 60 * 24 * 365
LANGUAGE_COOKIE_SAMESITE = "Lax"
TIME_ZONE = "Europe/Rome"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# --- DRF ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.DefaultPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "apps.core.exceptions.exception_handler",
    # Solo le view con ``throttle_scope`` sono limitate: login, registrazione e
    # le pagine pubbliche delle liste condivise (chiunque abbia il link). I
    # contatori stanno nella cache Django, cioe' Redis.
    "DEFAULT_THROTTLE_CLASSES": ("rest_framework.throttling.ScopedRateThrottle",),
    "DEFAULT_THROTTLE_RATES": {
        "auth": env("THROTTLE_AUTH", "10/min"),
        "refresh": env("THROTTLE_REFRESH", "60/min"),
        "shared": env("THROTTLE_SHARED", "120/min"),
        # Upload e link scaricati dal server: costano disco e banda.
        "images": env("THROTTLE_IMAGES", "60/hour"),
        # Richieste a Gemini (ADR 0006): costano quota della chiave.
        "links": env("THROTTLE_LINKS", "60/hour"),
        # "Ispirami" e le alternative: ogni chiamata consuma la quota di Gemini.
        "suggest": env("THROTTLE_SUGGEST", "30/hour"),
        # Import di liste (ADR 0015): browser dello scraper e Gemini su pagine intere.
        "imports": env("THROTTLE_IMPORTS", "20/hour"),
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Regalino API",
    "DESCRIPTION": "Liste dei regali condivisibili e idee da regalare",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "SCHEMA_PATH_PREFIX": "/api",
}

ACCESS_TOKEN_LIFETIME = int(env("ACCESS_TOKEN_LIFETIME", "900"))
REFRESH_TOKEN_LIFETIME = int(env("REFRESH_TOKEN_LIFETIME", "1209600"))

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(seconds=ACCESS_TOKEN_LIFETIME),
    "REFRESH_TOKEN_LIFETIME": timedelta(seconds=REFRESH_TOKEN_LIFETIME),
    "ROTATE_REFRESH_TOKENS": True,
    # La blacklist serve a logout e cambio password, non alla rotazione: con
    # due schede aperte che rinnovano insieme, blacklistare il token ruotato
    # butterebbe fuori una delle due.
    "BLACKLIST_AFTER_ROTATION": False,
    "UPDATE_LAST_LOGIN": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# Il refresh token vive in un cookie httpOnly; l'access token sta in memoria nel frontend.
# I cookie non distinguono le porte: due stack sullo stesso host (soldino e
# regalino in locale, o un worktree) devono usare nomi diversi, altrimenti il
# login su uno sovrascrive il cookie dell'altro.
REFRESH_COOKIE_NAME = env("REFRESH_COOKIE_NAME", "regalino_refresh")
REFRESH_COOKIE_SECURE = env_bool("REFRESH_COOKIE_SECURE", True)
REFRESH_COOKIE_SAMESITE = env("REFRESH_COOKIE_SAMESITE", "Lax")
REFRESH_COOKIE_PATH = "/api/auth"

REQUIRE_EMAIL_VERIFICATION = env_bool("REQUIRE_EMAIL_VERIFICATION", True)
# Codice d'invito (ADR 0018). Vuoto: registrazione aperta a tutti. Impostato:
# ci si registra solo scrivendolo nel form.
SIGNUP_CODE = env("SIGNUP_CODE", "").strip()

# --- Celery ---
CELERY_BROKER_URL = env("CELERY_BROKER_URL", "redis://redis:6379/1")
# Nessuno legge il valore di ritorno dei task: lo stato sta nel DB. Senza
# result backend Redis non accumula risultati mai letti.
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_ALWAYS_EAGER = False

# Sincronizzato nel DB da django-celery-beat all'avvio dello scheduler.
CELERY_BEAT_SCHEDULE = {
    "flush-expired-tokens": {
        "task": "apps.users.tasks.flush_expired_tokens",
        "schedule": crontab(hour=4, minute=0),
    },
    # Foto caricate e mai collegate a un regalo, o sostituite (ADR 0003).
    "delete-orphan-images": {
        "task": "apps.gifts.tasks.delete_orphan_images",
        "schedule": crontab(hour=4, minute=30),
    },
    # Prezzi riletti dai link, avvisi a chi ha la campanella (ADR 0011).
    "check-prices": {
        "task": "apps.gifts.tasks.check_prices",
        "schedule": crontab(hour=2, minute=30),
    },
}

# Quante pagine rileggere a notte e quanti secondi tra una e l'altra.
PRICE_CHECKS_PER_NIGHT = int(env("PRICE_CHECKS_PER_NIGHT", "80"))
PRICE_CHECK_GAP = int(env("PRICE_CHECK_GAP", "30"))

# Con Redis un task con ``countdown`` resta "non confermato" nel worker fino
# all'ora di partire, e dopo ``visibility_timeout`` (un'ora se non si dice
# niente) Redis lo riconsegna: i controlli del prezzo messi in fila oltre
# l'ora partivano due volte. Il tempo copre tutta la fila della notte, con
# un'ora di margine; mai meno dell'ora di serie.
CELERY_BROKER_TRANSPORT_OPTIONS = {
    "visibility_timeout": max(3600, PRICE_CHECKS_PER_NIGHT * PRICE_CHECK_GAP + 3600),
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("REDIS_URL", "redis://redis:6379/0"),
    }
}

# --- Email ---
# In sviluppo le mail vanno nella console del worker. In produzione SMTP di
# Brevo, lo stesso account di cinemino e soldino (dominio inoo.it autenticato).
EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "localhost")
EMAIL_PORT = int(env("EMAIL_PORT", "587"))
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_TIMEOUT = 15
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Regalino <no-reply@regalino.local>")
# --- Foto dei regali (ADR 0003) ---
IMAGE_MAX_BYTES = int(env("IMAGE_MAX_BYTES", str(10 * 1024 * 1024)))
# Lato lungo dopo la riduzione: basta per un ingrandimento su telefono.
IMAGE_MAX_SIDE = int(env("IMAGE_MAX_SIDE", "1280"))
IMAGE_FETCH_TIMEOUT = float(env("IMAGE_FETCH_TIMEOUT", "10"))
# Lo scraper col browser headless (ADR 0005): si usa quando la lettura diretta
# del link non basta. Vuoto = spento (test, sviluppo senza il container).
SCRAPER_URL = env("SCRAPER_URL", "")
SCRAPER_TIMEOUT = float(env("SCRAPER_TIMEOUT", "40"))
# Nome, prezzo e note dal testo della pagina (ADR 0006). Senza chiave si usano
# solo i dati che la pagina dichiara.
GEMINI_API_KEY = env("GEMINI_API_KEY", "")
# flash-lite: provato su Amazon e IKEA risponde in 1-2 s e scrive note migliori;
# i flash piu' grandi davano spesso 503 (troppa richiesta) o 6-20 s.
GEMINI_MODEL = env("GEMINI_MODEL", "gemini-3.5-flash-lite")
# Gemini va in una richiesta a parte (il form e' gia' compilato): si puo'
# aspettare di piu'. Col piano gratuito a tratti ci mette 20 secondi.
GEMINI_TIMEOUT = float(env("GEMINI_TIMEOUT", "30"))
# Dopo quanto una foto mai collegata a un regalo si cancella.
IMAGE_ORPHAN_HOURS = int(env("IMAGE_ORPHAN_HOURS", "24"))
FILE_UPLOAD_MAX_MEMORY_SIZE = IMAGE_MAX_BYTES
DATA_UPLOAD_MAX_MEMORY_SIZE = IMAGE_MAX_BYTES + 1024 * 1024

# Il link di reset vale 2 ore (il default di Django sono 3 giorni).
PASSWORD_RESET_TIMEOUT = int(env("PASSWORD_RESET_TIMEOUT", str(2 * 60 * 60)))
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", "http://localhost:5176")

CORS_ALLOW_CREDENTIALS = True
CORS_ALLOWED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5176")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "{levelname} {name} {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
