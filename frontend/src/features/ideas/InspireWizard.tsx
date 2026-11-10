import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { useState } from 'react'

import { useSaveIdea, useSuggestGifts } from '../../api/hooks'
import { WhereToBuy } from '../../components/gift'
import { AiSkeleton, AiThinking, INSPIRE_LINES } from '../../components/motion'
import { Chip, ErrorBanner, Field, Icon, Modal } from '../../components/ui'
import { formatPrice } from '../../lib/format'
import { gettext, interpolate } from '../../lib/i18n'
import type { GiftSuggestion, SuggestPayload } from '../../lib/types'

type Answers = Omit<SuggestPayload, 'exclude'>

const EMPTY: Answers = {
  recipient: '',
  relation: '',
  age: '',
  interests: [],
  avoid: '',
  occasion: '',
  budget_min: '',
  budget_max: '',
}

const RELATIONS = () => [
  gettext('Partner'),
  gettext('Mamma'),
  gettext('Papà'),
  gettext('Figlio/a'),
  gettext('Fratello/sorella'),
  gettext('Amico/a'),
  gettext('Collega'),
  gettext('Nonno/a'),
]

const AGES = () => [
  { value: '', label: gettext('Non importa') },
  { value: '0-5', label: gettext('0–5 anni') },
  { value: '6-12', label: gettext('6–12 anni') },
  { value: '13-17', label: gettext('13–17 anni') },
  { value: '18-30', label: gettext('18–30 anni') },
  { value: '30-50', label: gettext('30–50 anni') },
  { value: '50-70', label: gettext('50–70 anni') },
  { value: '70+', label: gettext('Più di 70') },
]

const INTERESTS = () => [
  gettext('Cucina'),
  gettext('Libri'),
  gettext('Viaggi'),
  gettext('Sport'),
  gettext('Tecnologia'),
  gettext('Musica'),
  gettext('Giardino'),
  gettext('Casa'),
  gettext('Moda'),
  gettext('Giochi'),
  gettext('Arte'),
  gettext('Benessere'),
  gettext('Natura'),
  gettext('Cinema e serie'),
]

const STORAGE_PREFIX = 'regalino.inspire.'

/** Le risposte date l'ultima volta per questa persona: solo su questo dispositivo. */
function rememberedAnswers(recipient: string): Answers | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + recipient.trim().toLowerCase())
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Answers>) } : null
  } catch {
    return null
  }
}

function rememberAnswers(answers: Answers) {
  if (!answers.recipient.trim()) return
  try {
    localStorage.setItem(
      STORAGE_PREFIX + answers.recipient.trim().toLowerCase(),
      JSON.stringify(answers),
    )
  } catch {
    // Storage pieno o bloccato: si rispondera' di nuovo la prossima volta.
  }
}

/**
 * "Ispirami": tre passi (per chi, gusti e budget, idee) e Gemini propone.
 * Le risposte restano sul dispositivo, per persona: la volta dopo sono gia' li'.
 */
