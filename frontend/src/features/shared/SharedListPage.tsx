import clsx from 'clsx'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { readClaims, useClaimGift, useReleaseGift, useSharedList } from '../../api/hooks'
import { GiftMeta, GiftThumb, ImageViewer, eventLabel } from '../../components/gift'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { EmptyState, ErrorBanner, Field, Icon, Modal, RowsSkeleton } from '../../components/ui'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { gettext, interpolate } from '../../lib/i18n'
import type { SharedWish, SharedWishList } from '../../lib/types'

const NAME_KEY = 'regalino.name'

function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Senza storage si richiede il nome la prossima volta: nient'altro.
  }
}

/** La lista vista da chi ha il link: niente account, si spunta e basta. */
export function SharedListPage() {
  const { token = '' } = useParams()
  const { user, ready } = useAuth()
  const { data, isLoading, error } = useSharedList(token, user?.id ?? null, ready)

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4 sm:p-6">
      {(!ready || isLoading) && <RowsSkeleton rows={4} />}
      {error instanceof ApiError && error.status === 404 ? (
        <EmptyState
          icon="link_off"
          title={gettext('Lista non trovata')}
          description={gettext(
            'Il link non è giusto oppure non vale più: chiedi a chi te l’ha mandato quello nuovo.',
          )}
        />
      ) : (
        <ErrorBanner error={error} />
      )}
      {data && <SharedList token={token} list={data} />}
      <footer className="mt-auto flex flex-col items-center gap-3 pt-6 text-center text-body-small text-on-surface-variant">
        <Link to="/" className="inline-flex items-center gap-2 font-medium text-primary">
          <img src="/logo-mark.svg" alt="" width={20} height={20} />
          {gettext('Fai anche tu la tua lista con Regalino')}
        </Link>
        <LanguageSwitcher />
      </footer>
    </div>
  )
}

