import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  useMarkNotificationsRead,
  useNotifications,
  useRemoveWatch,
  useWatches,
} from '../../api/hooks'
import { GiftThumb, PriceTrend, WatchBell } from '../../components/gift'
import { Page, PageHeader } from '../../components/Layout'
import { EmptyState, ErrorBanner, Icon, RowsSkeleton, Segmented } from '../../components/ui'
import { formatDateTime, formatPrice } from '../../lib/format'
import { gettext, interpolate } from '../../lib/i18n'
import type { WatchedItem } from '../../lib/types'

type View = 'watches' | 'alerts'

/**
 * Due viste: "Campanelle" (i regali e le idee che seguo) e "Avvisi" (il prezzo
 * e' sceso). Si apre sugli avvisi se ce n'e' qualcuno da leggere; la vista
 * scelta sta nell'URL (`?vista=avvisi`), cosi' il tasto indietro la ricorda.
 */
export function NotificationsPage() {
  const { data } = useNotifications(true)
  const [params, setParams] = useSearchParams()
  const asked = params.get('vista')
  const unread = data?.unread ?? 0
  const view: View = asked === 'avvisi' ? 'alerts' : 'watches'

  // Senza scelta nell'URL si decide una volta, appena si sa se ci sono avvisi
  // nuovi; poi resta: leggerli azzera il contatore e non deve cambiare vista.
  useEffect(() => {
    if (asked || !data) return
    setParams({ vista: data.unread > 0 ? 'avvisi' : 'campanelle' }, { replace: true })
  }, [asked, data, setParams])

  return (
    <Page>
      <PageHeader
        title={gettext('Avvisi')}
        subtitle={gettext(
          'I regali con la campanella e gli avvisi quando il prezzo scende. Scegli come riceverli in Account.',
        )}
      />
      <div className="grid gap-4 px-5 md:px-8">
        <Segmented<View>
          className="w-fit"
          value={view}
          onChange={(next) =>
            setParams({ vista: next === 'alerts' ? 'avvisi' : 'campanelle' }, { replace: true })
          }
          options={[
            { value: 'watches', label: gettext('Campanelle') },
            {
              value: 'alerts',
              label: unread > 0 ? interpolate(gettext('Avvisi · %s'), [unread]) : gettext('Avvisi'),
            },
          ]}
        />
        {view === 'watches' ? <WatchesList /> : <AlertsList />}
      </div>
    </Page>
  )
}

/* -------------------------------------------------------- campanelle -- */

function WatchesList() {
  const { data, isLoading, error } = useWatches()
  const remove = useRemoveWatch()

  return (
    <>
      <ErrorBanner error={error ?? remove.error} />
      {isLoading && <RowsSkeleton rows={3} />}
      {data && data.length === 0 && (
        <EmptyState
          icon="notifications_active"
          title={gettext('Nessuna campanella, per ora')}
          description={gettext(
            'Tocca la campanella su un regalo con il link al negozio (nelle tue liste, in Da regalare o sul link di un altro): lo ritrovi qui, con il prezzo di oggi.',
          )}
        />
      )}
      {data && data.length > 0 && (
        <div className="stagger grid gap-1">
          {data.map((item) => (
            <WatchedRow
              key={item.id}
              item={item}
              removing={remove.isPending && remove.variables === item.id}
              onRemove={() => remove.mutate(item.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function WatchedRow({
  item,
  removing,
  onRemove,
}: {
  item: WatchedItem
  removing: boolean
  onRemove: () => void
}) {
  const doneLabel =
    item.gifted === true
      ? item.kind === 'idea'
        ? gettext('Già comprato')
        : gettext('Già preso')
      : null
  return (
    <div
      className={
        removing
          ? 'row-m3 items-start opacity-50 transition-opacity'
          : 'row-m3 items-start transition-opacity'
      }
    >
      <Link to={item.path} className="shrink-0" aria-label={item.title}>
        <GiftThumb image={item.image} seed={item.item_id} done={item.gifted === true} size={64} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={item.path}
          className="line-clamp-2 text-body-large font-medium underline-offset-2 hover:underline"
        >
          {item.title}
        </Link>
        <p className="flex items-center gap-1 text-body-small text-on-surface-variant">
          <Icon name={item.kind === 'idea' ? 'person' : 'featured_seasonal_and_gifts'} size={16} />
          <span className="truncate">{item.where}</span>
        </p>
        {doneLabel && (
          <p className="mt-1 inline-flex items-center gap-1 rounded-pill bg-success-container px-2 py-0.5 text-label-small text-on-success-container">
            <Icon name="check_circle" size={14} filled />
            {doneLabel}
          </p>
        )}
        <PriceTrend history={item.price_history} title={item.title} tracked={Boolean(item.url)} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.price && (
          <span className="amount pt-0.5 text-body-large font-medium">
            {formatPrice(item.price)}
          </span>
        )}
        <WatchBell watching pending={removing} onToggle={onRemove} className="-mr-2" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ avvisi -- */

/** Gli avvisi (il prezzo e' sceso): aprirli li segna letti. */
function AlertsList() {
  const { data, isLoading, error } = useNotifications(true)
  const markRead = useMarkNotificationsRead()
  const unread = data?.unread ?? 0

  useEffect(() => {
    if (unread > 0 && !markRead.isPending) markRead.mutate()
    // Solo quando arrivano avvisi non letti: non a ogni render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread])

  return (
    <>
      <ErrorBanner error={error} />
      {isLoading && <RowsSkeleton rows={3} />}
      {data && data.items.length === 0 && (
        <EmptyState
          icon="notifications"
          title={gettext('Nessun avviso, per ora')}
          description={gettext(
            'Metti la campanella su un regalo con il link al negozio: quando il prezzo scende te lo diciamo qui.',
          )}
        />
      )}
      {data && data.items.length > 0 && (
        <div className="stagger grid gap-1">
          {data.items.map((note) => (
            <Link key={note.id} to={note.url || '/'} className="row-m3 items-start">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-success-container text-on-success-container">
                <Icon name="trending_down" size={22} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body-large font-medium">{note.title}</span>
                {note.body && (
                  <span className="block text-body-medium text-on-surface-variant">
                    {note.body}
                  </span>
                )}
                <span className="block text-body-small text-on-surface-variant">
                  {formatDateTime(note.created_at)}
                </span>
              </span>
              {!note.read_at && (
                <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-pill bg-primary" />
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
