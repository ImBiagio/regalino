import { Navigate, useNavigate, useParams } from 'react-router-dom'

import { useAcceptInvite, useInvite } from '../../api/hooks'
import { GiftWrap } from '../../components/gift'
import { Page } from '../../components/Layout'
import { EmptyState, ErrorBanner, Icon, Skeleton } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { formatDate } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'

/**
 * `/unisciti/<token>`: l'invito a scrivere una lista insieme. Si apre da
 * loggati (RequireAuth rimanda qui dopo il login); un tocco e la lista
 * compare tra le proprie.
 */
export function JoinListPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { data: invite, isLoading, error } = useInvite(token)
  const accept = useAcceptInvite(token)

  if (invite?.already_member) return <Navigate to={`/liste/${invite.id}`} replace />

  return (
    <Page className="grid gap-4 px-5 pt-5 md:px-8 md:pt-8">
      {isLoading && <Skeleton className="h-64 rounded-panel" />}
      {error instanceof ApiError && error.status === 404 ? (
        <EmptyState
          icon="link_off"
          title={gettext('Invito non valido')}
          description={gettext(
            'Il link non è giusto oppure è stato spento: chiedi a chi te l’ha mandato quello nuovo.',
          )}
        />
      ) : (
        <ErrorBanner error={error} />
      )}
      {invite && (
        <section className="card-elevated mx-auto w-full max-w-lg overflow-hidden">
          <GiftWrap seed={invite.id} ribbon={14} x={70} y={60} className="h-28" />
          <div className="grid gap-4 p-6">
            <div>
              <p className="flex items-center gap-2 text-body-medium text-on-surface-variant">
                <Icon name="group" size={20} />
                {interpolate(gettext('%s ti invita a scrivere la sua lista'), [invite.owner_name])}
              </p>
              <h1 className="mt-1 break-words text-title-large">{invite.title}</h1>
              {invite.event_date && (
                <p className="text-body-medium text-on-surface-variant">
                  {formatDate(invite.event_date)}
                </p>
              )}
            </div>
            <p className="text-body-medium text-on-surface-variant">
              {gettext(
                'Se entri, la lista compare tra le tue: aggiungi e modifichi i regali come chi l’ha creata, e come loro non vedi chi li ha presi.',
              )}
              {invite.member_count > 0 && (
                <>
                  {' '}
                  {interpolate(
                    ngettext(
                      'La scrive già con %s altra persona.',
                      'La scrivono già in %s.',
                      invite.member_count,
                    ),
                    [invite.member_count === 1 ? 1 : invite.member_count + 1],
                  )}
                </>
              )}
            </p>
            <ErrorBanner error={accept.error} />
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-text" onClick={() => navigate('/')}>
                {gettext('No, grazie')}
              </button>
              <button
                type="button"
                className="btn-filled"
                disabled={accept.isPending}
                onClick={async () => {
                  const list = await accept.mutateAsync().catch(() => null)
                  if (list) navigate(`/liste/${list.id}`, { replace: true })
                }}
              >
                <Icon name="group_add" size={20} />
                {accept.isPending ? gettext('Entro…') : gettext('Entra nella lista')}
              </button>
            </div>
          </div>
        </section>
      )}
    </Page>
  )
}
