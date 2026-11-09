// Pezzi condivisi da lista del proprietario, lista condivisa e "Da regalare":
// prezzo, link al negozio, data dell'evento, foto.

import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useDescribeLink, useImageFromUrl, useReadLink, useUploadImage } from '../api/hooks'
import { ApiError, mediaUrl } from '../lib/api'
import { daysUntil, formatDate, formatPrice, hostOf, priceInput } from '../lib/format'
import { gettext, interpolate, intlLocale, ngettext } from '../lib/i18n'
import type { LinkDescription, Money, PricePoint, UUID } from '../lib/types'
import { useConfirm } from './ConfirmDialog'
import { Field, Icon, IconButton, Modal } from './ui'

/** Il totale di un regalo: prezzo del pezzo per quanti ne servono, come Decimal in stringa. */
export function lineTotal(price: Money | null, quantity: number): Money | null {
  if (!price) return null
  return (Number(price) * Math.max(1, quantity)).toFixed(2)
}

/**
 * Prezzo e link del regalo, sotto il titolo di una riga. Se ne servono piu' di
 * uno il prezzo mostrato e' il totale, con accanto "3 × 18,90 €".
 */
export function GiftMeta({
  price,
  url,
  quantity = 1,
}: {
  price: Money | null
  url: string
  quantity?: number
}) {
  const many = quantity > 1
  if (!price && !url && !many) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small">
      {price && (
        <span className="amount text-body-medium font-medium text-on-surface">
          {formatPrice(lineTotal(price, quantity))}
        </span>
      )}
      {many && (
        <span className="amount rounded-pill bg-secondary-container px-2 py-0.5 text-label-small text-on-secondary-container">
          {price
            ? interpolate(gettext('%s × %s'), [String(quantity), formatPrice(price)])
            : interpolate(gettext('× %s'), [String(quantity)])}
        </span>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="open_in_new" size={16} />
          <span className="truncate">{hostOf(url)}</span>
        </a>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- foto -- */

/**
 * Abbinamenti carta/nastro di `.wrap`, scritti per intero perche' Tailwind
 * tenga solo le classi che trova letterali nei sorgenti.
 */
const WRAPS = ['wrap-1', 'wrap-2', 'wrap-3', 'wrap-4'] as const

/** Lo stesso id da' sempre lo stesso pacco: la lista non cambia colori a ogni giro. */
export function wrapClass(seed: string): string {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return WRAPS[Math.abs(hash) % WRAPS.length]
}

/** Il pacco disegnato al posto della foto che manca: carta, nastro a croce e fiocco. */
export function GiftWrap({
  seed,
  ribbon = 14,
  x = 50,
  y = 50,
  bow = true,
  className,
}: {
  seed: string
  /** Spessore del nastro in px. */
  ribbon?: number
  /** Dove si incrociano i nastri, in % della larghezza e dell'altezza. */
  x?: number
  y?: number
  bow?: boolean
  className?: string
}) {
  const style = { '--ribbon': `${ribbon}px`, '--x': `${x}%`, '--y': `${y}%` } as CSSProperties
  return (
    <span
      aria-hidden
      className={clsx('wrap relative block', wrapClass(seed), className)}
      style={style}
    >
      {bow && (
        <svg className="wrap-bow" viewBox="13.5 7.5 21 7">
          <path d="M24 14c-2.5-4.5-8.5-6.5-9.8-3.3C13.2 13.2 17 14 24 14zm0 0c2.5-4.5 8.5-6.5 9.8-3.3C34.8 13.2 31 14 24 14z" />
        </svg>
      )}
    </span>
  )
}

/** "Tra 39 giorni", "Domani", "Oggi": quanto manca, per chip e testate. */
export function countdownLabel(isoDate: string): string {
  const days = daysUntil(isoDate)
  if (days === 0) return gettext('Oggi')
  if (days === 1) return gettext('Domani')
  if (days < 0) return gettext('Passata')
  return interpolate(ngettext('Tra %s giorno', 'Tra %s giorni', days), [days])
}

/** Il cartellino con i giorni che mancano, appeso alla testata (da tablet in su). */
function CountdownTag({ isoDate }: { isoDate: string }) {
  const days = daysUntil(isoDate)
  return (
    <div className="hidden min-w-[104px] shrink-0 flex-col items-center self-end rounded-card bg-surface px-5 py-3 text-on-surface shadow-fab sm:flex">
      {days > 1 ? (
        <>
          <span className="text-label-small text-on-surface-variant">
            {ngettext('Manca', 'Mancano', days)}
          </span>
          <span className="amount text-[40px] font-semibold leading-[48px]">{days}</span>
          <span className="text-label-small text-on-surface-variant">
            {ngettext('giorno', 'giorni', days)}
          </span>
        </>
      ) : (
        <>
          <Icon
            name={days < 0 ? 'event_available' : 'celebration'}
            size={32}
            className="text-primary"
          />
          <span className="mt-1 text-body-large font-semibold">{countdownLabel(isoDate)}</span>
        </>
      )}
    </div>
  )
}

/**
 * Testata di una lista, uguale per chi la scrive e per chi la apre: un pacco
 * con il nastro, il nome grande e il cartellino dei giorni che mancano.
 */
export function ListHero({
  eyebrow,
  title,
  eventDate,
  description,
  children,
}: {
  eyebrow?: string
  title: string
  eventDate: string | null
  description?: string
  /** Azioni sotto il testo (condividi, modifica). */
  children?: ReactNode
}) {
  return (
    <section className="relative overflow-hidden rounded-panel bg-primary-container text-on-primary-container">
      {/* Il nastro verticale del pacco: decorazione, sotto al cartellino. */}
      <span
        aria-hidden
        className="absolute inset-y-0 right-8 w-5 sm:right-[60px] sm:w-7"
        style={{ background: 'var(--primary)', opacity: 0.14 }}
      />
      <div className="relative flex items-end gap-5 p-6 pr-14 sm:p-8">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="flex items-center gap-2 text-body-medium font-medium">
              <Icon name="featured_seasonal_and_gifts" size={20} />
              {eyebrow}
            </p>
          )}
          <h1 className="mt-2 break-words text-[32px] font-semibold leading-10 sm:text-headline-medium">
            {title}
          </h1>
          {eventDate && (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-body-large">
              <Icon name="event" size={20} />
              {formatDate(eventDate)}
              {/* Sul telefono il cartellino non ci sta: quanto manca va accanto alla data. */}
              <span className="ml-1 rounded-pill bg-surface px-3 py-0.5 text-body-medium font-medium text-on-surface sm:hidden">
                {countdownLabel(eventDate)}
              </span>
            </p>
          )}
          {description && (
            <p className="mt-4 max-w-2xl whitespace-pre-line text-body-large">{description}</p>
          )}
          {children && <div className="mt-5 flex flex-wrap gap-2">{children}</div>}
        </div>
        {eventDate && <CountdownTag isoDate={eventDate} />}
      </div>
    </section>
  )
}

/**
 * Card di un regalo, come nelle liste nozze: foto (o pacco) in alto, titolo,
 * prezzo e negozio, e in fondo l'azione di chi guarda.
 */
export function GiftCard({
  seed,
  image,
  title,
  price,
  url,
  quantity,
  notes,
  badge,
  taken,
  onClick,
  onImage,
  detail,
  trend,
  corner,
  footer,
}: {
  /** L'id del regalo: sceglie la carta del pacco se manca la foto. */
  seed: string
  image: string | null
  title: string
  price: Money | null
  url: string
  /** Quanti ne servono: sopra 1 il prezzo diventa il totale e compare "3 × …". */
  quantity?: number
  notes?: string
  /** Etichetta sopra la foto (es. "Preso"). */
  badge?: ReactNode
  /** Gia' preso: foto spenta e titolo attenuato. */
  taken?: boolean
  /** Tocco sulla card (il proprietario la modifica). */
  onClick?: () => void
  /** Tocco sulla foto (chi ha il link la vede grande). */
  onImage?: () => void
  /** Una riga sotto prezzo e negozio (es. "Va con «Cuffie»"). */
  detail?: ReactNode
  /** L'andamento del prezzo, sotto il resto. */
  trend?: ReactNode
  /** In alto a destra sulla foto (la campanella). */
  corner?: ReactNode
  footer?: ReactNode
}) {
  const media = (
    <span className="relative block aspect-[4/3] w-full overflow-hidden bg-surface-container">
      {image ? (
        <img
          src={mediaUrl(image)}
          alt=""
          loading="lazy"
          className={clsx('h-full w-full object-cover', taken && 'opacity-50 grayscale')}
        />
      ) : (
        <GiftWrap
          seed={seed}
          ribbon={16}
          className={clsx('h-full w-full', taken && 'opacity-50')}
        />
      )}
      {badge && <span className="absolute left-2 top-2 max-w-[calc(100%-16px)]">{badge}</span>}
      {corner && <span className="absolute right-2 top-2">{corner}</span>}
    </span>
  )
  return (
    <article
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter') onClick()
            }
          : undefined
      }
      className={clsx(
        'card-elevated flex flex-col overflow-hidden',
        onClick && 'state cursor-pointer',
      )}
    >
      {onImage && image ? (
        <button
          type="button"
          className="state block"
          aria-label={gettext('Vedi la foto')}
          onClick={(event) => {
            event.stopPropagation()
            onImage()
          }}
        >
          {media}
        </button>
      ) : (
        media
      )}
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p
          className={clsx(
            'line-clamp-2 break-words text-body-large font-medium',
            taken && 'text-on-surface-variant',
          )}
        >
          {title}
        </p>
        <GiftMeta price={price} url={url} quantity={quantity} />
        {detail && (
          <p className="mt-1 flex items-center gap-1 text-body-small text-on-surface-variant">
            <Icon name="link" size={16} />
            <span className="truncate">{detail}</span>
          </p>
        )}
        {notes && (
          <p className="mt-1 line-clamp-3 whitespace-pre-line text-body-small text-on-surface-variant">
            {notes}
          </p>
        )}
        {trend}
        {footer && <div className="mt-auto pt-3">{footer}</div>}
      </div>
    </article>
  )
}

