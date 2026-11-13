from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from . import imports, prices
from .images import ImageError
from .links import image_from_url
from .models import GiftIdea, GiftImage, Wish

logger = logging.getLogger(__name__)


@shared_task
def delete_orphan_images() -> int:
    """Cancella (riga e file) le foto che nessun regalo usa piu'.

    Contano anche i regali eliminati logicamente: finche' la riga esiste, un
    ripristino dall'admin deve ritrovare la sua foto. Quelle appena caricate
    restano ``IMAGE_ORPHAN_HOURS`` ore, il tempo di finire il form.
    """
    cutoff = timezone.now() - timedelta(hours=settings.IMAGE_ORPHAN_HOURS)
    used = set(Wish.all_objects.exclude(image=None).values_list("image_id", flat=True))
    used |= set(GiftIdea.all_objects.exclude(image=None).values_list("image_id", flat=True))
    deleted = 0
    for image in GiftImage.objects.filter(created_at__lt=cutoff).exclude(pk__in=used):
        image.file.delete(save=False)
        image.delete()
        deleted += 1
    return deleted


@shared_task
def check_prices() -> int:
    """Di notte: rilegge i prezzi dai link, pochi per volta e spalmati (ADR 0011).

    Un tetto a notte (``PRICE_CHECKS_PER_NIGHT``) e un intervallo tra una
    pagina e l'altra: lo scraper sul server ci mette anche 20 secondi, e i
    negozi non vanno martellati.
    """
    due = prices.targets_due(settings.PRICE_CHECKS_PER_NIGHT)
    for index, (kind, pk) in enumerate(due):
        check_price_of.apply_async(args=[kind, pk], countdown=index * settings.PRICE_CHECK_GAP)
    return len(due)


@shared_task
def check_price_of(kind: str, pk: str) -> str | None:
    target = prices.load(kind, pk)
    if target is None:
        return None
    price = prices.check_price(target)
    return str(price) if price is not None else None


# --------------------------------------------------------------- import --

# Quanto resta la lettura di un import in attesa che il browser la chieda.
IMPORT_TTL = 30 * 60
# Tra una foto e l'altra dei regali importati: i negozi non vanno martellati.
IMPORT_IMAGE_GAP = 4


def import_key(job_id: str) -> str:
    return f"import:{job_id}"


@shared_task
def read_import(job_id: str, user_id: str, url: str, html: str | None = None) -> str:
    """Legge la lista dal link (ADR 0015): browser, Gemini, liste collegate.

    Puo' durare piu' di un minuto, quindi non nella richiesta: il risultato
    (anteprima o errore) va in cache e il browser lo chiede finche' c'e'.
    """
    state = {"owner": user_id, "status": "done"}
    try:
        state["lists"] = imports.as_data(imports.read_url(url, html))
    except imports.ImportFailed as exc:
        state = {"owner": user_id, "status": "error", "error": str(exc)}
    except Exception:
        logger.exception("Import non riuscito da %s", url)
        state = {"owner": user_id, "status": "error", "error": ""}
    cache.set(import_key(job_id), state, IMPORT_TTL)
    return state["status"]


@shared_task
def attach_import_image(wish_id: str, url: str) -> bool:
    """La foto di un regalo importato: dal link della foto o dalla pagina del prodotto."""
    wish = Wish.objects.select_related("wish_list").filter(pk=wish_id, image=None).first()
    if wish is None:
        return False
    try:
        content, source = image_from_url(url)
    except ImageError as exc:
        logger.info("Foto non presa per il regalo importato %s: %s", wish_id, exc)
        return False
    image = GiftImage(owner_id=wish.wish_list.owner_id, source_url=source[:1000])
    image.file.save(content.name, content, save=False)
    image.save()
    wish.image = image
    wish.save(update_fields=["image", "updated_at"])
    return True


def schedule_import_images(jobs: list[tuple[str, str]]) -> None:
    for index, (wish_id, url) in enumerate(jobs):
        attach_import_image.apply_async(args=[wish_id, url], countdown=index * IMPORT_IMAGE_GAP)
