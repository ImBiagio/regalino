import clsx from 'clsx'
import { useMemo, useState } from 'react'

import { useDeleteIdea, useIdeas, useSaveIdea, useWatchIdea } from '../../api/hooks'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  GiftMeta,
  GiftThumb,
  ImagePicker,
  PriceTrend,
  WhereToBuy,
  useAskForLink,
  useLinkFill,
} from '../../components/gift'
import type { ImageChoice } from '../../components/gift'
import { Page, PageHeader } from '../../components/Layout'
import {
  Avatar,
  Chip,
  EmptyState,
  ErrorBanner,
  Fab,
  Field,
  Icon,
  IconButton,
  Modal,
  RowsSkeleton,
  Segmented,
} from '../../components/ui'
import { ApiError } from '../../lib/api'
import { formatPrice, parsePrice, priceInput } from '../../lib/format'
import { gettext, interpolate, ngettext } from '../../lib/i18n'
import type { GiftIdea, IdeaStatus } from '../../lib/types'
import { InspireWizard } from './InspireWizard'

const STATUS_LABEL: Record<IdeaStatus, string> = {
  idea: gettext('Idea'),
  bought: gettext('Comprato'),
  given: gettext('Regalato'),
}

const STATUS_ICON: Record<IdeaStatus, string> = {
  idea: 'lightbulb',
  bought: 'shopping_bag',
  given: 'check_circle',
}

/** Un tocco sullo stato passa al successivo: idea → comprato → regalato → idea. */
const NEXT_STATUS: Record<IdeaStatus, IdeaStatus> = {
  idea: 'bought',
  bought: 'given',
  given: 'idea',
}

type Filter = 'open' | IdeaStatus | 'all'

/** "Da regalare": le idee per gli altri, raggruppate per persona. Private. */
export function IdeasPage() {
  const { data: ideas, isLoading, error } = useIdeas()
  const [filter, setFilter] = useState<Filter>('open')
  const [form, setForm] = useState<GiftIdea | { recipient: string } | null>(null)
  // Il wizard "Ispirami": aperto con la persona (o vuoto).
  const [inspire, setInspire] = useState<string | null>(null)

  const recipients = useMemo(
    () =>
      [...new Set((ideas ?? []).map((idea) => idea.recipient))].sort((a, b) => a.localeCompare(b)),
    [ideas],
  )
  const groups = useMemo(() => {
    const visible = (ideas ?? []).filter((idea) =>
      filter === 'all'
        ? true
        : filter === 'open'
          ? idea.status !== 'given'
          : idea.status === filter,
    )
    const byRecipient = new Map<string, GiftIdea[]>()
    for (const idea of visible) {
      byRecipient.set(idea.recipient, [...(byRecipient.get(idea.recipient) ?? []), idea])
    }
    return [...byRecipient.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [ideas, filter])

  const filters: { value: Filter; label: string }[] = [
    { value: 'open', label: gettext('Da fare') },
    { value: 'idea', label: gettext('Idee') },
    { value: 'bought', label: gettext('Comprati') },
    { value: 'given', label: gettext('Regalati') },
    { value: 'all', label: gettext('Tutte') },
  ]

  return (
    <Page>
      <PageHeader
        title={gettext('Da regalare')}
        subtitle={gettext('Le idee per gli altri, e per chi. Le vedi solo tu.')}
        actions={
          <button type="button" className="btn-tonal btn-sm" onClick={() => setInspire('')}>
            <Icon name="auto_awesome" size={18} />
            {gettext('Ispirami')}
          </button>
        }
      />
      <div className="grid gap-4 px-5 md:px-8">
        <ErrorBanner error={error} />
        {ideas && ideas.length > 0 && (
          <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
            {filters.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                selected={filter === option.value}
                onClick={() => setFilter(option.value)}
              />
            ))}
          </div>
        )}
        {isLoading && <RowsSkeleton rows={4} />}
        {ideas && ideas.length === 0 && (
          <EmptyState
            icon="volunteer_activism"
            title={gettext('Nessuna idea, per ora')}
            description={gettext(
              'Quando ti viene in mente il regalo giusto per qualcuno, segnalo qui: per chi, cosa, quanto costa. Poi lo spunti quando lo compri e quando lo regali.',
            )}
            action={
              <button
                type="button"
                className="btn-filled"
                onClick={() => setForm({ recipient: '' })}
              >
                <Icon name="add" size={20} />
                {gettext('Aggiungi idea')}
              </button>
            }
          />
        )}
        {ideas && ideas.length > 0 && groups.length === 0 && (
          <p className="px-1 text-body-medium text-on-surface-variant">
            {gettext('Niente in questa vista.')}
          </p>
        )}
        {groups.map(([recipient, items]) => (
          <RecipientGroup
            key={recipient}
            recipient={recipient}
            ideas={items}
            onEdit={(idea) => setForm(idea)}
            onAdd={() => setForm({ recipient })}
            onInspire={() => setInspire(recipient)}
          />
        ))}
      </div>

      <Fab icon="add" label={gettext('Nuova idea')} onClick={() => setForm({ recipient: '' })} />
      {inspire !== null && (
        <InspireWizard
          recipient={inspire}
          recipients={recipients}
          onClose={() => setInspire(null)}
        />
      )}
      {form && (
        <IdeaFormModal
          idea={'id' in form ? form : undefined}
          recipient={form.recipient}
          recipients={recipients}
          onClose={() => setForm(null)}
        />
      )}
    </Page>
  )
}