/** Etichetta tonda sopra la foto: verde per "preso", neutra per il resto. */
export function GiftBadge({
  icon,
  tone = 'success',
  children,
}: {
  icon: string
  tone?: 'success' | 'neutral'
  children: ReactNode
}) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center gap-1 rounded-pill py-1 pl-2 pr-3 text-label-small shadow-fab',
        tone === 'success'
          ? 'bg-success-container text-on-success-container'
          : 'bg-surface text-on-surface',
      )}
    >
      <Icon name={icon} size={16} filled />
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Il riquadro tratteggiato in fondo alla griglia: aggiunge un altro regalo o lista. */
export function AddTile({
  label,
  onClick,
  className,
}: {
  label: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'state flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-outline-variant p-4 text-body-medium font-medium text-on-surface-variant',
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-pill bg-primary-container text-on-primary-container">
        <Icon name="add" size={26} />
      </span>
      {label}
    </button>
  )
}

/**
 * Miniatura del regalo: la foto se c'e', altrimenti il pacco. Con `onOpen` la
 * foto si tocca per vederla grande.
 */
export function GiftThumb({
  image,
  seed,
  done,
  size = 56,
  onOpen,
}: {
  image: string | null
  /** L'id del regalo, per la carta del pacco quando manca la foto. */
  seed: string
  /** Regalato: spunta sopra la foto o sopra il pacco. */
  done?: boolean
  size?: number
  onOpen?: () => void
}) {
  const box = { width: size, height: size }
  const check = done && (
    <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-pill bg-success text-white">
      <Icon name="check" size={16} />
    </span>
  )
  if (!image) {
    return (
      <span className="relative block shrink-0 overflow-hidden rounded-nested" style={box}>
        <GiftWrap
          seed={seed}
          ribbon={Math.max(5, Math.round(size / 9))}
          className={clsx('h-full w-full', done && 'opacity-60')}
        />
        {check}
      </span>
    )
  }
  const picture = (
    <span
      className="relative block shrink-0 overflow-hidden rounded-nested bg-surface-container"
      style={box}
    >
      <img
        src={mediaUrl(image)}
        alt=""
        loading="lazy"
        className={clsx('h-full w-full object-cover', done && 'opacity-60')}
      />
      {check}
    </span>
  )
  if (!onOpen) return picture
  return (
    <button
      type="button"
      className="state shrink-0 rounded-nested"
      aria-label={gettext('Vedi la foto')}
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
    >
      {picture}
    </button>
  )
}

