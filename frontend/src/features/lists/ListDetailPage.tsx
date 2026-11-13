import clsx from 'clsx'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'

import {
  useClearGift,
  useDeleteList,
  useDeleteWish,
  useInviteLink,
  useList,
  useLists,
  useRegenerateLink,
  useRemoveMember,
  useSaveList,
  useSaveWish,
  useWatchWish,
  useWishes,
} from '../../api/hooks'
import { useConfirm } from '../../components/ConfirmDialog'
import { Page } from '../../components/Layout'
import {
  AddTile,
  GiftBadge,
  GiftCard,
  ImagePicker,
  ListHero,
  PriceTrend,
  WatchBell,
  WhereToBuy,
  lineTotal,
  useAskForLink,
  useLinkFill,
} from '../../components/gift'
import type { ImageChoice } from '../../components/gift'
import {
  Avatar,
  AvatarStack,
  EmptyState,
  ErrorBanner,
  Fab,
  Field,
  Icon,
  IconButton,
  Modal,
  Progress,
  Skeleton,
  Switch,
} from '../../components/ui'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDate, formatPrice, joinNames, parsePrice, priceInput } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { IncludedList, Person, UUID, Wish, WishList } from '../../lib/types'
import { ListFormModal } from './ListsPage'

// Lo stesso tetto del server (`MAX_QUANTITY`): oltre si scrive un regalo a parte.
const MAX_QUANTITY = 99

export function shareUrl(list: Pick<WishList, 'share_token'>): string {
  return `${window.location.origin}/l/${list.share_token}`
}

export function inviteUrl(list: Pick<WishList, 'invite_token'>): string {
  return `${window.location.origin}/unisciti/${list.invite_token ?? ''}`
}

/** Griglia delle card regalo: due colonne gia' sul telefono, come un catalogo. */
export const GIFT_GRID = 'stagger grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4'

export function ListDetailPage() {
  const { listId } = useParams()
  const { data: list, isLoading, error } = useList(listId)
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [members, setMembers] = useState(false)
  const [including, setIncluding] = useState(false)
  // Il form di un regalo: di questa lista o di una inclusa (``listId`` dice quale).
  const [wishForm, setWishForm] = useState<{ listId: UUID; wish?: Wish } | null>(null)

  if (error instanceof ApiError && error.status === 404) return <Navigate to="/" replace />
  if (isLoading || !list) {
    return (
      <Page className="grid gap-4 px-5 pt-5 md:px-8 md:pt-8">
        <ErrorBanner error={error} />
        <Skeleton className="h-52 rounded-panel" />
        <div className={GIFT_GRID}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="aspect-[3/4] rounded-card" />
          ))}
        </div>
      </Page>
    )
  }

  return (
    <Page>
      <div className="grid gap-4 px-5 pt-3 md:px-8 md:pt-6">
        <NavLink to="/" className="btn-text btn-sm -ml-3 justify-self-start">
          <Icon name="arrow_back" size={20} />
          {gettext('Le mie liste')}
        </NavLink>
        <ListHero
          eyebrow={interpolate(ngettext('%s regalo', '%s regali', list.item_count), [
            list.item_count,
          ])}
          title={list.title}
          eventDate={list.event_date}
          description={list.description}
        >
          <button type="button" className="btn-filled" onClick={() => setSharing(true)}>
            <Icon name="share" size={20} />
            {gettext('Condividi')}
          </button>
          <button
            type="button"
            className="btn bg-surface px-4 text-on-surface sm:px-6"
            aria-label={gettext('Modifica lista')}
            onClick={() => setEditing(true)}
          >
            <Icon name="edit" size={20} />
            <span className="hidden sm:inline">{gettext('Modifica')}</span>
          </button>
        </ListHero>
        <SurpriseCard list={list} />
        <MembersCard list={list} onManage={() => setMembers(true)} />
        <WishGrid
          list={list}
          onEdit={(wish) => setWishForm({ listId: list.id, wish })}
          onAdd={() => setWishForm({ listId: list.id })}
        />
        <IncludedSections
          list={list}
          onEdit={(listId, wish) => setWishForm({ listId, wish })}
          onAdd={(listId) => setWishForm({ listId })}
          onInclude={() => setIncluding(true)}
        />
      </div>

      <Fab
        icon="add"
        label={gettext('Aggiungi regalo')}
        onClick={() => setWishForm({ listId: list.id })}
      />
      {wishForm && (
        <WishFormModal
          listId={wishForm.listId}
          wish={wishForm.wish}
          onClose={() => setWishForm(null)}
        />
      )}
      {including && <IncludeListsModal list={list} onClose={() => setIncluding(false)} />}
      {sharing && <ShareModal list={list} onClose={() => setSharing(false)} />}
      {members && <MembersModal list={list} onClose={() => setMembers(false)} />}
      {editing && (
        <ListFormModal
          list={list}
          onClose={() => setEditing(false)}
          footer={
            list.is_owner && <DeleteListButton list={list} onDeleted={() => setEditing(false)} />
          }
        />
      )}
    </Page>
  )
}