function SharedList({ token, list }: { token: string; list: SharedWishList }) {
  const [claiming, setClaiming] = useState<SharedWish | null>(null)
  const [viewing, setViewing] = useState<SharedWish | null>(null)
  const claim = useClaimGift(token)
  const release = useReleaseGift(token)
  const claims = readClaims()
  // Prima quelli ancora liberi: sono quelli che servono a chi regala.
  const items = [...list.items].sort(
    (a, b) => Number(Boolean(a.gifted)) - Number(Boolean(b.gifted)),
  )
  const free = list.items.filter((item) => item.gifted === false).length

  return (
    <>
      <section className="rounded-panel bg-primary p-6 text-on-primary sm:p-8">
        <p className="flex items-center gap-2 text-body-medium text-primary-container">
          <Icon name="redeem" size={20} />
          {interpolate(gettext('La lista di %s'), [list.owner_name])}
        </p>
        <h1 className="mt-2 break-words text-[32px] font-semibold leading-10 sm:text-headline-medium">
          {list.title}
        </h1>
        {list.event_date && (
          <p className="mt-2 text-body-large text-primary-container">
            {eventLabel(list.event_date)}
          </p>
        )}
        {list.description && (
          <p className="mt-4 whitespace-pre-line text-body-large">{list.description}</p>
        )}
      </section>

      {list.is_owner ? (
        <div className="flex items-start gap-3 rounded-card bg-tertiary-container px-4 py-3 text-body-medium text-on-tertiary-container">
          <Icon name="visibility" size={20} />
          <span>
            {gettext(
              'È la tua lista: così la vede chi ha il link. Tu non puoi spuntare i regali, e se la sorpresa è attiva non vedi le spunte degli altri.',
            )}
          </span>
        </div>
      ) : (
        list.items.length > 0 && (
          <p className="px-1 text-body-medium text-on-surface-variant">
            {free > 0
              ? gettext(
                  'Scegli un regalo e tocca «Lo regalo io»: gli altri lo vedranno preso e non faranno doppioni.',
                )
              : gettext('Tutti i regali sono già presi. Grazie!')}
          </p>
        )
      )}

      <ErrorBanner error={claim.error ?? release.error} />
      {list.items.length === 0 ? (
        <EmptyState
          icon="hourglass_empty"
          title={gettext('Ancora nessun regalo')}
          description={gettext('La lista è vuota: ripassa più tardi.')}
        />
      ) : (
        <div className="grid gap-1">
          {items.map((item) => {
            const mine = item.gifted === true && (item.mine || Boolean(claims[item.id]))
            return (
              <div
                key={item.id}
                className={clsx(
                  'flex items-start gap-4 rounded-row px-5 py-4',
                  item.gifted ? 'bg-surface-container' : 'bg-surface-container-low',
                )}
              >
                <GiftThumb
                  image={item.image}
                  done={Boolean(item.gifted)}
                  size={72}
                  onOpen={item.image ? () => setViewing(item) : undefined}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={clsx(
                      'break-words text-body-large font-medium',
                      item.gifted && 'text-on-surface-variant',
                    )}
                  >
                    {item.title}
                  </p>
                  <GiftMeta price={item.price} url={item.url} />
                  {item.notes && (
                    <p className="mt-1 whitespace-pre-line text-body-small text-on-surface-variant">
                      {item.notes}
                    </p>
                  )}
                  {item.gifted && (
                    <p className="mt-2 text-body-small font-medium text-on-surface-variant">
                      {mine
                        ? gettext('Lo regali tu')
                        : item.gifted_by_name
                          ? interpolate(gettext('Lo regala %s'), [item.gifted_by_name])
                          : gettext('Già preso da qualcuno')}
                    </p>
                  )}
                </div>
                {!list.is_owner && (
                  <div className="shrink-0">
                    {!item.gifted ? (
                      <button
                        type="button"
                        className="btn-filled btn-sm"
                        aria-label={gettext('Lo regalo io')}
                        onClick={() => setClaiming(item)}
                      >
                        <Icon name="check" size={18} />
                        <span className="hidden sm:inline">{gettext('Lo regalo io')}</span>
                        <span className="sm:hidden">{gettext('Lo prendo')}</span>
                      </button>
                    ) : (
                      mine && (
                        <button
                          type="button"
                          className="btn-outlined btn-sm"
                          disabled={release.isPending}
                          onClick={() => release.mutate(item.id)}
                        >
                          <Icon name="undo" size={18} />
                          {gettext('Annulla')}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {viewing?.image && (
        <ImageViewer image={viewing.image} title={viewing.title} onClose={() => setViewing(null)} />
      )}
      {claiming && (
        <ClaimModal
          item={claiming}
          busy={claim.isPending}
          onClose={() => setClaiming(null)}
          onConfirm={async (name) => {
            rememberName(name)
            await claim.mutateAsync({ id: claiming.id, name }).catch(() => undefined)
            setClaiming(null)
          }}
        />
      )}
    </>
  )
}

function ClaimModal({
  item,
  busy,
  onClose,
  onConfirm,
}: {
  item: SharedWish
  busy: boolean
  onClose: () => void
  onConfirm: (name: string) => void
}) {
  const { user } = useAuth()
  const [name, setName] = useState(rememberedName() || user?.display_name || '')

  return (
    <Modal open onClose={onClose} title={gettext('Lo regali tu?')}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm(name.trim())
        }}
      >
        <p className="text-body-medium">
          {interpolate(
            gettext('«%s» risulterà preso: chi apre la lista non lo regalerà due volte.'),
            [item.title],
          )}
        </p>
        <Field
          label={gettext('Il tuo nome (facoltativo)')}
          hint={gettext('Così gli altri sanno chi ci ha pensato.')}
        >
          <input
            className="field-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            autoFocus
          />
        </Field>
        <p className="text-body-small text-on-surface-variant">
          {gettext('Potrai togliere la spunta da questo dispositivo, se cambi idea.')}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-text" onClick={onClose}>
            {gettext('Annulla')}
          </button>
          <button className="btn-filled" disabled={busy}>
            <Icon name="check" size={20} />
            {gettext('Sì, lo regalo io')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