/** La foto a tutto schermo (bottom sheet su mobile, dialog su desktop). */
export function ImageViewer({
  image,
  title,
  onClose,
}: {
  image: string
  title: string
  onClose: () => void
}) {
  return (
    <Modal open onClose={onClose} title={title} wide>
      <img
        src={mediaUrl(image)}
        alt={title}
        className="max-h-[70vh] w-full rounded-card bg-surface-container object-contain"
      />
    </Modal>
  )
}

/** Cosa il form manda come `image_id`: assente se la foto non e' cambiata. */
export type ImageChoice = { id: UUID | null; url: string | null } | undefined

/** Un link che vale la pena far leggere al server: http(s) con un dominio vero. */
function readableLink(raw: string): string | null {
  const text = raw.trim()
  try {
    const url = new URL(text)
    const web = url.protocol === 'http:' || url.protocol === 'https:'
    return web && url.hostname.includes('.') ? text : null
  } catch {
    return null
  }
}

/** Quanto aspettare dopo l'ultimo tasto prima di leggere il link da soli. */
const AUTO_DELAY_MS = 700

/**
 * I campi del form che il link del negozio puo' compilare. Codice a barre e
 * marca non si vedono nel form: l'utente non li tocca mai, quindi sono sempre
 * "liberi" e seguono il link (cambiano o spariscono con lui).
 */
export type LinkFields = {
  title: string
  price: string
  notes: string
  gtin: string
  brand: string
}
const LINK_FIELDS = ['title', 'price', 'notes', 'gtin', 'brand'] as const

/** Cosa serve a `ImagePicker` per compilare il form dal link. */
export type LinkFill = ReturnType<typeof useLinkFill>

/**
 * Compila dal link i campi del form ancora liberi: vuoti, o con quello che ci
 * aveva messo il link di prima (se il link cambia, cambiano anche loro).
 * Quello che l'utente ha scritto non si tocca mai.
 */