/**
 * La sorpresa si cambia da qui, senza aprire il form. Accenderla e' innocuo,
 * spegnerla mostra le spunte: per quello si chiede conferma.
 */
function SurpriseCard({ list }: { list: WishList }) {
  const save = useSaveList()
  const confirm = useConfirm()
  const surprise = !list.show_gifted

  return (
    <div className="grid gap-3 rounded-card bg-surface-container-low px-4 py-3">
      <div className="flex items-center gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-tertiary-container text-on-tertiary-container">
          <Icon name={surprise ? 'visibility_off' : 'visibility'} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body-large">{gettext('Mostrami cosa è stato regalato')}</p>
          <p className="text-body-small text-on-surface-variant">
            {surprise
              ? gettext('Sorpresa: non vedi cosa è già stato regalato. Chi ha il link sì.')
              : gettext('Vedi cosa è già stato regalato e da chi.')}
          </p>
        </div>
        <Switch
          checked={list.show_gifted}
          disabled={save.isPending}
          label={gettext('Mostrami cosa è stato regalato')}
          onChange={async (checked) => {
            if (checked) {
              const ok = await confirm({
                title: gettext('Rinunci alla sorpresa?'),
                message: gettext(
                  'Vedrai quali regali sono già stati presi e da chi. Puoi rispegnerlo quando vuoi.',
                ),
                confirmLabel: gettext('Mostra'),
                icon: 'visibility',
              })
              if (!ok) return
            }
            save.mutate({ id: list.id, show_gifted: checked })
          }}
        />
      </div>
      {list.gifted_count !== null && list.item_count > 0 && (
        <div className="grid gap-1.5 pb-1">
          <p className="text-body-small text-on-surface-variant">
            {interpolate(gettext('%s di %s già presi'), [list.gifted_count, list.item_count])}
          </p>
          <Progress
            value={list.gifted_count}
            max={list.item_count}
            label={gettext('Regali già presi')}
          />
        </div>
      )}
      <ErrorBanner error={save.error} />
    </div>
  )
}

function WishGrid({
  list,
  onEdit,
  onAdd,
}: {
  list: WishList
  onEdit: (wish: Wish) => void
  onAdd: () => void
}) {
  const { data: wishes, isLoading, error } = useWishes(list.id)

  if (isLoading) {
    return (
      <div className={GIFT_GRID}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="aspect-[3/4] rounded-card" />
        ))}
      </div>
    )
  }
  if (!wishes?.length) {
    return (
      <>
        <ErrorBanner error={error} />
        <EmptyState
          icon="add_shopping_cart"
          title={gettext('La lista è vuota')}
          description={gettext(
            'Aggiungi i regali che ti piacerebbero: con il link al negozio e il prezzo è più facile per chi li compra.',
          )}
          action={
            <button type="button" className="btn-filled" onClick={onAdd}>
              <Icon name="add" size={20} />
              {gettext('Aggiungi regalo')}
            </button>
          }
        />
      </>
    )
  }

  const total = wishes.reduce(
    (sum, wish) => sum + Number(lineTotal(wish.price, wish.quantity) ?? 0),
    0,
  )

  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-title-medium">{gettext('I regali')}</h2>
        {total > 0 && (
          <p className="text-body-medium text-on-surface-variant">
            {gettext('Totale indicativo')}{' '}
            <span className="amount font-medium text-on-surface">
              {formatPrice(total.toFixed(2))}
            </span>
          </p>
        )}
      </div>
      <ErrorBanner error={error} />
      <WishCards listId={list.id} wishes={wishes} onEdit={onEdit} onAdd={onAdd} />
    </section>
  )
}