export function InspireWizard({
  recipient: initialRecipient,
  recipients,
  onClose,
}: {
  recipient: string
  recipients: string[]
  onClose: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [answers, setAnswers] = useState<Answers>(
    () => rememberedAnswers(initialRecipient) ?? { ...EMPTY, recipient: initialRecipient },
  )
  const [otherInterest, setOtherInterest] = useState('')
  const [shown, setShown] = useState<GiftSuggestion[]>([])
  const suggest = useSuggestGifts()
  const set = <K extends keyof Answers>(key: K, value: Answers[K]) =>
    setAnswers((current) => ({ ...current, [key]: value }))
  const toggleInterest = (interest: string) =>
    set(
      'interests',
      answers.interests.includes(interest)
        ? answers.interests.filter((item) => item !== interest)
        : [...answers.interests, interest],
    )

  const ask = async (more: boolean) => {
    const interests = otherInterest.trim()
      ? [...answers.interests, otherInterest.trim()]
      : answers.interests
    rememberAnswers({ ...answers, interests })
    setStep(3)
    const ideas = await suggest
      .mutateAsync({ ...answers, interests, exclude: more ? shown.map((s) => s.title) : [] })
      .catch(() => null)
    if (ideas) setShown(more ? [...shown, ...ideas] : ideas)
  }

  const titles = [gettext('Per chi?'), gettext('Gusti e budget'), gettext('Idee')]

  return (
    <Modal open onClose={onClose} title={interpolate(gettext('Ispirami · %s'), [titles[step - 1]])}>
      {step === 1 && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setStep(2)
          }}
        >
          <Field label={gettext('Per chi')}>
            <input
              className="field-input"
              list="inspire-recipients"
              value={answers.recipient}
              onChange={(event) => {
                const recipient = event.target.value
                // Cambiando persona si ritrovano le risposte date per lei.
                setAnswers(rememberedAnswers(recipient) ?? { ...answers, recipient })
              }}
              placeholder={gettext('Mamma, Luca, la collega…')}
              autoFocus={!initialRecipient}
              maxLength={80}
            />
            <datalist id="inspire-recipients">
              {recipients.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <div className="grid gap-2">
            <p className="px-1 text-label-small text-on-surface-variant">
              {gettext('Chi è per te')}
            </p>
            <div className="flex flex-wrap gap-2">
              {RELATIONS().map((relation) => (
                <Chip
                  key={relation}
                  label={relation}
                  selected={answers.relation === relation}
                  onClick={() => set('relation', answers.relation === relation ? '' : relation)}
                />
              ))}
            </div>
            <input
              className="field-input rounded-row bg-surface-container px-4 py-3"
              value={RELATIONS().includes(answers.relation) ? '' : answers.relation}
              onChange={(event) => set('relation', event.target.value)}
              placeholder={gettext('Oppure scrivilo: la vicina, il mio capo…')}
              maxLength={80}
            />
          </div>
          <Field label={gettext('Età')}>
            <select
              className="field-input"
              value={answers.age}
              onChange={(event) => set('age', event.target.value)}
            >
              {AGES().map((age) => (
                <option key={age.value} value={age.value}>
                  {age.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn-text" onClick={onClose}>
              {gettext('Annulla')}
            </button>
            <button className="btn-filled">
              {gettext('Avanti')}
              <Icon name="arrow_forward" size={20} />
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void ask(false)
          }}
        >
          <div className="grid gap-2">
            <p className="px-1 text-label-small text-on-surface-variant">
              {gettext('Cosa le/gli piace')}
            </p>
            <div className="flex flex-wrap gap-2">
              {INTERESTS().map((interest) => (
                <Chip
                  key={interest}
                  label={interest}
                  selected={answers.interests.includes(interest)}
                  onClick={() => toggleInterest(interest)}
                />
              ))}
            </div>
            <input
              className="field-input rounded-row bg-surface-container px-4 py-3"
              value={otherInterest}
              onChange={(event) => setOtherInterest(event.target.value)}
              placeholder={gettext('Altro: pesca, fumetti, cani…')}
              maxLength={60}
            />
          </div>
          <Field label={gettext('Da evitare (facoltativo)')}>
            <input
              className="field-input"
              value={answers.avoid}
              onChange={(event) => set('avoid', event.target.value)}
              placeholder={gettext('Profumi, cose da cucina, già ha tutto per…')}
              maxLength={300}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={gettext('Occasione')}>
              <input
                className="field-input"
                value={answers.occasion}
                onChange={(event) => set('occasion', event.target.value)}
                placeholder={gettext('Natale, compleanno…')}
                maxLength={80}
              />
            </Field>
            <Field label={gettext('Budget da (€)')}>
              <input
                className="field-input amount"
                inputMode="decimal"
                value={answers.budget_min}
                onChange={(event) => set('budget_min', event.target.value)}
                placeholder="0"
                maxLength={12}
              />
            </Field>
            <Field label={gettext('Budget fino a (€)')}>
              <input
                className="field-input amount"
                inputMode="decimal"
                value={answers.budget_max}
                onChange={(event) => set('budget_max', event.target.value)}
                placeholder="50"
                maxLength={12}
              />
            </Field>
          </div>
          <div className="mt-2 flex justify-between gap-2">
            <button type="button" className="btn-text -ml-3" onClick={() => setStep(1)}>
              <Icon name="arrow_back" size={20} />
              {gettext('Indietro')}
            </button>
            <button className="btn-filled group">
              <Icon
                name="auto_awesome"
                size={20}
                className="transition-transform duration-300 ease-m3 group-hover:rotate-12 group-hover:scale-110"
              />
              {gettext('Trova idee')}
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="grid gap-3">
          <p className="text-body-small text-on-surface-variant">
            {gettext('Idee scritte da un’AI partendo da quello che hai detto: scegli tu.')}
          </p>
          <ErrorBanner error={suggest.error} />
          {shown.map((idea, index) => (
            <SuggestionRow
              key={idea.title}
              idea={idea}
              recipient={answers.recipient}
              occasion={answers.occasion}
              order={index % SUGGESTIONS_PER_ROUND}
            />
          ))}
          {suggest.isPending && (
            <SuggestionsLoading lines={INSPIRE_LINES()} more={shown.length > 0} />
          )}
          <div className="mt-2 flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-text -ml-3" onClick={() => setStep(2)}>
              <Icon name="arrow_back" size={20} />
              {gettext('Cambia risposte')}
            </button>
            <button
              type="button"
              className="btn-tonal"
              disabled={suggest.isPending}
              onClick={() => void ask(shown.length > 0)}
            >
              <Icon
                name="auto_awesome"
                size={20}
                className={clsx(suggest.isPending && 'ai-spark')}
              />
              {gettext('Altre idee')}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Quante idee arrivano a ogni giro: le nuove entrano in fila, dalla prima. */
const SUGGESTIONS_PER_ROUND = 8

/**
 * Mentre Gemini pensa: la prima volta il pacco grande che salta (e' l'unica
 * cosa nel dialog), per "Altre idee" la riga piccola sotto quelle gia' arrivate.
 */
export function SuggestionsLoading({ lines, more }: { lines: string[]; more: boolean }) {
  return (
    <div className="grid gap-2">
      <AiThinking lines={lines} compact={more} />
      <AiSkeleton rows={2} />
    </div>
  )
}

/** Un'idea proposta: si aggiunge a "Da regalare" con un tocco, o si cerca nei negozi. */
export function SuggestionRow({
  idea,
  recipient,
  occasion,
  order = 0,
}: {
  idea: GiftSuggestion
  /** Senza (alternative sul link condiviso) non si puo' aggiungere. */
  recipient?: string
  occasion?: string
  /** Posizione nel giro di idee appena arrivato: entrano una dopo l'altra. */
  order?: number
}) {
  const save = useSaveIdea()
  const [added, setAdded] = useState(false)
  const price = idea.price.replace(',', '.')
  const priceOk = price !== '' && Number.isFinite(Number(price))

  return (
    <div
      className="rise grid gap-2 rounded-row bg-surface-container-low px-4 py-3"
      style={{ '--i': order } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body-large font-medium">{idea.title}</p>
          {idea.why && <p className="text-body-small text-on-surface-variant">{idea.why}</p>}
        </div>
        {priceOk && (
          <span className="amount shrink-0 text-body-medium font-medium">
            {interpolate(gettext('~%s'), [formatPrice(Number(price).toFixed(2))])}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {recipient !== undefined && (
          <button
            type="button"
            className={clsx('btn-sm', added ? 'btn-text' : 'btn-tonal')}
            disabled={save.isPending || added}
            onClick={async () => {
              const saved = await save
                .mutateAsync({
                  recipient: recipient.trim() || gettext('Qualcuno'),
                  title: idea.title,
                  notes: idea.why,
                  occasion: occasion ?? '',
                  price: priceOk ? Number(price).toFixed(2) : null,
                  url: '',
                  gtin: '',
                  brand: '',
                  status: 'idea',
                })
                .catch(() => null)
              if (saved) setAdded(true)
            }}
          >
            <Icon
              key={added ? 'added' : 'add'}
              name={added ? 'check' : 'add'}
              size={18}
              className={clsx(added && 'pop')}
            />
            {added ? gettext('Aggiunta') : gettext('Aggiungi a Da regalare')}
          </button>
        )}
        <WhereToBuy item={{ title: idea.query || idea.title, url: '', gtin: '', brand: '' }} />
      </div>
      <ErrorBanner error={save.error} />
    </div>
  )
}