export function useLinkFill(
  values: LinkFields,
  set: { [K in keyof LinkFields]: (value: string) => void },
) {
  const auto = useRef<Partial<LinkFields>>({})
  // Si legge quando arriva la risposta, magari secondi dopo: servono i valori di allora.
  const now = useRef(values)
  now.current = values
  const [, rerender] = useState(0)
  const isFree = (key: keyof LinkFields) =>
    !now.current[key].trim() || now.current[key] === auto.current[key]

  return {
    /** Almeno un campo e' libero: vale la pena leggere il link anche senza foto da prendere. */
    wanted: LINK_FIELDS.some(isFree),
    apply(details: LinkDescription) {
      const proposed: LinkFields = {
        title: details.title,
        price: priceInput(details.price),
        notes: details.notes,
        gtin: details.gtin,
        brand: details.brand,
      }
      const next: Partial<LinkFields> = {}
      for (const key of LINK_FIELDS) {
        if (!isFree(key)) continue
        set[key](proposed[key])
        if (proposed[key]) next[key] = proposed[key]
      }
      auto.current = next
      rerender((n) => n + 1)
    },
    /** Testo di supporto per un campo compilato dal link e non ancora toccato. */
    hint(key: keyof LinkFields): string | undefined {
      const value = auto.current[key]
      return value && values[key] === value ? gettext('Dal link del negozio') : undefined
    },
  }
}

/**
 * Foto del regalo nel form: carica dal dispositivo o prendila dal link del
 * negozio. La foto si carica subito (cosi' c'e' l'anteprima) e si collega al
 * regalo solo quando si salva; quelle abbandonate le pulisce il server.
 *
 * Di default, quando nel form si scrive o incolla un link, legge la pagina e
 * prende da sola la foto (se non c'e') e, con `fill`, nome, prezzo e note per i
 * campi ancora liberi: prima quelli che la pagina dichiara, poi (se c'e')
 * quelli di Gemini, che a volte ci mette decine di secondi. Non lo fa col link gia' salvato (aprire un regalo per
 * correggerlo non deve partire a leggere siti); la foto non la cambia dopo che
 * se n'e' scelta o tolta una a mano. Se il link cambia, cambia anche quello
 * che il link aveva messo.
 */
