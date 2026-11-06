"""Andamento dei prezzi e avvisi "e' sceso" (ADR 0011).

Il task notturno rilegge il prezzo dal link dei regali e delle idee che hanno
un link e non sono ancora presi, con un tetto di pagine per notte e le
chiamate spalmate su qualche ora: il browser dello scraper costa. Quando il
prezzo scende, chi ha messo la campanella riceve un avviso nell'app, una mail
o entrambi, come ha scelto nel profilo (``User.notify_by``).
"""

from __future__ import annotations

import logging
from decimal import Decimal

from django.conf import settings
from django.db.models import F
from django.utils import timezone, translation
from django.utils.translation import gettext as _

from apps.core.methods import send_email

from .images import ImageError
from .links import declared_details, read_page
from .models import GiftIdea, Notification, Wish, record_price

logger = logging.getLogger(__name__)


def targets_due(limit: int) -> list[tuple[str, str]]:
    """Cosa rileggere stanotte: prima chi non e' mai stato letto o da piu' tempo."""
    today = timezone.localdate()
    wishes = (
        Wish.objects.exclude(url="")
        .filter(gifted_at=None, wish_list__deleted_at=None)
        .exclude(wish_list__event_date__lt=today)
        .order_by(F("price_checked_at").asc(nulls_first=True))
    )
    ideas = (
        GiftIdea.objects.exclude(url="")
        .filter(status=GiftIdea.Status.IDEA)
        .order_by(F("price_checked_at").asc(nulls_first=True))
    )
    half = max(1, limit // 2)
    chosen = [("wish", str(pk)) for pk in wishes.values_list("pk", flat=True)[:half]]
    rest = limit - len(chosen)
    chosen += [("idea", str(pk)) for pk in ideas.values_list("pk", flat=True)[:rest]]
    return chosen


def load(kind: str, pk: str) -> Wish | GiftIdea | None:
    model = Wish if kind == "wish" else GiftIdea
    return model.objects.filter(pk=pk).first()


def check_price(target: Wish | GiftIdea) -> Decimal | None:
    """Rilegge il prezzo dal link; se e' sceso avvisa chi ha la campanella."""
    target.price_checked_at = timezone.now()
    target.save(update_fields=["price_checked_at"])
    try:
        page = read_page(target.url, details=True)
    except ImageError as exc:
        logger.info("Prezzo non letto da %s: %s", target.url, exc)
        return None
    price = declared_details(page).price
    if price is None:
        return None
    last = target.price_points.order_by("-seen_at").first()
    previous = last.price if last is not None else target.price
    if record_price(target, price) is not None and previous is not None and price < previous:
        notify_drop(target, previous, price)
    return price


def _path_for(target: Wish | GiftIdea, user) -> str:
    if isinstance(target, GiftIdea):
        return "/da-regalare"
    wish_list = target.wish_list
    return f"/liste/{wish_list.pk}" if wish_list.is_member(user) else f"/l/{wish_list.share_token}"


def _euro(value: Decimal) -> str:
    return f"{value:.2f}".replace(".", ",") + " €"


def notify_drop(target: Wish | GiftIdea, previous: Decimal, price: Decimal) -> None:
    """Un avviso per ogni campanella: nell'app, per mail o entrambi."""
    drop = round((previous - price) / previous * 100) if previous else 0
    for watch in target.watches.select_related("user"):
        user = watch.user
        with translation.override(user.language):
            title = _("È sceso: %(title)s") % {"title": target.title}
            body = _("Da %(before)s a %(after)s (-%(drop)s%%)") % {
                "before": _euro(previous),
                "after": _euro(price),
                "drop": drop,
            }
            path = _path_for(target, user)
            if user.notify_by in ("app", "both"):
                Notification.objects.create(user=user, title=title, body=body, url=path)
            if user.notify_by in ("email", "both"):
                send_email(
                    user.email,
                    title,
                    name=user.display_name,
                    intro=_("Avevi messo la campanella su «%(title)s».") % {"title": target.title},
                    body=body,
                    cta_label=_("Apri"),
                    cta_url=f"{settings.FRONTEND_BASE_URL}{path}",
                    note=_("Prezzo letto dal link del negozio: puo' cambiare ancora."),
                )
