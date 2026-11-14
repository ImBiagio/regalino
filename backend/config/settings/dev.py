from ..sentry import init_sentry
from .base import *  # noqa: F403
from .base import env_bool

DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
REFRESH_COOKIE_SECURE = False

# Solo se nel .env c'e' SENTRY_DSN (di solito no, in sviluppo).
init_sentry()
