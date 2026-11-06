// Pezzi condivisi da lista del proprietario, lista condivisa e "Da regalare":
// prezzo, link al negozio, data dell'evento, foto.

import clsx from 'clsx'
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useDescribeLink, useImageFromUrl, useReadLink, useUploadImage } from '../api/hooks'
import { ApiError, mediaUrl } from '../lib/api'
import { daysUntil, formatDate, formatPrice, hostOf, priceInput } from '../lib/format'
import { gettext, interpolate, ngettext } from '../lib/i18n'
import type { LinkDescription, Money, UUID } from '../lib/types'
import { Field, Icon, Modal } from './ui'

/** Prezzo e link del regalo, sotto il titolo di una riga. */
export function GiftMeta({ price, url }: { price: Money | null; url: string }) {
  if (!price && !url) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-small">
      {price && (
        <span className="amount text-body-medium font-medium text-on-surface">
          {formatPrice(price)}
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
  notes,
  badge,
  taken,
  onClick,
  onImage,
  detail,
  footer,
}: {
  /** L'id del regalo: sceglie la carta del pacco se manca la foto. */
  seed: string
  image: string | null
  title: string
  price: Money | null
  url: string
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
        <GiftMeta price={price} url={url} />
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