/** Le card dei regali di una lista (questa o una inclusa) con il riquadro "Aggiungi". */
function WishCards({
  listId,
  wishes,
  onEdit,
  onAdd,
}: {
  listId: UUID
  wishes: Wish[]
  onEdit: (wish: Wish) => void
  onAdd: () => void
}) {
  const clearGift = useClearGift(listId)
  const watch = useWatchWish(listId)
  const confirm = useConfirm()
  const askForLink = useAskForLink()

  return (
    <>
      <ErrorBanner error={clearGift.error ?? watch.error} />
      <div className={GIFT_GRID}>
        {wishes.map((wish) => (
          <GiftCard
            key={wish.id}
            seed={wish.id}
            image={wish.image}
            title={wish.title}
            price={wish.price}
            url={wish.url}
            quantity={wish.quantity}
            notes={wish.notes}
            taken={Boolean(wish.gifted)}
            detail={
              wish.requires_title && interpolate(gettext('Va con «%s»'), [wish.requires_title])
            }
            trend={
              <PriceTrend
                history={wish.price_history}
                title={wish.title}
                tracked={Boolean(wish.url)}
              />
            }
            corner={
              <WatchBell
                watching={wish.watching}
                pending={watch.isPending}
                onToggle={async () => {
                  if (wish.url || wish.watching) {
                    watch.mutate({ id: wish.id, watch: !wish.watching })
                  } else if (await askForLink()) {
                    onEdit(wish)
                  }
                }}
              />
            }
            onClick={() => onEdit(wish)}
            badge={
              wish.gifted && (
                <GiftBadge icon="check_circle">
                  {wish.gifted_by_name
                    ? interpolate(gettext('Regalato da %s'), [wish.gifted_by_name])
                    : gettext('Regalato')}
                </GiftBadge>
              )
            }
            footer={
              // "Dove trovarlo" anche qui: chi scrive la lista confronta i
              // negozi prima di mettere un link (o per sceglierne uno migliore).
              // Il dialog e' in un portal ma i click risalgono l'albero React:
              // senza fermarli qui un tocco nel dialog aprirebbe il form.
              <div
                className="grid justify-items-start gap-1"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <WhereToBuy item={wish} className="-ml-2" />
                {wish.gifted && (
                  <button
                    type="button"
                    className="btn-text btn-sm -ml-2"
                    onClick={async (event) => {
                      event.stopPropagation()
                      const ok = await confirm({
                        title: gettext('Togliere la spunta?'),
                        message: gettext(
                          'Il regalo torna disponibile per chi ha il link. Serve se qualcuno l’ha spuntato per sbaglio.',
                        ),
                        confirmLabel: gettext('Togli la spunta'),
                        icon: 'remove_done',
                      })
                      if (ok) clearGift.mutate(wish.id)
                    }}
                  >
                    <Icon name="remove_done" size={18} />
                    {gettext('Togli la spunta')}
                  </button>
                )}
              </div>
            }
          />
        ))}
        <AddTile label={gettext('Aggiungi regalo')} onClick={onAdd} />
      </div>
    </>
  )
}

/* ------------------------------------------------------------ liste incluse -- */

/**
 * Le liste incluse, una sezione ciascuna con i suoi regali (ADR 0008), e il
 * bottone per includerne. Una lista gia' dentro un'altra non include: mostra
 * dove sta.
 */
