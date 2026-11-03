import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useLists, useSaveList } from '../../api/hooks'
import { AddTile, GiftWrap, countdownLabel } from '../../components/gift'
import { PageHeader } from '../../components/Layout'
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
import { useAuth } from '../../lib/auth'
import { daysUntil, formatDate } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { WishList } from '../../lib/types'

/**
 * Prima le liste con la festa piu' vicina, poi quelle senza data, in fondo
 * quelle passate: in cima c'e' la lista che serve adesso.
 */
function byNextEvent(a: WishList, b: WishList): number {
  const rank = (list: WishList) => {
    if (!list.event_date) return [1, 0]
    const days = daysUntil(list.event_date)
    return days >= 0 ? [0, days] : [2, -days]
  }
  const [groupA, daysA] = rank(a)
  const [groupB, daysB] = rank(b)
  return groupA - groupB || daysA - daysB
}

/** Le liste dei regali che l'utente vorrebbe ricevere. */
export function ListsPage() {
  const { user } = useAuth()
  const { data: lists, isLoading, error } = useLists()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()
  const sorted = useMemo(() => [...(lists ?? [])].sort(byNextEvent), [lists])

  return (
    <>
      <PageHeader
        title={gettext('Le mie liste')}
        subtitle={interpolate(
          gettext('Ciao %s: qui scrivi cosa ti piacerebbe ricevere e lo condividi con un link.'),
          [user?.display_name ?? ''],
        )}
      />
      <div className="grid gap-4 px-5 md:px-8">
        <ErrorBanner error={error} />
        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-[236px] rounded-card" />
            ))}
          </div>
        )}
        {lists && lists.length === 0 && (
          <EmptyState
            icon="featured_seasonal_and_gifts"
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
        {sorted.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((list) => (
              <ListCard key={list.id} list={list} />
            ))}
            <AddTile
              label={gettext('Nuova lista')}
              onClick={() => setCreating(true)}
              className="hidden sm:flex"
            />
          </div>
        )}
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

/** Una lista come un pacco: la carta in alto con quanto manca, sotto i conti. */
function ListCard({ list }: { list: WishList }) {
  const past = list.event_date !== null && daysUntil(list.event_date) < 0
  return (
    <Link to={`/liste/${list.id}`} className="card-elevated state flex flex-col overflow-hidden">
      <span className="relative block h-24">
        <GiftWrap
          seed={list.id}
          ribbon={12}
          x={78}
          y={58}
          className={past ? 'h-full opacity-50' : 'h-full'}
        />
        {list.event_date && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-pill bg-surface py-1 pl-2 pr-3 text-label-small text-on-surface shadow-fab">
            <Icon name="schedule" size={16} />
            {countdownLabel(list.event_date)}
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col gap-3 p-5">
        <span className="min-w-0">
          <span className="block truncate text-title-medium">{list.title}</span>
          {list.event_date && (
            <span className="block text-body-small text-on-surface-variant">
              {formatDate(list.event_date)}
            </span>
          )}
        </span>
        {list.description && (
          <span className="line-clamp-2 text-body-medium text-on-surface-variant">
            {list.description}
          </span>
        )}
        <span className="mt-auto grid gap-2">
          <span className="flex items-center justify-between gap-2 text-body-medium">
            <span className="inline-flex items-center gap-1.5 text-on-surface-variant">
              <Icon name="redeem" size={18} />
              {interpolate(ngettext('%s regalo', '%s regali', list.item_count), [list.item_count])}
            </span>
            {list.gifted_count !== null ? (
              <span className="font-medium">
                {interpolate(ngettext('%s preso', '%s presi', list.gifted_count), [
                  list.gifted_count,
                ])}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-on-surface-variant">
                <Icon name="visibility_off" size={18} />
                {gettext('Sorpresa')}
              </span>
            )}
          </span>
          {list.gifted_count !== null && list.item_count > 0 && (
            <Progress
              value={list.gifted_count}
              max={list.item_count}
              label={gettext('Regali già presi')}
            />
          )}
        </span>
      </span>
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