function RecipientGroup({
  recipient,
  ideas,
  onEdit,
  onAdd,
  onInspire,
}: {
  recipient: string
  ideas: GiftIdea[]
  onEdit: (idea: GiftIdea) => void
  onAdd: () => void
  onInspire: () => void
}) {
  const save = useSaveIdea()
  const remove = useDeleteIdea()
  const watch = useWatchIdea()
  const confirm = useConfirm()
  const askForLink = useAskForLink()
  const total = ideas.reduce((sum, idea) => sum + Number(idea.price ?? 0), 0)

  return (
    <section className="card-elevated p-2">
      <div className="flex items-center gap-3 px-3 pb-3 pt-3">
        <Avatar name={recipient} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-title-medium">{recipient}</h2>
          <p className="text-body-small text-on-surface-variant">
            {interpolate(ngettext('%s idea', '%s idee', ideas.length), [ideas.length])}
            {total > 0 && (
              <>
                {' · '}
                <span className="amount">{formatPrice(total.toFixed(2))}</span>
              </>
            )}
          </p>
        </div>
        <IconButton
          icon="auto_awesome"
          label={interpolate(gettext('Idee per %s'), [recipient])}
          onClick={onInspire}
          size="md"
        />
        <IconButton
          icon="add"
          label={interpolate(gettext('Nuova idea per %s'), [recipient])}
          onClick={onAdd}
          size="md"
          inheritColor
          className="bg-primary-container text-on-primary-container"
        />
      </div>
      <ErrorBanner error={save.error ?? remove.error ?? watch.error} />
      <div className="grid gap-1">
        {ideas.map((idea) => (
          <div
            key={idea.id}
            role="button"
            tabIndex={0}
            onClick={() => onEdit(idea)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onEdit(idea)
            }}
            className="state flex cursor-pointer items-start gap-3 rounded-row bg-surface px-4 py-3"
          >
            <GiftThumb image={idea.image} seed={idea.id} done={idea.status === 'given'} size={56} />
            <div className="min-w-0 flex-1">
              <p
                className={clsx(
                  'break-words text-body-large font-medium',
                  idea.status === 'given' && 'text-on-surface-variant line-through',
                )}
              >
                {idea.title}
              </p>
              {idea.occasion && (
                <p className="text-body-small text-on-surface-variant">{idea.occasion}</p>
              )}
              <GiftMeta price={idea.price} url={idea.url} />
              <PriceTrend
                history={idea.price_history}
                title={idea.title}
                tracked={Boolean(idea.url)}
              />
              <div
                className="mt-2 flex flex-wrap items-center gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className={clsx(
                    'state inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-body-small font-medium',
                    idea.status === 'idea' && 'bg-secondary-container text-on-secondary-container',
                    idea.status === 'bought' && 'bg-tertiary-container text-on-tertiary-container',
                    idea.status === 'given' && 'bg-success-container text-on-success-container',
                  )}
                  aria-label={interpolate(gettext('Stato: %s. Tocca per passare a %s'), [
                    STATUS_LABEL[idea.status],
                    STATUS_LABEL[NEXT_STATUS[idea.status]],
                  ])}
                  onClick={() => save.mutate({ id: idea.id, status: NEXT_STATUS[idea.status] })}
                >
                  <Icon name={STATUS_ICON[idea.status]} size={16} />
                  {STATUS_LABEL[idea.status]}
                </button>
                <WhereToBuy item={idea} />
              </div>
            </div>
            <div className="flex shrink-0 flex-col" onClick={(e) => e.stopPropagation()}>
              {/* Sempre visibile: senza link spiega che serve e apre il form. */}
              <IconButton
                icon={idea.watching ? 'notifications_active' : 'notifications'}
                label={
                  idea.watching
                    ? gettext('Togli la campanella')
                    : gettext('Avvisami se il prezzo scende')
                }
                disabled={watch.isPending}
                className={clsx(idea.watching && 'text-primary')}
                onClick={async () => {
                  if (idea.url || idea.watching) {
                    watch.mutate({ id: idea.id, watch: !idea.watching })
                  } else if (await askForLink()) {
                    onEdit(idea)
                  }
                }}
              />
              <IconButton
                icon="delete"
                label={gettext('Elimina idea')}
                onClick={async () => {
                  const ok = await confirm({
                    title: gettext("Eliminare l'idea?"),
                    message: interpolate(gettext('«%s» per %s.'), [idea.title, idea.recipient]),
                    confirmLabel: gettext('Elimina'),
                    destructive: true,
                  })
                  if (ok) remove.mutate(idea.id)
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function IdeaFormModal({
  idea,
  recipient: initialRecipient,
  recipients,
  onClose,
}: {
  idea?: GiftIdea
  recipient: string
  recipients: string[]
  onClose: () => void
}) {
  const save = useSaveIdea()
  const [recipient, setRecipient] = useState(idea?.recipient ?? initialRecipient)
  const [title, setTitle] = useState(idea?.title ?? '')
  const [occasion, setOccasion] = useState(idea?.occasion ?? '')
  const [price, setPrice] = useState(priceInput(idea?.price ?? null))
  const [url, setUrl] = useState(idea?.url ?? '')
  const [notes, setNotes] = useState(idea?.notes ?? '')
  const [gtin, setGtin] = useState(idea?.gtin ?? '')
  const [brand, setBrand] = useState(idea?.brand ?? '')
  const [image, setImage] = useState<ImageChoice>(undefined)
  // Nome, prezzo e note dal link del negozio, solo nei campi ancora liberi.
  const fill = useLinkFill(
    { title, price, notes, gtin, brand },
    { title: setTitle, price: setPrice, notes: setNotes, gtin: setGtin, brand: setBrand },
  )
  const [status, setStatus] = useState<IdeaStatus>(idea?.status ?? 'idea')
  const fields = save.error instanceof ApiError ? save.error.fieldErrors() : {}
  const priceInvalid = price.trim() !== '' && parsePrice(price) === null

  return (
    <Modal open onClose={onClose} title={idea ? gettext('Modifica idea') : gettext('Nuova idea')}>
      <form
        className="grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          if (priceInvalid) return
          const saved = await save
            .mutateAsync({
              id: idea?.id,
              recipient: recipient.trim(),
              title: title.trim(),
              occasion: occasion.trim(),
              price: parsePrice(price),
              url: url.trim(),
              notes: notes.trim(),
              gtin,
              brand,
              status,
              ...(image !== undefined && { image_id: image.id }),
            })
            .catch(() => null)
          if (saved) onClose()
        }}
      >
        {!fields.recipient && !fields.title && !fields.url && <ErrorBanner error={save.error} />}
        <Field label={gettext('Per chi')} error={fields.recipient}>
          <input
            className="field-input"
            list="idea-recipients"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder={gettext('Mamma, Luca, la collega…')}
            required
            autoFocus={!idea && !initialRecipient}
            maxLength={80}
          />
          <datalist id="idea-recipients">
            {recipients.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Field>
        <Field label={gettext('Cosa')} error={fields.title} hint={fill.hint('title')}>
          <input
            className="field-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            autoFocus={!idea && Boolean(initialRecipient)}
            maxLength={160}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={gettext('Occasione (facoltativa)')}>
            <input
              className="field-input"
              value={occasion}
              onChange={(event) => setOccasion(event.target.value)}
              placeholder={gettext('Natale, compleanno…')}
              maxLength={80}
            />
          </Field>
          <Field
            label={gettext('Prezzo (facoltativo)')}
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
        </div>
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
        <ImagePicker
          current={idea?.image ?? null}
          choice={image}
          onChoice={setImage}
          link={url}
          fill={fill}
        />
        <Field label={gettext('Note')} hint={fill.hint('notes')}>
          <textarea
            className="field-input min-h-[64px] resize-y"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <Segmented
          value={status}
          onChange={setStatus}
          options={(['idea', 'bought', 'given'] as const).map((value) => ({
            value,
            label: STATUS_LABEL[value],
          }))}
          className="justify-self-start"
        />
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-text" onClick={onClose}>
            {gettext('Annulla')}
          </button>
          <button
            className="btn-filled"
            disabled={save.isPending || !title.trim() || !recipient.trim() || priceInvalid}
          >
            {save.isPending ? gettext('Salvo…') : gettext('Salva')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
