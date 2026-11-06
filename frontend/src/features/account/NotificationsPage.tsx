import { useEffect } from 'react'
import { Link } from 'react-router-dom'

import { useMarkNotificationsRead, useNotifications } from '../../api/hooks'
import { Page, PageHeader } from '../../components/Layout'
import { EmptyState, ErrorBanner, Icon, RowsSkeleton } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { gettext } from '../../lib/i18n'

/** Gli avvisi (il prezzo e' sceso): aprirli li segna letti. */
export function NotificationsPage() {
  const { data, isLoading, error } = useNotifications(true)
  const markRead = useMarkNotificationsRead()
  const unread = data?.unread ?? 0

  useEffect(() => {
    if (unread > 0 && !markRead.isPending) markRead.mutate()
    // Solo quando arrivano avvisi non letti: non a ogni render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread])

  return (
    <Page>
      <PageHeader
        title={gettext('Avvisi')}
        subtitle={gettext(
          'Quando scende il prezzo di un regalo con la campanella. Scegli come riceverli in Account.',
        )}
      />
      <div className="grid gap-4 px-5 md:px-8">
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
          <div className="grid gap-1">
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
      </div>
    </Page>
  )
}
