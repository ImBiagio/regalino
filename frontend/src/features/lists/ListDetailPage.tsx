import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'

import {
  useClearGift,
  useDeleteList,
  useDeleteWish,
  useList,
  useRegenerateLink,
  useSaveWish,
  useWishes,
} from '../../api/hooks'
import { useConfirm } from '../../components/ConfirmDialog'
import { GiftMeta, eventLabel } from '../../components/gift'
import { PageHeader } from '../../components/Layout'
import {
  EmptyState,
  ErrorBanner,
  Fab,
  Field,
  Icon,
  IconButton,
  Modal,
  RowsSkeleton,
  Skeleton,
} from '../../components/ui'
import { ApiError } from '../../lib/api'
import { parsePrice, priceInput } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { UUID, Wish, WishList } from '../../lib/types'
import { ListFormModal } from './ListsPage'

export function shareUrl(list: Pick<WishList, 'share_token'>): string {
  return `${window.location.origin}/l/${list.share_token}`
}

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
        <Skeleton className="h-10 w-64" />
        <RowsSkeleton rows={4} />
      </div>
    )
  }

  const subtitle = [
    list.event_date ? eventLabel(list.event_date) : null,
    interpolate(ngettext('%s regalo', '%s regali', list.item_count), [list.item_count]),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <PageHeader
        title={list.title}
        subtitle={subtitle}
        back={{ to: '/', label: gettext('Le mie liste') }}
        actions={
          <>
            <button type="button" className="btn-filled" onClick={() => setSharing(true)}>
              <Icon name="share" size={20} />
              {gettext('Condividi')}
            </button>
            <IconButton
              icon="edit"
              label={gettext('Modifica lista')}
              onClick={() => setEditing(true)}
              size="md"
            />
          </>
        }
      />
      <div className="grid gap-3 px-5 md:px-8">
        {list.description && (
          <p className="max-w-3xl whitespace-pre-line text-body-medium text-on-surface-variant">
            {list.description}
          </p>
        )}
        <SurpriseNote list={list} onChange={() => setEditing(true)} />
        <WishRows
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

/** Ricorda che le spunte sono nascoste, o che si vedono. */
function SurpriseNote({ list, onChange }: { list: WishList; onChange: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card bg-surface-container px-4 py-3 text-body-medium">
      <Icon
        name={list.show_gifted ? 'visibility' : 'visibility_off'}
        size={20}
        className="text-on-surface-variant"
      />
      <span className="min-w-0 flex-1">
        {list.show_gifted
          ? gettext('Vedi cosa è già stato regalato e da chi.')
          : gettext('Sorpresa: non vedi cosa è già stato regalato. Chi ha il link sì.')}
      </span>
      <button type="button" className="btn-text btn-sm" onClick={onChange}>
        {gettext('Cambia')}
      </button>
    </div>
  )
}

function WishRows({
  list,
  onEdit,
  onAdd,
}: {
  list: WishList
  onEdit: (wish: Wish) => void
  onAdd: () => void
}) {
  const { data: wishes, isLoading, error } = useWishes(list.id)
  const remove = useDeleteWish(list.id)
  const clearGift = useClearGift(list.id)
  const confirm = useConfirm()

  if (isLoading) return <RowsSkeleton rows={4} />
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

  return (
    <div className="grid gap-1">
      <ErrorBanner error={error ?? remove.error ?? clearGift.error} />
      {wishes.map((wish) => (
        <div
          key={wish.id}
          role="button"
          tabIndex={0}
          onClick={() => onEdit(wish)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onEdit(wish)
          }}
          className="row-m3 cursor-pointer items-start"
        >
          <span
            className={
              wish.gifted
                ? 'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary text-on-primary'
                : 'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary-container text-on-primary-container'
            }
          >
            <Icon name={wish.gifted ? 'check' : 'redeem'} size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-body-large font-medium">{wish.title}</p>
            <GiftMeta price={wish.price} url={wish.url} />
            {wish.notes && (
              <p className="mt-1 line-clamp-2 text-body-small text-on-surface-variant">
                {wish.notes}
              </p>
            )}
            {wish.gifted && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-pill bg-secondary-container px-3 py-1 text-body-small font-medium text-on-secondary-container">
                <Icon name="check_circle" size={16} />
                {wish.gifted_by_name
                  ? interpolate(gettext('Regalato da %s'), [wish.gifted_by_name])
                  : gettext('Regalato')}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
            {wish.gifted && (
              <IconButton
                icon="remove_done"
                label={gettext('Togli la spunta')}
                onClick={async () => {
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
              />
            )}
            <IconButton
              icon="delete"
              label={gettext('Elimina regalo')}
              onClick={async () => {
                const ok = await confirm({
                  title: gettext('Eliminare il regalo?'),
                  message: interpolate(gettext('«%s» sparisce anche dal link condiviso.'), [
                    wish.title,
                  ]),
                  confirmLabel: gettext('Elimina'),
                  destructive: true,
                })
                if (ok) remove.mutate(wish.id)
              }}
            />
          </div>
        </div>
      ))}
    </div>
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
  const [title, setTitle] = useState(wish?.title ?? '')
  const [url, setUrl] = useState(wish?.url ?? '')
  const [price, setPrice] = useState(priceInput(wish?.price ?? null))
  const [notes, setNotes] = useState(wish?.notes ?? '')
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
            })
            .catch(() => null)
          if (saved) onClose()
        }}
      >
        {!fields.title && !fields.url && !fields.price && <ErrorBanner error={save.error} />}
        <Field label={gettext('Cosa ti piacerebbe')} error={fields.title}>
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
        <Field label={gettext('Note (taglia, colore, dove trovarlo)')}>
          <textarea
            className="field-input min-h-[72px] resize-y"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <div className="mt-2 flex flex-wrap justify-end gap-2">
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