export function ImagePicker({
  current,
  choice,
  onChoice,
  link,
  fill,
}: {
  /** Foto gia' salvata sul regalo. */
  current: string | null
  choice: ImageChoice
  onChoice: (choice: ImageChoice) => void
  /** Il link del form: se c'e', "Dal link" usa quello. */
  link: string
  /** I campi del form da compilare col link (`useLinkFill`). */
  fill?: LinkFill
}) {
  const upload = useUploadImage()
  const fromUrl = useImageFromUrl()
  const readLink = useReadLink()
  const describeLink = useDescribeLink()
  const input = useRef<HTMLInputElement>(null)
  const [askUrl, setAskUrl] = useState(false)
  const [otherUrl, setOtherUrl] = useState('')
  // Il link da cui viene la foto presa da sola (null: nessuna, o scelta a mano).
  const [autoFrom, setAutoFrom] = useState<string | null>(null)
  const initialLink = useRef(link.trim())
  const tried = useRef<string | null>(null)
  // Ogni scelta incrementa il biglietto: una risposta arrivata dopo una scelta
  // piu' recente (es. una lettura lenta del link e intanto una foto caricata) si scarta.
  const latest = useRef(0)
  const shown = choice === undefined ? current : choice.url
  // Il link si e' letto ma la foto no: lo si dice, il resto del form e' compilato.
  const [imageNote, setImageNote] = useState<string | null>(null)
  const busy = upload.isPending || fromUrl.isPending || readLink.isPending
  const error = upload.error ?? fromUrl.error ?? readLink.error
  const errorText =
    error instanceof ApiError
      ? (error.fieldErrors().file ?? error.fieldErrors().url ?? error.message)
      : error
        ? String(error)
        : imageNote

  const resetAll = () => {
    upload.reset()
    fromUrl.reset()
    readLink.reset()
    setImageNote(null)
  }

  const takeFrom = async (url: string) => {
    resetAll()
    const ticket = ++latest.current
    const image = await fromUrl.mutateAsync(url).catch(() => null)
    if (ticket !== latest.current || !image) return
    onChoice({ id: image.id, url: image.url })
    setAutoFrom(null)
    setAskUrl(false)
    setOtherUrl('')
  }

  // La foto si prende da sola se non ce n'e', o se c'e' quella presa da sola.
  const canAutoImage = choice === undefined ? !current : autoFrom !== null
  const readFrom = async (url: string) => {
    resetAll()
    const withImage = canAutoImage
    const ticket = withImage ? ++latest.current : latest.current
    const details = await readLink.mutateAsync({ url, image: withImage }).catch(() => null)
    // Intanto il link e' cambiato: arrivera' la risposta di quello nuovo.
    if (url !== tried.current) return
    if (details) fill?.apply(details)
    if (details?.describe_id && fill) void describeFrom(url, details.describe_id)
    if (!withImage || ticket !== latest.current) return
    if (details?.image) {
      onChoice({ id: details.image.id, url: details.image.url })
      setAutoFrom(url)
    } else {
      setImageNote(details?.image_error ?? null)
      if (autoFrom !== null) {
        // La foto presa da sola era del link di prima: col link nuovo non vale piu'.
        setAutoFrom(null)
        onChoice(undefined)
      }
    }
  }
  // Gemini dopo: i campi che l'utente ha toccato nel frattempo restano suoi.
  const describeFrom = async (url: string, describeId: string) => {
    const description = await describeLink.mutateAsync(describeId).catch(() => null)
    if (description && url === tried.current) fill?.apply(description)
  }
  const readFromRef = useRef(readFrom)
  readFromRef.current = readFrom

  const target = readableLink(link)
  const autoTarget =
    target && target !== initialLink.current && (canAutoImage || fill?.wanted) ? target : null
  useEffect(() => {
    if (!autoTarget || autoTarget === tried.current) return
    const timer = window.setTimeout(() => {
      tried.current = autoTarget
      void readFromRef.current(autoTarget)
    }, AUTO_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [autoTarget])

  return (
    <div className="grid gap-3 rounded-row bg-surface-container-low p-3">
      <div className="flex items-center gap-3">
        {shown ? (
          <img
            src={mediaUrl(shown)}
            alt=""
            className="h-24 w-24 shrink-0 rounded-nested bg-surface-container object-cover"
          />
        ) : (
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-nested bg-surface-container text-on-surface-variant">
            <Icon name={busy ? 'hourglass_top' : 'image'} size={32} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <p className="text-body-medium font-medium">{gettext('Foto')}</p>
          {(fromUrl.isPending || readLink.isPending) && (
            <p className="text-body-small text-on-surface-variant">
              {fromUrl.isPending
                ? gettext('Prendo la foto dal link…')
                : gettext('Leggo la pagina del negozio…')}
            </p>
          )}
          {describeLink.isPending && !busy && (
            <p className="flex items-center gap-1 text-body-small text-on-surface-variant">
              <Icon name="auto_awesome" size={16} />
              {gettext('Miglioro nome e note…')}
            </p>
          )}
          {autoFrom && !busy && !describeLink.isPending && (
            <p className="text-body-small text-on-surface-variant">
              {gettext('Presa dal link del negozio.')}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="btn-tonal btn-sm"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              <Icon name="add_photo_alternate" size={18} />
              {gettext('Carica')}
            </button>
            <button
              type="button"
              className="btn-tonal btn-sm"
              disabled={busy}
              onClick={() => (link.trim() && !askUrl ? takeFrom(link.trim()) : setAskUrl(true))}
            >
              <Icon name="link" size={18} />
              {fromUrl.isPending ? gettext('Cerco…') : gettext('Dal link')}
            </button>
            {shown && (
              <button
                type="button"
                className="btn-text btn-sm"
                disabled={busy}
                onClick={() => {
                  latest.current += 1
                  setAutoFrom(null)
                  setImageNote(null)
                  onChoice({ id: null, url: null })
                }}
              >
                {gettext('Togli')}
              </button>
            )}
          </div>
          {link.trim() && !askUrl && (
            <button
              type="button"
              className="text-body-small text-primary underline-offset-2 hover:underline"
              onClick={() => setAskUrl(true)}
            >
              {gettext("Usa il link di un'altra immagine")}
            </button>
          )}
        </div>
      </div>
      {askUrl && (
        <div className="flex items-end gap-2">
          <Field label={gettext("Link dell'immagine o della pagina")} className="min-w-0 flex-1">
            <input
              className="field-input"
              type="url"
              inputMode="url"
              value={otherUrl}
              onChange={(event) => setOtherUrl(event.target.value)}
              onKeyDown={(event) => {
                // Invio qui non deve salvare il regalo: prende la foto.
                if (event.key !== 'Enter') return
                event.preventDefault()
                if (otherUrl.trim()) void takeFrom(otherUrl.trim())
              }}
              placeholder="https://"
              autoFocus
            />
          </Field>
          <button
            type="button"
            className="btn-filled btn-sm mb-2"
            disabled={busy || !otherUrl.trim()}
            onClick={() => takeFrom(otherUrl.trim())}
          >
            {gettext('Prendi')}
          </button>
        </div>
      )}
      {errorText && <p className="px-1 text-body-small text-error">{errorText}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          resetAll()
          const ticket = ++latest.current
          const image = await upload.mutateAsync(file).catch(() => null)
          if (image && ticket === latest.current) {
            setAutoFrom(null)
            onChoice({ id: image.id, url: image.url })
          }
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------ dove trovarlo -- */

/** Quello che serve per cercare un regalo in altri negozi. */
export type Findable = { title: string; url: string; gtin: string; brand: string }

/**
 * Link di ricerca nei negozi e nei comparatori, per codice a barre se c'e'
 * (trova esattamente quel prodotto) o per marca e nome. Nessuna API, nessuna
 * lettura di pagine: chi regala confronta da se' con un tocco.
 */
export function shopLinks(item: Findable): { name: string; url: string }[] {
  const query = encodeURIComponent(item.gtin || [item.brand, item.title].filter(Boolean).join(' '))
  return [
    { name: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${query}` },
    { name: 'Amazon', url: `https://www.amazon.it/s?k=${query}` },
    { name: 'eBay', url: `https://www.ebay.it/sch/i.html?_nkw=${query}` },
    { name: 'Trovaprezzi', url: `https://www.trovaprezzi.it/categoria.aspx?libera=${query}` },
  ]
}

/** Il bottone "Dove trovarlo" con il suo dialog. */
export function WhereToBuy({ item, className }: { item: Findable; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className={clsx('btn-text btn-sm', className)}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <Icon name="storefront" size={18} />
        {gettext('Dove trovarlo')}
      </button>
      {/* Nel body: dentro una riga con ``isolation: isolate`` il dialog resterebbe sotto le righe dopo. */}
      {open &&
        createPortal(<WhereToBuyModal item={item} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

export function WhereToBuyModal({ item, onClose }: { item: Findable; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={gettext('Dove trovarlo')}>
      <div className="grid gap-3" onClick={(event) => event.stopPropagation()}>
        <p className="text-body-large font-medium">{item.title}</p>
        {item.url && (
          <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="row-m3">
            <Icon name="link" size={22} className="text-on-surface-variant" />
            <span className="min-w-0 flex-1">
              <span className="block text-body-large">{hostOf(item.url)}</span>
              <span className="block text-body-small text-on-surface-variant">
                {gettext('Il negozio indicato nella lista')}
              </span>
            </span>
            <Icon name="open_in_new" size={20} className="text-on-surface-variant" />
          </a>
        )}
        <p className="mt-1 text-body-small text-on-surface-variant">
          {item.gtin
            ? interpolate(gettext('Cerca lo stesso prodotto altrove (codice %s):'), [item.gtin])
            : gettext('Cerca lo stesso prodotto altrove:')}
        </p>
        <div className="grid gap-1">
          {shopLinks(item).map((shop) => (
            <a
              key={shop.name}
              href={shop.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="row-m3"
            >
              <Icon name="storefront" size={22} className="text-on-surface-variant" />
              <span className="min-w-0 flex-1 text-body-large">{shop.name}</span>
              <Icon name="open_in_new" size={20} className="text-on-surface-variant" />
            </a>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------- prezzi e campanella -- */

/**
 * L'andamento del prezzo sulla card (ADR 0011): una linea e quanto e'
 * cambiato dal primo punto. Un tocco apre il grafico intero. Con un punto
 * solo resta il bottone "Andamento del prezzo": il grafico si riempie quando
 * il task notturno trova un prezzo diverso.
 */
export function PriceTrend({
  history,
  title,
  tracked,
}: {
  history: PricePoint[]
  /** Il nome del regalo, per il titolo del grafico. */
  title: string
  /** Ha un link da cui rileggere il prezzo. */
  tracked: boolean
}) {
  const [open, setOpen] = useState(false)
  if (history.length < 2 && !tracked) return null
  const values = history.map((point) => Number(point.price))
  const first = values[0] ?? 0
  const last = values[values.length - 1] ?? 0
  const change = history.length > 1 && first > 0 ? Math.round(((last - first) / first) * 100) : 0
  const tone =
    history.length < 2
      ? 'text-on-surface-variant'
      : change < 0
        ? 'text-success'
        : change > 0
          ? 'text-error'
          : 'text-on-surface-variant'
  return (
    <>
      <button
        type="button"
        className={clsx(
          'state -mx-1 mt-1 flex max-w-full items-center gap-2 rounded-nested px-1 py-0.5 text-left text-body-small',
          tone,
        )}
        aria-label={gettext('Vedi l’andamento del prezzo')}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {history.length > 1 ? <Sparkline values={values} /> : <Icon name="show_chart" size={18} />}
        <span className="truncate">
          {history.length < 2
            ? gettext('Andamento del prezzo')
            : change < 0
              ? interpolate(gettext('−%s da quando è in lista'), [`${Math.abs(change)}%`])
              : change > 0
                ? interpolate(gettext('+%s da quando è in lista'), [`${change}%`])
                : gettext('Prezzo stabile')}
        </span>
      </button>
      {/* Nel body: le righe e le card hanno ``isolation: isolate``. */}
      {open &&
        createPortal(
          <PriceChartModal history={history} title={title} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const width = 72
  const height = 20
  const min = Math.min(...values)
  const span = Math.max(...values) - min || 1
  const line = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1
      const y = height - 2 - ((value - min) / span) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Tacche "pulite" per l'asse dei prezzi: 1, 2, 2,5 o 5 per una potenza di dieci. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1)
    min -= pad
    max += pad
  }
  const raw = (max - min) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((n) => n * power >= raw) ?? 10) * power
  const ticks: number[] = []
  for (let tick = Math.floor(min / step) * step; tick <= max + step * 0.001; tick += step) {
    ticks.push(Math.round(tick * 100) / 100)
  }
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' }).format(
    new Date(iso),
  )
}

/**
 * Il grafico dell'andamento: prezzo nel tempo come linea a gradini (un prezzo
 * vale finche' non ne arriva un altro), fino a oggi. Crosshair che si aggancia
 * al punto piu' vicino, con data e prezzo; sotto, attuale/minimo/massimo e
 * l'elenco di tutti i prezzi visti.
 */
export function PriceChartModal({
  history,
  title,
  onClose,
}: {
  history: PricePoint[]
  title: string
  onClose: () => void
}) {
  const [active, setActive] = useState<number | null>(null)
  // La larghezza vera del grafico: un'unita' del viewBox e' un pixel, cosi'
  // testi e margini restano leggibili anche sul telefono.
  const frame = useRef<HTMLDivElement>(null)
  const [frameWidth, setFrameWidth] = useState(560)
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const points = history.map((point) => ({
    at: new Date(point.at).getTime(),
    price: Number(point.price),
  }))
  const prices = points.map((point) => point.price)
  const current = prices[prices.length - 1]
  const first = prices[0]
  const lowest = prices.length ? Math.min(...prices) : 0
  const highest = prices.length ? Math.max(...prices) : 0

  // Geometria in unita' del viewBox: l'SVG si allarga con il dialog.
  const W = Math.max(280, Math.round(frameWidth))
  const H = W < 420 ? 200 : 240
  const pad = { top: 16, right: 76, bottom: 28, left: 52 }
  const now = Date.now()
  const start = points[0]?.at ?? now
  const end = Math.max(now, points[points.length - 1]?.at ?? now, start + 86_400_000)
  const ticks = niceTicks(lowest, highest)
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const x = (at: number) => pad.left + ((at - start) / (end - start)) * (W - pad.left - pad.right)
  const y = (price: number) =>
    pad.top + (1 - (price - yMin) / (yMax - yMin || 1)) * (H - pad.top - pad.bottom)

  // Gradini: orizzontale fino al punto dopo, poi su o giu'; l'ultimo prezzo fino a oggi.
  const step = points
    .map((point, index) => {
      const next = points[index + 1]?.at ?? end
      return `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(1)},${y(point.price).toFixed(1)} L${x(next).toFixed(1)},${y(point.price).toFixed(1)}`
    })
    .join(' ')
  const area = points.length
    ? `${step} L${x(end).toFixed(1)},${(H - pad.bottom).toFixed(1)} L${x(start).toFixed(1)},${(H - pad.bottom).toFixed(1)} Z`
    : ''

  const nearest = (clientX: number, box: DOMRect) => {
    const at =
      start +
      ((((clientX - box.left) / box.width) * W - pad.left) / (W - pad.left - pad.right)) *
        (end - start)
    let best = 0
    points.forEach((point, index) => {
      if (Math.abs(point.at - at) < Math.abs(points[best].at - at)) best = index
    })
    return best
  }
  const shown = active !== null ? points[active] : null
  const change = first > 0 ? Math.round(((current - first) / first) * 100) : 0

  return (
    <Modal open onClose={onClose} title={gettext('Andamento del prezzo')} wide>
      <div className="grid gap-4" onClick={(event) => event.stopPropagation()}>
        <p className="text-body-large font-medium">{title}</p>
        {points.length === 0 ? (
          <p className="text-body-medium text-on-surface-variant">
            {gettext(
              'Ancora nessun prezzo: lo leggiamo dal link del negozio ogni notte e qui comparirà l’andamento.',
            )}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: gettext('Adesso'), value: current },
                { label: gettext('Minimo'), value: lowest },
                { label: gettext('Massimo'), value: highest },
              ].map((tile) => (
                <div key={tile.label} className="rounded-row bg-surface-container-low px-3 py-2">
                  <p className="text-label-small text-on-surface-variant">{tile.label}</p>
                  <p className="amount text-body-large font-semibold">
                    {formatPrice(tile.value.toFixed(2))}
                  </p>
                </div>
              ))}
            </div>
            {points.length > 1 && (
              <p className="text-body-medium text-on-surface-variant">
                {change === 0
                  ? interpolate(gettext('Uguale a quando è entrato in lista, il %s.'), [
                      shortDate(history[0].at),
                    ])
                  : interpolate(
                      change < 0
                        ? gettext('%s in meno di quando è entrato in lista, il %s.')
                        : gettext('%s in più di quando è entrato in lista, il %s.'),
                      [`${Math.abs(change)}%`, shortDate(history[0].at)],
                    )}
              </p>
            )}
            <div className="relative" ref={frame}>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                className="block h-auto w-full touch-none select-none"
                role="img"
                aria-label={interpolate(gettext('Prezzo da %s a oggi: adesso %s'), [
                  shortDate(history[0].at),
                  formatPrice(current.toFixed(2)),
                ])}
                tabIndex={0}
                onPointerMove={(event) =>
                  setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))
                }
                onPointerDown={(event) =>
                  setActive(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))
                }
                onPointerLeave={() => setActive(null)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault()
                    const delta = event.key === 'ArrowRight' ? 1 : -1
                    setActive((index) =>
                      Math.min(
                        points.length - 1,
                        Math.max(0, (index ?? points.length - 1) + delta),
                      ),
                    )
                  }
                }}
                onBlur={() => setActive(null)}
              >
                {/* Griglia e assi: linee sottili, un tono sopra la superficie. */}
                {ticks.map((tick) => (
                  <g key={tick}>
                    <line
                      x1={pad.left}
                      x2={W - pad.right}
                      y1={y(tick)}
                      y2={y(tick)}
                      stroke="var(--surface-container-highest)"
                      strokeWidth={1}
                    />
                    <text
                      x={pad.left - 8}
                      y={y(tick)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="amount"
                      fontSize={12}
                      fill="var(--on-surface-variant)"
                    >
                      {formatPrice(tick.toFixed(2)).replace(/[.,]00(?=\D*$)/, '')}
                    </text>
                  </g>
                ))}
                {[start, end].map((at, index) => (
                  <text
                    key={at}
                    x={x(at)}
                    y={H - 8}
                    textAnchor={index === 0 ? 'start' : 'end'}
                    fontSize={12}
                    fill="var(--on-surface-variant)"
                  >
                    {index === 0 ? shortDate(history[0].at) : gettext('Oggi')}
                  </text>
                ))}
                <path d={area} fill="var(--primary)" opacity={0.1} />
                <path
                  d={step}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {points.map((point, index) => (
                  <circle
                    key={point.at}
                    cx={x(point.at)}
                    cy={y(point.price)}
                    r={active === index ? 6 : 4}
                    fill="var(--primary)"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ))}
                {/* Il prezzo di adesso, scritto in fondo alla linea. */}
                <text
                  x={x(end) + 8}
                  y={y(current)}
                  dominantBaseline="middle"
                  className="amount"
                  fontSize={13}
                  fontWeight={600}
                  fill="var(--on-surface)"
                >
                  {formatPrice(current.toFixed(2))}
                </text>
                {shown && (
                  <line
                    x1={x(shown.at)}
                    x2={x(shown.at)}
                    y1={pad.top}
                    y2={H - pad.bottom}
                    stroke="var(--on-surface-variant)"
                    strokeWidth={1}
                  />
                )}
              </svg>
              {shown && active !== null && (
                <div
                  className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-row bg-surface px-3 py-1.5 text-body-small shadow-sheet"
                  style={{
                    left: `${Math.min(85, Math.max(15, (x(shown.at) / W) * 100))}%`,
                  }}
                >
                  <span className="text-on-surface-variant">{shortDate(history[active].at)}</span>{' '}
                  <span className="amount font-semibold text-on-surface">
                    {formatPrice(shown.price.toFixed(2))}
                  </span>
                </div>
              )}
            </div>
            {points.length === 1 && (
              <p className="text-body-small text-on-surface-variant">
                {gettext(
                  'Per ora un solo prezzo: ogni notte lo rileggiamo dal link del negozio, e quando cambia la linea si muove.',
                )}
              </p>
            )}
            {/* La stessa informazione senza grafico: tutti i prezzi visti. */}
            <details className="rounded-row bg-surface-container-low px-4 py-2">
              <summary className="cursor-pointer text-body-medium">
                {interpolate(gettext('Tutti i prezzi (%s)'), [points.length])}
              </summary>
              <table className="mt-2 w-full text-body-medium">
                <tbody>
                  {[...history].reverse().map((point) => (
                    <tr key={point.at} className="border-t border-outline-variant first:border-0">
                      <td className="py-1.5 text-on-surface-variant">
                        {new Intl.DateTimeFormat(intlLocale(), {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        }).format(new Date(point.at))}
                      </td>
                      <td className="amount py-1.5 text-right font-medium">
                        {formatPrice(point.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </div>
    </Modal>
  )
}

/**
 * La campanella senza link del negozio non ha un prezzo da seguire: lo si
 * spiega e, se si vuole, si apre il form per aggiungerlo. Torna vero se si'.
 */
export function useAskForLink() {
  const confirm = useConfirm()
  return () =>
    confirm({
      title: gettext('Serve il link del negozio'),
      message: gettext(
        'Il prezzo lo leggiamo ogni notte dalla pagina del negozio: aggiungi il link e poi metti la campanella, ti avvisiamo quando scende.',
      ),
      confirmLabel: gettext('Aggiungi il link'),
      icon: 'notifications',
    })
}

/** La campanella: "avvisami se il prezzo scende". Piena quando e' messa. */
export function WatchBell({
  watching,
  pending,
  onToggle,
  className,
}: {
  watching: boolean
  pending?: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <span
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className={className}
    >
      <IconButton
        icon={watching ? 'notifications_active' : 'notifications'}
        label={watching ? gettext('Togli la campanella') : gettext('Avvisami se il prezzo scende')}
        onClick={onToggle}
        disabled={pending}
        inheritColor
        className={clsx(
          'shadow-fab',
          watching ? 'bg-primary text-on-primary' : 'bg-surface text-on-surface-variant',
        )}
      />
    </span>
  )
}