function IncludedSections({
  list,
  onEdit,
  onAdd,
  onInclude,
}: {
  list: WishList
  onEdit: (listId: UUID, wish: Wish) => void
  onAdd: (listId: UUID) => void
  onInclude: () => void
}) {
  if (list.included_in.length > 0) {
    return (
      <p className="flex items-center gap-2 px-1 text-body-medium text-on-surface-variant">
        <Icon name="folder_open" size={20} />
        <span>
          {gettext('Questa lista sta dentro')}{' '}
          {list.included_in.map((parent, index) => (
            <span key={parent.id}>
              {index > 0 && ', '}
              <NavLink to={`/liste/${parent.id}`} className="font-medium text-primary">
                {parent.title}
              </NavLink>
            </span>
          ))}
          {gettext(': i suoi regali si vedono anche lì.')}
        </span>
      </p>
    )
  }

  return (
    <>
      {list.included_lists.map((sub) => (
        <IncludedSection
          key={sub.id}
          sub={sub}
          onEdit={(wish) => onEdit(sub.id, wish)}
          onAdd={() => onAdd(sub.id)}
        />
      ))}
      <div className="grid gap-1 px-1">
        <button
          type="button"
          className="btn-text btn-sm -ml-3 justify-self-start"
          onClick={onInclude}
        >
          <Icon name="create_new_folder" size={18} />
          {list.included_lists.length > 0
            ? gettext('Scegli le liste incluse')
            : gettext('Includi un’altra lista')}
        </button>
        {list.included_lists.length === 0 && (
          <p className="text-body-small text-on-surface-variant">
            {gettext(
              'I regali di una lista inclusa compaiono anche qui e nel link di questa, in una sezione a parte.',
            )}
          </p>
        )}
      </div>
    </>
  )
}

function IncludedSection({
  sub,
  onEdit,
  onAdd,
}: {
  sub: IncludedList
  onEdit: (wish: Wish) => void
  onAdd: () => void
}) {
  const { data: wishes, isLoading, error } = useWishes(sub.id)

  return (
    <section className="grid gap-3 border-t border-outline-variant pt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
        <Icon name="folder_open" size={22} className="text-on-surface-variant" />
        <h2 className="text-title-medium">{sub.title}</h2>
        <span className="text-body-medium text-on-surface-variant">
          {interpolate(ngettext('%s regalo', '%s regali', sub.item_count), [sub.item_count])}
          {sub.event_date && ` · ${formatDate(sub.event_date)}`}
        </span>
        <NavLink to={`/liste/${sub.id}`} className="btn-text btn-sm ml-auto">
          {gettext('Apri la lista')}
          <Icon name="arrow_forward" size={18} />
        </NavLink>
      </div>
      <ErrorBanner error={error} />
      {isLoading ? (
        <div className={GIFT_GRID}>
          {[0, 1].map((index) => (
            <Skeleton key={index} className="aspect-[3/4] rounded-card" />
          ))}
        </div>
      ) : (
        <WishCards listId={sub.id} wishes={wishes ?? []} onEdit={onEdit} onAdd={onAdd} />
      )}
    </section>
  )
}

