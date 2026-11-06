import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import {
  readClaims,
  useClaimGift,
  useReleaseGift,
  useSharedList,
  useSharedSuggest,
  useWatchSharedWish,
} from '../../api/hooks'
import {
  GiftBadge,
  GiftCard,
  GiftMeta,
  GiftThumb,
  ImageViewer,
  ListHero,
  PriceTrend,
  WatchBell,
  WhereToBuy,
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
import { useConfirm } from '../../components/ConfirmDialog'
import { GIFT_GRID } from '../lists/ListDetailPage'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { GiftSuggestion, SharedSection, SharedWish, SharedWishList } from '../../lib/types'
import { SuggestionRow } from '../ideas/InspireWizard'

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
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-5 pt-5 md:px-8">
        <Link to="/" className="inline-flex items-center gap-2 text-title-medium">
          <img src="/logo-mark.svg" alt="" width={32} height={32} className="h-8 w-8" />
          Regalino
        </Link>
      </header>
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-4 md:px-8 md:py-6">
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

/**
 * Le card di chi ha il link. "Lo regalo io" solo sui regali davvero liberi
 * (`gifted === false`): per chi scrive la lista, o una lista inclusa, lo
 * stato arriva `null` e il bottone non c'e'.
 */
function SharedCards({
  items,
  isMine,
  requiredOf,
  onClaim,
  onView,
  onRelease,
  onAlternatives,
  onWatch,
  watching,
  releasing,
}: {
  items: SharedWish[]
  isMine: (item: SharedWish) => boolean
  /** Il regalo con cui va, se c'e' (ADR 0009): finche' non e' preso, l'altro aspetta. */
  requiredOf: (item: SharedWish) => SharedWish | undefined
  onClaim: (item: SharedWish) => void
  onView: (item: SharedWish) => void
  onRelease: (item: SharedWish) => void
  /** Un regalo preso da altri: idee simili da Gemini (ADR 0010). */
  onAlternatives: (item: SharedWish) => void
  /** La campanella (ADR 0011): da sloggati porta al login. */
  onWatch: (item: SharedWish) => void
  watching: boolean
  releasing: boolean
}) {
  return (
    <div className={GIFT_GRID}>
      {items.map((item) => {
        const mine = isMine(item)
        const required = requiredOf(item)
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
            detail={required && interpolate(gettext('Va con «%s»'), [required.title])}
            trend={
              <PriceTrend
                history={item.price_history}
                title={item.title}
                tracked={Boolean(item.url)}
              />
            }
            corner={
              item.url &&
              item.gifted !== true && (
                <WatchBell
                  watching={item.watching}
                  pending={watching}
                  onToggle={() => onWatch(item)}
                />
              )
            }
            onImage={item.image ? () => onView(item) : undefined}
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
              <div className="grid gap-1">
                {item.gifted === false ? (
                  required && required.gifted !== true ? (
                    <button
                      type="button"
                      className="btn-outlined btn-sm w-full"
                      disabled
                      title={interpolate(gettext('Prima serve che qualcuno prenda «%s».'), [
                        required.title,
                      ])}
                    >
                      <Icon name="hourglass_top" size={18} />
                      {interpolate(gettext('Prima «%s»'), [required.title])}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary-tonal btn-sm w-full"
                      onClick={() => onClaim(item)}
                    >
                      <Icon name="redeem" size={18} />
                      {gettext('Lo regalo io')}
                    </button>
                  )
                ) : mine ? (
                  <button
                    type="button"
                    className="btn-outlined btn-sm w-full"
                    disabled={releasing}
                    onClick={() => onRelease(item)}
                  >
                    <Icon name="undo" size={18} />
                    {gettext('Annulla')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-text btn-sm w-full"
                    onClick={() => onAlternatives(item)}
                  >
                    <Icon name="auto_awesome" size={18} />
                    {gettext('Alternative')}
                  </button>
                )}
                <WhereToBuy item={item} className="-ml-2 justify-self-start" />
              </div>
            }
          />
        )
      })}
    </div>
  )
}

