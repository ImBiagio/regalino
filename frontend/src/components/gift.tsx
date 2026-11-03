// Pezzi condivisi da lista del proprietario, lista condivisa e "Da regalare":
// prezzo, link al negozio, data dell'evento.

import { daysUntil, formatDate, formatPrice, hostOf } from '../lib/format'
import { gettext, interpolate, ngettext } from '../lib/i18n'
import type { Money } from '../lib/types'
import { Icon } from './ui'

/** "12 dicembre 2026 · tra 39 giorni": la data dice quanto manca. */
export function eventLabel(isoDate: string): string {
  const days = daysUntil(isoDate)
  const date = formatDate(isoDate)
  if (days === 0) return interpolate(gettext('%s · oggi'), [date])
  if (days === 1) return interpolate(gettext('%s · domani'), [date])
  if (days < 0) return interpolate(gettext('%s · passato'), [date])
  return interpolate(ngettext('%s · tra %s giorno', '%s · tra %s giorni', days), [date, days])
}

/** Prezzo e link del regalo, sotto il titolo di una riga. */
export function GiftMeta({ price, url }: { price: Money | null; url: string }) {
  if (!price && !url) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small">
      {price && (
        <span className="amount text-body-medium font-medium text-on-surface">
          {formatPrice(price)}
        </span>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="open_in_new" size={16} />
          <span className="truncate">{hostOf(url)}</span>
        </a>
      )}
    </div>
  )
}
