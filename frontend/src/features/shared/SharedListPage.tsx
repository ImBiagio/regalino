import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { readClaims, useClaimGift, useReleaseGift, useSharedList } from '../../api/hooks'
import {
  GiftBadge,
  GiftCard,
  GiftMeta,
  GiftThumb,
  ImageViewer,
  ListHero,
} from '../../components/gift'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import {
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  Icon,
  Modal,
  Progress,
  Skeleton,
} from '../../components/ui'
import { GIFT_GRID } from '../lists/ListDetailPage'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
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
    <div className="min-h-screen bg-surface">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 pt-4 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-2 text-title-medium">
          <img src="/logo-mark.svg" alt="" width={32} height={32} className="h-8 w-8" />
          Regalino
        </Link>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
        {(!ready || isLoading) && (
          <>
            <Skeleton className="h-52 rounded-panel" />
            <div className={GIFT_GRID}>
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="aspect-[3/4] rounded-card" />
              ))}
            </div>
          </>
        )}
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
        <footer className="mt-6 flex flex-col items-center gap-3 border-t border-outline-variant pt-6 text-center text-body-small text-on-surface-variant">
          <Link to="/" className="btn-tonal btn-sm">
            <Icon name="featured_seasonal_and_gifts" size={18} />
            {gettext('Fai anche tu la tua lista con Regalino')}
          </Link>
          <LanguageSwitcher />
        </footer>
      </div>
    </div>
  )
}

type View = 'free' | 'all'

function SharedList({ token, list }: { token: string; list: SharedWishList }) {
  const [claiming, setClaiming] = useState<SharedWish | null>(null)
  const [viewing, setViewing] = useState<SharedWish | null>(null)
  const claim = useClaimGift(token)
  const release = useReleaseGift(token)
  const claims = readClaims()
  const isMine = (item: SharedWish) =>
    item.gifted === true && (item.mine || Boolean(claims[item.id]))
  const free = list.items.filter((item) => item.gifted === false).length
  const taken = list.items.filter((item) => item.gifted === true).length
  // Di default si vede cosa resta da prendere (piu' i propri, per poterli
  // annullare); se e' tutto preso, si vede tutto.
  const [view, setView] = useState<View>(free > 0 ? 'free' : 'all')
  // Prima quelli ancora liberi: sono quelli che servono a chi regala.
  const items = [...list.items]
    .filter((item) => view === 'all' || !item.gifted || isMine(item))
    .sort((a, b) => Number(Boolean(a.gifted)) - Number(Boolean(b.gifted)))

  return (
    <>
      <ListHero
        eyebrow={interpolate(gettext('La lista di %s'), [list.owner_name])}
        title={list.title}
        eventDate={list.event_date}
        description={list.description}
      />

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
          <div className="grid gap-3 rounded-card bg-surface-container-low p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-success-container text-on-success-container">
                <Icon name={free > 0 ? 'redeem' : 'celebration'} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body-large font-medium">
                  {free > 0
                    ? interpolate(
                        ngettext(
                          'Ancora %s regalo da prendere',
                          'Ancora %s regali da prendere',
                          free,
                        ),
                        [free],
                      )
                    : gettext('Tutti i regali sono già presi. Grazie!')}
                </p>
                {free > 0 && (
                  <p className="text-body-small text-on-surface-variant">
                    {gettext(
                      'Scegli un regalo e tocca «Lo regalo io»: gli altri lo vedranno preso e non faranno doppioni.',
                    )}
                  </p>
                )}
              </div>
            </div>
            <Progress value={taken} max={list.items.length} label={gettext('Regali già presi')} />
          </div>
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
        <section className="grid gap-3">
          {!list.is_owner && taken > 0 && (
            <div className="flex flex-wrap gap-2">
              <Chip
                icon={view === 'free' ? 'check' : undefined}
                selected={view === 'free'}
                onClick={() => setView('free')}
                label={interpolate(gettext('Da prendere · %s'), [free])}
              />
              <Chip
                icon={view === 'all' ? 'check' : undefined}
                selected={view === 'all'}
                onClick={() => setView('all')}
                label={interpolate(gettext('Tutti · %s'), [list.items.length])}
              />
            </div>
          )}
          <div className={GIFT_GRID}>
            {items.map((item) => {
              const mine = isMine(item)
              return (
                <GiftCard
                  key={item.id}
                  seed={item.id}
                  image={item.image}
                  title={item.title}
                  price={item.price}
                  url={item.url}
                  notes={item.notes}
                  taken={Boolean(item.gifted) && !mine}
                  onImage={item.image ? () => setViewing(item) : undefined}
                  badge={
                    item.gifted && (
                      <GiftBadge icon={mine ? 'favorite' : 'check_circle'}>
                        {mine
                          ? gettext('Lo regali tu')
                          : item.gifted_by_name
                            ? interpolate(gettext('Lo regala %s'), [item.gifted_by_name])
                            : gettext('Già preso')}
                      </GiftBadge>
                    )
                  }
                  footer={
                    !list.is_owner &&
                    (!item.gifted ? (
                      <button
                        type="button"
                        className="btn-primary-tonal btn-sm w-full"
                        onClick={() => setClaiming(item)}
                      >
                        <Icon name="redeem" size={18} />
                        {gettext('Lo regalo io')}
                      </button>
                    ) : (
                      mine && (
                        <button
                          type="button"
                          className="btn-outlined btn-sm w-full"
                          disabled={release.isPending}
                          onClick={() => release.mutate(item.id)}
                        >
                          <Icon name="undo" size={18} />
                          {gettext('Annulla')}
                        </button>
                      )
                    ))
                  }
                />
              )
            })}
          </div>
        </section>
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
        <div className="flex items-center gap-3 rounded-row bg-surface-container-low p-3">
          <GiftThumb image={item.image} seed={item.id} size={64} />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-body-large font-medium">{item.title}</p>
            <GiftMeta price={item.price} url={item.url} />
          </div>
        </div>
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
