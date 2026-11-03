import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useLists, useSaveList } from '../../api/hooks'
import { eventLabel } from '../../components/gift'
import { PageHeader } from '../../components/Layout'
import {
  EmptyState,
  ErrorBanner,
  Fab,
  Field,
  Icon,
  Modal,
  RowsSkeleton,
  Switch,
} from '../../components/ui'
import { ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { WishList } from '../../lib/types'

/** Le liste dei regali che l'utente vorrebbe ricevere. */
export function ListsPage() {
  const { user } = useAuth()
  const { data: lists, isLoading, error } = useLists()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  return (
    <>
      <PageHeader
        title={gettext('Le mie liste')}
        subtitle={interpolate(
          gettext('Ciao %s: qui scrivi cosa ti piacerebbe ricevere e lo condividi con un link.'),
          [user?.display_name ?? ''],
        )}
      />
      <div className="grid gap-3 px-5 md:px-8">
        <ErrorBanner error={error} />
        {isLoading && <RowsSkeleton rows={3} />}
        {lists && lists.length === 0 && (
          <EmptyState
            icon="redeem"
            title={gettext('Nessuna lista, per ora')}
            description={gettext(
              'Crea una lista per il compleanno, per Natale o per quello che vuoi: aggiungi i regali e manda il link a chi deve farteli.',
            )}
            action={
              <button type="button" className="btn-filled" onClick={() => setCreating(true)}>
                <Icon name="add" size={20} />
                {gettext('Crea la prima lista')}
              </button>
            }
          />
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lists?.map((list) => (
            <ListCard key={list.id} list={list} />
          ))}
        </div>
      </div>

      <Fab icon="add" label={gettext('Nuova lista')} onClick={() => setCreating(true)} />
      {creating && (
        <ListFormModal
          onClose={() => setCreating(false)}
          onSaved={(list) => navigate(`/liste/${list.id}`)}
        />
      )}
    </>
  )
}

function ListCard({ list }: { list: WishList }) {
  return (
    <Link
      to={`/liste/${list.id}`}
      className="state flex flex-col gap-3 rounded-card bg-surface-container-low p-5"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-nav bg-primary-container text-on-primary-container">
          <Icon name="featured_seasonal_and_gifts" size={26} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-title-medium">{list.title}</p>
          {list.event_date && (
            <p className="text-body-small text-on-surface-variant">{eventLabel(list.event_date)}</p>
          )}
        </div>
      </div>
      {list.description && (
        <p className="line-clamp-2 text-body-medium text-on-surface-variant">{list.description}</p>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <span className="chip-assist">
          <Icon name="checklist" size={18} />
          {interpolate(ngettext('%s regalo', '%s regali', list.item_count), [list.item_count])}
        </span>
        {list.gifted_count !== null ? (
          <span className="chip-assist">
            <Icon name="check_circle" size={18} />
            {interpolate(ngettext('%s regalato', '%s regalati', list.gifted_count), [
              list.gifted_count,
            ])}
          </span>
        ) : (
          <span className="chip-assist">
            <Icon name="visibility_off" size={18} />
            {gettext('Sorpresa')}
          </span>
        )}
      </div>
    </Link>
  )
}

/** Crea o modifica una lista: nome, data, descrizione e, in modifica, la sorpresa. */
export function ListFormModal({
  list,
  onClose,
  onSaved,
  footer,
}: {
  list?: WishList
  onClose: () => void
  onSaved?: (list: WishList) => void
  footer?: ReactNode
}) {
  const save = useSaveList()
  const [title, setTitle] = useState(list?.title ?? '')
  const [description, setDescription] = useState(list?.description ?? '')
  const [eventDate, setEventDate] = useState(list?.event_date ?? '')
  const [showGifted, setShowGifted] = useState(list?.show_gifted ?? false)
  const fields = save.error instanceof ApiError ? save.error.fieldErrors() : {}

  return (
    <Modal open onClose={onClose} title={list ? gettext('Modifica lista') : gettext('Nuova lista')}>
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const saved = await save
            .mutateAsync({
              id: list?.id,
              title: title.trim(),
              description: description.trim(),
              event_date: eventDate || null,
              show_gifted: showGifted,
            })
            .catch(() => null)
          if (!saved) return
          onSaved?.(saved)
          onClose()
        }}
      >
        {!fields.title && <ErrorBanner error={save.error} />}
        <Field label={gettext('Nome della lista')} error={fields.title}>
          <input
            className="field-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={gettext('Compleanno, Natale, Matrimonio…')}
            required
            autoFocus={!list}
            maxLength={120}
          />
        </Field>
        <Field label={gettext('Data (facoltativa)')} error={fields.event_date}>
          <input
            className="field-input"
            type="date"
            value={eventDate}
            onChange={(event) => setEventDate(event.target.value)}
          />
        </Field>
        <Field label={gettext('Due parole per chi la apre (facoltative)')}>
          <textarea
            className="field-input min-h-[72px] resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={gettext('Taglia M, niente cioccolato, grazie!')}
          />
        </Field>
        {list && (
          <div className="flex items-center gap-4 rounded-row bg-surface-container-low px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body-large">{gettext('Mostrami cosa è stato regalato')}</p>
              <p className="text-body-small text-on-surface-variant">
                {gettext(
                  'Spento, non vedi le spunte di chi ha il link: la sorpresa resta. Acceso, vedi cosa è preso e da chi.',
                )}
              </p>
            </div>
            <Switch
              checked={showGifted}
              onChange={setShowGifted}
              label={gettext('Mostrami cosa è stato regalato')}
            />
          </div>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-text" onClick={onClose}>
            {gettext('Annulla')}
          </button>
          <button className="btn-filled" disabled={save.isPending || !title.trim()}>
            {save.isPending ? gettext('Salvo…') : list ? gettext('Salva') : gettext('Crea lista')}
          </button>
        </div>
        {footer}
      </form>
    </Modal>
  )
}