/** Quali liste includere: tutte le altre proprie, tranne quelle che includono gia'. */
function IncludeListsModal({ list, onClose }: { list: WishList; onClose: () => void }) {
  const { data: lists } = useLists()
  const save = useSaveList()
  const [chosen, setChosen] = useState<Set<UUID>>(
    () => new Set(list.included_lists.map((sub) => sub.id)),
  )
  const candidates = (lists ?? []).filter((other) => other.id !== list.id)

  return (
    <Modal open onClose={onClose} title={gettext('Liste incluse')}>
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const saved = await save
            .mutateAsync({ id: list.id, included_list_ids: [...chosen] })
            .catch(() => null)
          if (saved) onClose()
        }}
      >
        <p className="text-body-medium text-on-surface-variant">
          {gettext(
            'I regali delle liste scelte compaiono qui sotto e nel link di questa lista, ognuna nella sua sezione. Le liste restano anche da sole, con il loro link.',
          )}
        </p>
        <ErrorBanner error={save.error} />
        {candidates.length === 0 ? (
          <p className="text-body-medium">{gettext('Non hai altre liste da includere.')}</p>
        ) : (
          <div className="grid gap-1">
            {candidates.map((other) => {
              const nested = other.included_lists.length > 0
              return (
                <label
                  key={other.id}
                  className={clsx(
                    'flex items-center gap-3 rounded-row bg-surface-container-low px-4 py-3',
                    nested ? 'opacity-60' : 'state cursor-pointer',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--primary)]"
                    disabled={nested}
                    checked={chosen.has(other.id)}
                    onChange={(event) => {
                      const next = new Set(chosen)
                      if (event.target.checked) next.add(other.id)
                      else next.delete(other.id)
                      setChosen(next)
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-large">{other.title}</span>
                    <span className="block text-body-small text-on-surface-variant">
                      {nested
                        ? gettext('Include già altre liste: non si può includere.')
                        : interpolate(ngettext('%s regalo', '%s regali', other.item_count), [
                            other.item_count,
                          ])}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-text" onClick={onClose}>
            {gettext('Annulla')}
          </button>
          <button className="btn-filled" disabled={save.isPending}>
            {save.isPending ? gettext('Salvo…') : gettext('Salva')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function WishFormModal({
  listId,
  wish,
  onClose,
}: {
  listId: UUID
  wish?: Wish
  onClose: () => void
}) {
  const save = useSaveWish(listId)
  const remove = useDeleteWish(listId)
  const confirm = useConfirm()
  const [title, setTitle] = useState(wish?.title ?? '')
  const [url, setUrl] = useState(wish?.url ?? '')
  const [price, setPrice] = useState(priceInput(wish?.price ?? null))
  const [quantity, setQuantity] = useState(wish?.quantity ?? 1)
  const [notes, setNotes] = useState(wish?.notes ?? '')
  const [gtin, setGtin] = useState(wish?.gtin ?? '')
  const [brand, setBrand] = useState(wish?.brand ?? '')
  const [image, setImage] = useState<ImageChoice>(undefined)
  // "Va con": gli altri regali della lista, tranne quelli che gia' vanno con
  // questo (sarebbe un giro; il server lo rifiuta comunque).
  const [requires, setRequires] = useState<UUID | ''>(wish?.requires_id ?? '')
  const { data: siblings } = useWishes(listId)
  const companions = (siblings ?? []).filter((other) => {
    if (wish === undefined) return true
    let current: Wish | undefined = other
    for (let step = 0; current && step < 50; step += 1) {
      if (current.id === wish.id) return false
      current = (siblings ?? []).find((candidate) => candidate.id === current?.requires_id)
    }
    return true
  })
  // Nome, prezzo e note dal link del negozio, solo nei campi ancora liberi.
  const fill = useLinkFill(
    { title, price, notes, gtin, brand },
    { title: setTitle, price: setPrice, notes: setNotes, gtin: setGtin, brand: setBrand },
  )
  const fields = save.error instanceof ApiError ? save.error.fieldErrors() : {}
  const priceInvalid = price.trim() !== '' && parsePrice(price) === null

  return (
    <Modal
      open
      onClose={onClose}
      title={wish ? gettext('Modifica regalo') : gettext('Nuovo regalo')}
    >
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          if (priceInvalid) return
          const saved = await save
            .mutateAsync({
              id: wish?.id,
              title: title.trim(),
              url: url.trim(),
              price: parsePrice(price),
              quantity,
              notes: notes.trim(),
              gtin,
              brand,
              requires_id: requires || null,
              ...(image !== undefined && { image_id: image.id }),
            })
            .catch(() => null)
          if (saved) onClose()
        }}
      >
        {!fields.title &&
          !fields.url &&
          !fields.price &&
          !fields.quantity &&
          !fields.image_id &&
          !fields.requires_id && <ErrorBanner error={save.error ?? remove.error} />}
        <Field
          label={gettext('Cosa ti piacerebbe')}
          error={fields.title}
          hint={fill.hint('title')}
          glow={fill.glow('title')}
        >
          <input
            className="field-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={gettext('Le cuffie, un libro, una cena fuori…')}
            required
            autoFocus={!wish}
            maxLength={160}
          />
        </Field>
        <Field label={gettext('Link (facoltativo)')} error={fields.url}>
          <input
            className="field-input"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://"
          />
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-start gap-3">
          <Field
            label={gettext('Prezzo indicativo (facoltativo)')}
            error={priceInvalid ? gettext('Scrivi un numero, es. 24,90') : fields.price}
            hint={fill.hint('price')}
            glow={fill.glow('price')}
          >
            <div className="flex items-center gap-2">
              <span className="text-body-large text-on-surface-variant">€</span>
              <input
                className="field-input amount"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="0,00"
              />
            </div>
          </Field>
          <QuantityField value={quantity} onChange={setQuantity} error={fields.quantity} />
        </div>
        {quantity > 1 && parsePrice(price) && (
          <p className="-mt-2 px-4 text-body-small text-on-surface-variant">
            {interpolate(gettext('In tutto %s'), [
              formatPrice(lineTotal(parsePrice(price), quantity)),
            ])}
          </p>
        )}
        <ImagePicker
          current={wish?.image ?? null}
          choice={image}
          onChoice={setImage}
          link={url}
          fill={fill}
        />
        {companions.length > 0 && (
          <Field
            label={gettext('Va con un altro regalo (facoltativo)')}
            error={fields.requires_id}
            hint={gettext('Chi ha il link può prenderlo solo dopo che quello è stato preso.')}
          >
            <select
              className="field-input"
              value={requires}
              onChange={(event) => setRequires(event.target.value as UUID | '')}
            >
              <option value="">{gettext('Nessuno')}</option>
              {companions.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label={gettext('Note (taglia, colore, dove trovarlo)')}
          hint={fill.hint('notes')}
          glow={fill.glow('notes')}
        >
          <textarea
            className="field-input min-h-[72px] resize-y"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Eliminare sta nel form: la card resta pulita, un tocco apre e basta. */}
          {wish && (
            <button
              type="button"
              className="btn-text -ml-3 text-error"
              disabled={remove.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: gettext('Eliminare il regalo?'),
                  message: interpolate(gettext('«%s» sparisce anche dal link condiviso.'), [
                    wish.title,
                  ]),
                  confirmLabel: gettext('Elimina'),
                  destructive: true,
                })
                if (!ok) return
                const done = await remove.mutateAsync(wish.id).then(
                  () => true,
                  () => false,
                )
                if (done) onClose()
              }}
            >
              <Icon name="delete" size={20} />
              {gettext('Elimina')}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn-text" onClick={onClose}>
            {gettext('Annulla')}
          </button>
          <button className="btn-filled" disabled={save.isPending || !title.trim() || priceInvalid}>
            {save.isPending ? gettext('Salvo…') : gettext('Salva')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Quanti ne servono: − e + attorno al numero, da 1 a 99 (il prezzo resta quello del pezzo). */
function QuantityField({
  value,
  onChange,
  error,
}: {
  value: number
  onChange: (value: number) => void
  error?: string
}) {
  const clamp = (next: number) => onChange(Math.min(MAX_QUANTITY, Math.max(1, next)))
  return (
    <Field label={gettext('Quanti')} error={error}>
      <div className="flex items-center gap-1">
        <IconButton
          icon="remove"
          label={gettext('Uno in meno')}
          disabled={value <= 1}
          onClick={() => clamp(value - 1)}
        />
        <input
          className="field-input amount w-12 text-center"
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10)
            if (Number.isFinite(next)) clamp(next)
          }}
          aria-label={gettext('Quanti')}
        />
        <IconButton
          icon="add"
          label={gettext('Uno in più')}
          disabled={value >= MAX_QUANTITY}
          onClick={() => clamp(value + 1)}
        />
      </div>
    </Field>
  )
}

function ShareModal({ list, onClose }: { list: WishList; onClose: () => void }) {
  const regenerate = useRegenerateLink(list.id)
  const confirm = useConfirm()
  const [copied, setCopied] = useState(false)
  const url = shareUrl(list)
  const canShare = typeof navigator.share === 'function'

  return (
    <Modal open onClose={onClose} title={gettext('Condividi la lista')}>
      <div className="grid gap-4">
        <p className="text-body-medium text-on-surface-variant">
          {gettext(
            'Chi ha questo link vede la lista senza account e può segnare un regalo come preso, così nessuno fa doppioni.',
          )}
        </p>
        <div className="flex items-center gap-2 rounded-row bg-surface-container px-4 py-3">
          <Icon name="link" size={20} className="text-on-surface-variant" />
          <span className="min-w-0 flex-1 truncate text-body-medium">{url}</span>
        </div>
        <ErrorBanner error={regenerate.error} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-filled flex-1"
            onClick={async () => {
              await navigator.clipboard.writeText(url).catch(() => undefined)
              setCopied(true)
            }}
          >
            <Icon name={copied ? 'check' : 'content_copy'} size={20} />
            {copied ? gettext('Link copiato') : gettext('Copia link')}
          </button>
          {canShare && (
            <button
              type="button"
              className="btn-tonal flex-1"
              onClick={() =>
                navigator
                  .share({
                    title: list.title,
                    text: interpolate(gettext('La mia lista dei regali: %s'), [list.title]),
                    url,
                  })
                  .catch(() => undefined)
              }
            >
              <Icon name="ios_share" size={20} />
              {gettext('Invia…')}
            </button>
          )}
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-outlined flex-1">
            <Icon name="visibility" size={20} />
            {gettext('Vedi come gli altri')}
          </a>
        </div>
        {list.is_owner && (
          <div className="border-t border-outline-variant pt-4">
            <p className="text-body-medium">{gettext('Il link è finito nelle mani sbagliate?')}</p>
            <button
              type="button"
              className="btn-text btn-sm -ml-3 mt-1"
              disabled={regenerate.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: gettext('Creare un link nuovo?'),
                  message: gettext(
                    'Il link di adesso smette di funzionare: dovrai rimandare quello nuovo a chi vuoi che veda la lista. Le spunte restano.',
                  ),
                  confirmLabel: gettext('Crea link nuovo'),
                  icon: 'link_off',
                })
                if (ok) {
                  regenerate.mutate()
                  setCopied(false)
                }
              }}
            >
              <Icon name="autorenew" size={18} />
              {gettext('Crea un link nuovo')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function DeleteListButton({ list, onDeleted }: { list: WishList; onDeleted: () => void }) {
  const remove = useDeleteList()
  const confirm = useConfirm()
  const navigate = useNavigate()

  return (
    <div className="mt-2 border-t border-outline-variant pt-4">
      <ErrorBanner error={remove.error} />
      <button
        type="button"
        className="btn-text btn-sm -ml-3 text-error"
        disabled={remove.isPending}
        onClick={async () => {
          const ok = await confirm({
            title: gettext('Eliminare la lista?'),
            message: interpolate(
              gettext('«%s» e i suoi regali spariscono, e il link condiviso smette di funzionare.'),
              [list.title],
            ),
            confirmLabel: gettext('Elimina lista'),
            destructive: true,
          })
          if (!ok) return
          await remove.mutateAsync(list.id)
          onDeleted()
          navigate('/', { replace: true })
        }}
      >
        <Icon name="delete" size={18} />
        {gettext('Elimina lista')}
      </button>
    </div>
  )
}

/* ------------------------------------------------ scrivere la lista insieme -- */

/** Chi scrive la lista oltre a chi guarda: per "Con Anna e Luca" / "Di Giulia". */
function companions(list: WishList, me: UUID | undefined): Person[] {
  const people = list.is_owner ? list.members : [list.owner, ...list.members]
  return people.filter((person) => person.id !== me)
}

/**
 * Sotto la sorpresa: chi scrive la lista, e il bottone per invitare o
 * gestire. Anche da soli: e' qui che si scopre che si puo' scriverla in due.
 */
function MembersCard({ list, onManage }: { list: WishList; onManage: () => void }) {
  const { user } = useAuth()
  const others = companions(list, user?.id)
  const alone = others.length === 0

  return (
    <div className="flex items-center gap-4 rounded-card bg-surface-container-low px-4 py-3">
      {alone ? (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-secondary-container text-on-secondary-container">
          <Icon name="group" size={22} />
        </span>
      ) : (
        <AvatarStack people={others.map((p) => ({ name: p.display_name }))} size={36} />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body-large">
          {alone
            ? gettext('La scrivi solo tu')
            : list.is_owner
              ? interpolate(gettext('La scrivi con %s'), [
                  joinNames(others.map((p) => p.display_name)),
                ])
              : interpolate(gettext('Lista di %s'), [list.owner.display_name])}
        </p>
        <p className="text-body-small text-on-surface-variant">
          {alone
            ? gettext('Invita qualcuno a scriverla con te: aggiunge e modifica i regali come te.')
            : list.is_owner || others.length === 1
              ? gettext('Chi è dentro aggiunge e modifica i regali, e non vede chi li ha presi.')
              : interpolate(gettext('La scrivete in %s.'), [others.length + 1])}
        </p>
      </div>
      <button type="button" className="btn-tonal btn-sm shrink-0" onClick={onManage}>
        <Icon name={alone ? 'person_add' : 'manage_accounts'} size={18} />
        {alone ? gettext('Invita') : gettext('Gestisci')}
      </button>
    </div>
  )
}

/** Chi c'e', il link d'invito, uscire. Togliere gli altri: solo il proprietario. */
function MembersModal({ list, onClose }: { list: WishList; onClose: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const invite = useInviteLink(list.id)
  const remove = useRemoveMember(list.id)
  const confirm = useConfirm()
  const [copied, setCopied] = useState(false)
  const url = inviteUrl(list)
  const canShare = typeof navigator.share === 'function'

  const leave = async () => {
    const ok = await confirm({
      title: gettext('Uscire dalla lista?'),
      message: interpolate(
        gettext('«%s» sparisce dalle tue liste. Per tornarci ti serve un nuovo invito.'),
        [list.title],
      ),
      confirmLabel: gettext('Esci dalla lista'),
      destructive: true,
    })
    if (!ok || !user) return
    await remove.mutateAsync(user.id).catch(() => null)
    onClose()
    navigate('/', { replace: true })
  }

  return (
    <Modal open onClose={onClose} title={gettext('Chi scrive la lista')}>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <PersonRow person={list.owner} caption={gettext('Ha creato la lista')} me={user?.id} />
          {list.members.map((member) => (
            <PersonRow
              key={member.id}
              person={member}
              me={user?.id}
              action={
                list.is_owner ? (
                  <IconButton
                    icon="person_remove"
                    label={interpolate(gettext('Togli %s'), [member.display_name])}
                    disabled={remove.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: interpolate(gettext('Togliere %s?'), [member.display_name]),
                        message: gettext(
                          'Non vedrà più la lista. Puoi mandare di nuovo l’invito quando vuoi.',
                        ),
                        confirmLabel: gettext('Togli'),
                        destructive: true,
                      })
                      if (ok) remove.mutate(member.id)
                    }}
                  />
                ) : member.id === user?.id ? (
                  <button type="button" className="btn-text btn-sm text-error" onClick={leave}>
                    {gettext('Esci dalla lista')}
                  </button>
                ) : undefined
              }
            />
          ))}
        </div>
        <ErrorBanner error={invite.error ?? remove.error} />

        <div className="grid gap-3 border-t border-outline-variant pt-4">
          <p className="text-body-medium text-on-surface-variant">
            {gettext(
              'Chi apre il link d’invito con un account entra nella lista: aggiunge e modifica i regali come te. Non è il link da mandare a chi deve farti i regali.',
            )}
          </p>
          {list.invite_token ? (
            <>
              <div className="flex items-center gap-2 rounded-row bg-surface-container px-4 py-3">
                <Icon name="group_add" size={20} className="text-on-surface-variant" />
                <span className="min-w-0 flex-1 truncate text-body-medium">{url}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-filled flex-1"
                  onClick={async () => {
                    await navigator.clipboard.writeText(url).catch(() => undefined)
                    setCopied(true)
                  }}
                >
                  <Icon name={copied ? 'check' : 'content_copy'} size={20} />
                  {copied ? gettext('Link copiato') : gettext('Copia link')}
                </button>
                {canShare && (
                  <button
                    type="button"
                    className="btn-tonal flex-1"
                    onClick={() =>
                      navigator
                        .share({
                          title: list.title,
                          text: interpolate(gettext('Scrivi con me la lista dei regali: %s'), [
                            list.title,
                          ]),
                          url,
                        })
                        .catch(() => undefined)
                    }
                  >
                    <Icon name="ios_share" size={20} />
                    {gettext('Invia…')}
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn-text btn-sm -ml-3 justify-self-start"
                disabled={invite.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: gettext('Spegnere il link d’invito?'),
                    message: gettext(
                      'Chi lo ha non può più entrare. Chi è già dentro resta. Potrai crearne uno nuovo.',
                    ),
                    confirmLabel: gettext('Spegni'),
                    icon: 'link_off',
                  })
                  if (ok) {
                    invite.mutate(false)
                    setCopied(false)
                  }
                }}
              >
                <Icon name="link_off" size={18} />
                {gettext('Spegni il link d’invito')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-tonal justify-self-start"
              disabled={invite.isPending}
              onClick={() => invite.mutate(true)}
            >
              <Icon name="group_add" size={20} />
              {gettext('Crea il link d’invito')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function PersonRow({
  person,
  caption,
  me,
  action,
}: {
  person: Person
  caption?: string
  me: UUID | undefined
  action?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-row bg-surface-container-low px-3 py-2">
      <Avatar name={person.display_name} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-large">
          {person.display_name}
          {person.id === me && <span className="text-on-surface-variant"> · {gettext('tu')}</span>}
        </p>
        {caption && <p className="text-body-small text-on-surface-variant">{caption}</p>}
      </div>
      {action}
    </div>
  )
}
