import clsx from 'clsx'
import { Link } from 'react-router-dom'

import { useRemoveSavedList, useSavedLists } from '../../api/hooks'
import { GiftWrap, countdownLabel } from '../../components/gift'
import { ErrorBanner, Icon, IconButton } from '../../components/ui'
import { daysUntil, formatDate } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { SavedList } from '../../lib/types'

/** Prima le feste piu' vicine, poi senza data, poi passate; quelle spente in fondo. */
function bySavedEvent(a: SavedList, b: SavedList): number {
  const rank = (list: SavedList) => {
    if (!list.available) return [3, 0]
    if (!list.event_date) return [1, 0]
    const days = daysUntil(list.event_date)
    return days >= 0 ? [0, days] : [2, -days]
  }
  const [groupA, daysA] = rank(a)
  const [groupB, daysB] = rank(b)
  return groupA - groupB || daysA - daysB
}

/**
 * "Liste salvate" (ADR 0014): le liste degli altri salvate dal loro link, per
 * ritrovarle senza cercare il messaggio. Senza liste salvate non si mostra.
 */
export function SavedListsSection() {
  const { data, error } = useSavedLists()
  const remove = useRemoveSavedList()
  if (!data?.length && !error) return null
  const sorted = [...(data ?? [])].sort(bySavedEvent)

  return (
    <section className="grid gap-3 pt-4">
      <div className="flex items-center gap-2 px-1">
        <Icon name="bookmark" size={22} filled className="text-tertiary" />
        <h2 className="text-title-medium">{gettext('Liste salvate')}</h2>
      </div>
      <p className="-mt-2 px-1 text-body-medium text-on-surface-variant">
        {gettext('Le liste degli altri che hai salvato dal loro link.')}
      </p>
      <ErrorBanner error={error ?? remove.error} />
      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sorted.map((list) => (
          <SavedListCard
            key={list.id}
            list={list}
            removing={remove.isPending}
            onRemove={() => remove.mutate(list.id)}
          />
        ))}
      </div>
    </section>
  )
}

function SavedListCard({
  list,
  removing,
  onRemove,
}: {
  list: SavedList
  removing: boolean
  onRemove: () => void
}) {
  const past = list.event_date !== null && daysUntil(list.event_date) < 0
  const body = (
    <>
      <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-nested">
        <GiftWrap
          seed={list.id}
          ribbon={8}
          className={clsx('h-full w-full', (past || !list.available) && 'opacity-50 grayscale')}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-large font-medium">{list.title}</span>
        {list.available ? (
          <>
            <span className="block truncate text-body-small text-on-surface-variant">
              {list.event_date
                ? interpolate(gettext('Di %s · %s'), [list.owner_name, formatDate(list.event_date)])
                : interpolate(gettext('Di %s'), [list.owner_name])}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small">
              {list.event_date && !past && (
                <span className="inline-flex items-center gap-1 text-on-surface-variant">
                  <Icon name="schedule" size={16} />
                  {countdownLabel(list.event_date)}
                </span>
              )}
              <span
                className={clsx(
                  'inline-flex items-center gap-1 font-medium',
                  list.free_count > 0 ? 'text-on-surface' : 'text-success',
                )}
              >
                <Icon name={list.free_count > 0 ? 'redeem' : 'check_circle'} size={16} />
                {list.item_count === 0
                  ? gettext('Ancora vuota')
                  : list.free_count > 0
                    ? interpolate(ngettext('%s da prendere', '%s da prendere', list.free_count), [
                        list.free_count,
                      ])
                    : gettext('Tutto preso')}
              </span>
            </span>
          </>
        ) : (
          <span className="mt-0.5 flex items-center gap-1 text-body-small text-on-surface-variant">
            <Icon name="link_off" size={16} />
            {gettext('Il link non vale più: chiedine uno nuovo')}
          </span>
        )}
      </span>
    </>
  )

  return (
    <div
      className={clsx('card-elevated flex items-center gap-1 pr-2', list.available && 'card-lift')}
    >
      {list.available && list.share_token ? (
        <Link
          to={`/l/${list.share_token}`}
          className="state flex min-w-0 flex-1 items-center gap-3 rounded-card p-3"
        >
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3 p-3 opacity-80">{body}</div>
      )}
      <IconButton
        icon="bookmark_remove"
        label={gettext('Togli dalle liste salvate')}
        onClick={onRemove}
        disabled={removing}
      />
    </div>
  )
}
