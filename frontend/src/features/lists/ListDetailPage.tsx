import { useState } from 'react'
import { NavLink, Navigate, useNavigate, useParams } from 'react-router-dom'

import {
  useClearGift,
  useDeleteList,
  useDeleteWish,
  useList,
  useRegenerateLink,
  useSaveList,
  useSaveWish,
  useWishes,
} from '../../api/hooks'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  AddTile,
  GiftBadge,
  GiftCard,
  ImagePicker,
  ListHero,
  useLinkFill,
} from '../../components/gift'
import type { ImageChoice } from '../../components/gift'
import {
  EmptyState,
  ErrorBanner,
  Fab,
  Field,
  Icon,
  Modal,
  Progress,
  Skeleton,
  Switch,
} from '../../components/ui'
import { ApiError } from '../../lib/api'
import { formatPrice, parsePrice, priceInput } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { UUID, Wish, WishList } from '../../lib/types'
import { ListFormModal } from './ListsPage'

export function shareUrl(list: Pick<WishList, 'share_token'>): string {
  return `${window.location.origin}/l/${list.share_token}`
}

/** Griglia delle card regalo: due colonne gia' sul telefono, come un catalogo. */
export const GIFT_GRID = 'grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4'

export function ListDetailPage() {
  const { listId } = useParams()
  const { data: list, isLoading, error } = useList(listId)
  const [editing, setEditing] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [wishForm, setWishForm] = useState<Wish | 'new' | null>(null)

  if (error instanceof ApiError && error.status === 404) return <Navigate to="/" replace />
  if (isLoading || !list) {
    return (
      <div className="grid gap-4 p-5 md:p-8">
        <ErrorBanner error={error} />
        <Skeleton className="h-52 rounded-panel" />
        <div className={GIFT_GRID}>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="aspect-[3/4] rounded-card" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
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
        <WishGrid
          list={list}
          onEdit={(wish) => setWishForm(wish)}
          onAdd={() => setWishForm('new')}
        />
      </div>

      <Fab icon="add" label={gettext('Aggiungi regalo')} onClick={() => setWishForm('new')} />
      {wishForm && (
        <WishFormModal
          listId={list.id}
          wish={wishForm === 'new' ? undefined : wishForm}
          onClose={() => setWishForm(null)}
        />
      )}
      {sharing && <ShareModal list={list} onClose={() => setSharing(false)} />}
      {editing && (
        <ListFormModal
          list={list}
          onClose={() => setEditing(false)}
          footer={<DeleteListButton list={list} onDeleted={() => setEditing(false)} />}
        />
      )}
    </>
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
  const clearGift = useClearGift(list.id)
  const confirm = useConfirm()

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

  const total = wishes.reduce((sum, wish) => sum + Number(wish.price ?? 0), 0)

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
      <ErrorBanner error={error ?? clearGift.error} />
      <div className={GIFT_GRID}>
        {wishes.map((wish) => (
          <GiftCard
            key={wish.id}
            seed={wish.id}
            image={wish.image}
            title={wish.title}
            price={wish.price}
            url={wish.url}
            notes={wish.notes}
            taken={Boolean(wish.gifted)}
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
              wish.gifted && (
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
              )
            }
          />
        ))}
        <AddTile label={gettext('Aggiungi regalo')} onClick={onAdd} />
      </div>
    </section>
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
  const [notes, setNotes] = useState(wish?.notes ?? '')
  const [image, setImage] = useState<ImageChoice>(undefined)
  // Nome, prezzo e note dal link del negozio, solo nei campi ancora liberi.
  const fill = useLinkFill(
    { title, price, notes },
    { title: setTitle, price: setPrice, notes: setNotes },
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
              notes: notes.trim(),
              ...(image !== undefined && { image_id: image.id }),
            })
            .catch(() => null)
          if (saved) onClose()
        }}
      >
        {!fields.title && !fields.url && !fields.price && !fields.image_id && (
          <ErrorBanner error={save.error ?? remove.error} />
        )}
        <Field label={gettext('Cosa ti piacerebbe')} error={fields.title} hint={fill.hint('title')}>
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
        <Field
          label={gettext('Prezzo indicativo (facoltativo)')}
          error={priceInvalid ? gettext('Scrivi un numero, es. 24,90') : fields.price}
          hint={fill.hint('price')}
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
        <ImagePicker
          current={wish?.image ?? null}
          choice={image}
          onChoice={setImage}
          link={url}
          fill={fill}
        />
        <Field label={gettext('Note (taglia, colore, dove trovarlo)')} hint={fill.hint('notes')}>
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
