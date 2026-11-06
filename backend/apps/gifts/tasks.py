from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from . import prices
from .models import GiftIdea, GiftImage, Wish


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