/** Una lista inclusa (ADR 0008): titolo e data, poi le sue card. */
function SharedSectionBlock({
  section,
  children,
}: {
  section: SharedSection
  children: ReactNode
}) {
  return (
    <section className="grid gap-3 border-t border-outline-variant pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <Icon name="folder_open" size={22} className="text-on-surface-variant" />
        <h2 className="text-title-medium">{section.title}</h2>
        {section.event_date && (
          <span className="text-body-medium text-on-surface-variant">
            {formatDate(section.event_date)}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

/**
 * "Alternative": un regalo e' gia' preso, Gemini propone idee simili partendo
 * dai regali della lista (pubblici per chi ha il link) e da quello preso.
 */
function AlternativesModal({
  token,
  item,
  onClose,
}: {
  token: string
  item: SharedWish
  onClose: () => void
}) {
  const suggest = useSharedSuggest(token)
  const [shown, setShown] = useState<GiftSuggestion[]>([])
  const ask = async (more: boolean) => {
    const ideas = await suggest
      .mutateAsync({ item_id: item.id, exclude: more ? shown.map((s) => s.title) : [] })
      .catch(() => null)
    if (ideas) setShown(more ? [...shown, ...ideas] : ideas)
  }
  useEffect(() => {
    void ask(false)
    // Solo all'apertura: il regalo non cambia finche' il dialog e' aperto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  return (
    <Modal open onClose={onClose} title={gettext('Alternative')}>
      <div className="grid gap-3">
        <p className="text-body-small text-on-surface-variant">
          {interpolate(
            gettext(
              '«%s» è già preso. Idee simili scritte da un’AI, partendo da questa lista: scegli tu.',
            ),
            [item.title],
          )}
        </p>
        <ErrorBanner error={suggest.error} />
        {shown.map((idea) => (
          <SuggestionRow key={idea.title} idea={idea} />
        ))}
        {suggest.isPending && (
          <div className="grid gap-2">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-[84px]" />
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-tonal"
            disabled={suggest.isPending}
            onClick={() => void ask(true)}
          >
            <Icon name="refresh" size={20} />
            {gettext('Altre idee')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

type View = 'free' | 'all'

function SharedList({ token, list }: { token: string; list: SharedWishList }) {
  const [claiming, setClaiming] = useState<SharedWish | null>(null)
  const [viewing, setViewing] = useState<SharedWish | null>(null)
  const [alternatives, setAlternatives] = useState<SharedWish | null>(null)
  const watch = useWatchSharedWish(token)
  const { user } = useAuth()
  const navigate = useNavigate()
  const confirm = useConfirm()
  // La campanella avvisa qualcuno: senza account non si sa chi. Si propone il login.
  const toggleWatch = async (item: SharedWish) => {
    if (user) {
      watch.mutate({ id: item.id, watch: !item.watching })
      return
    }
    const ok = await confirm({
      title: gettext('Ti avviso se il prezzo scende'),
      message: gettext(
        'Per mandarti l’avviso (nell’app o per email) serve un account: accedi o creane uno, poi torni qui.',
      ),
      confirmLabel: gettext('Accedi'),
      icon: 'notifications',
    })
    if (ok) navigate(`/accedi?next=${encodeURIComponent(window.location.pathname)}`)
  }
  const claim = useClaimGift(token)
  const release = useReleaseGift(token)
  const claims = readClaims()
  const isMine = (item: SharedWish) =>
    item.gifted === true && (item.mine || Boolean(claims[item.id]))
  // Conteggi e filtri su tutto: anche i regali delle liste incluse (ADR 0008).
  const everything = [...list.items, ...list.sections.flatMap((section) => section.items)]
  const free = everything.filter((item) => item.gifted === false).length
  const taken = everything.filter((item) => item.gifted === true).length
  // Di default si vede cosa resta da prendere (piu' i propri, per poterli
  // annullare); se e' tutto preso, si vede tutto.
  const [view, setView] = useState<View>(free > 0 ? 'free' : 'all')
  // Prima quelli ancora liberi: sono quelli che servono a chi regala.
  const visible = (all: SharedWish[]) =>
    [...all]
      .filter((item) => view === 'all' || !item.gifted || isMine(item))
      .sort((a, b) => Number(Boolean(a.gifted)) - Number(Boolean(b.gifted)))
  const requiredOf = (item: SharedWish) =>
    item.requires_id ? everything.find((other) => other.id === item.requires_id) : undefined
  const items = visible(list.items)
  const sections = list.sections
    .map((section) => ({ ...section, items: visible(section.items) }))
    .filter((section) => section.items.length > 0)

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
        everything.length > 0 && (
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
            <Progress value={taken} max={everything.length} label={gettext('Regali già presi')} />
          </div>
        )
      )}

      <ErrorBanner error={claim.error ?? release.error ?? watch.error} />
      {everything.length === 0 ? (
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
                label={interpolate(gettext('Tutti · %s'), [everything.length])}
              />
            </div>
          )}
          <SharedCards
            items={items}
            isMine={isMine}
            requiredOf={requiredOf}
            onClaim={setClaiming}
            onView={setViewing}
            onRelease={(item) => release.mutate(item.id)}
            onAlternatives={setAlternatives}
            onWatch={toggleWatch}
            watching={watch.isPending}
            releasing={release.isPending}
          />
          {sections.map((section) => (
            <SharedSectionBlock key={section.id} section={section}>
              <SharedCards
                items={section.items}
                isMine={isMine}
                requiredOf={requiredOf}
                onClaim={setClaiming}
                onView={setViewing}
                onRelease={(item) => release.mutate(item.id)}
                onAlternatives={setAlternatives}
                onWatch={toggleWatch}
                watching={watch.isPending}
                releasing={release.isPending}
              />
            </SharedSectionBlock>
          ))}
        </section>
      )}

      {alternatives && (
        <AlternativesModal
          token={token}
          item={alternatives}
          onClose={() => setAlternatives(null)}
        />
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
