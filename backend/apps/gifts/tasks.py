from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

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
