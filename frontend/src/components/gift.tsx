// Pezzi condivisi da lista del proprietario, lista condivisa e "Da regalare":
// prezzo, link al negozio, data dell'evento, foto.

import clsx from 'clsx'
import { useRef, useState } from 'react'

import { useImageFromUrl, useUploadImage } from '../api/hooks'
import { ApiError, mediaUrl } from '../lib/api'
import { daysUntil, formatDate, formatPrice, hostOf } from '../lib/format'
import { gettext, interpolate, ngettext } from '../lib/i18n'
import type { Money, UUID } from '../lib/types'
import { Field, Icon, Modal } from './ui'

/** "12 dicembre 2026 · tra 39 giorni": la data dice quanto manca. */
export function eventLabel(isoDate: string): string {
  const days = daysUntil(isoDate)
  const date = formatDate(isoDate)
  if (days === 0) return interpolate(gettext('%s · oggi'), [date])
  if (days === 1) return interpolate(gettext('%s · domani'), [date])
  if (days < 0) return interpolate(gettext('%s · passato'), [date])
  return interpolate(ngettext('%s · tra %s giorno', '%s · tra %s giorni', days), [date, days])
}

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
 * Miniatura del regalo: la foto se c'e', altrimenti l'icona. Con `onOpen` la
 * foto si tocca per vederla grande.
 */
export function GiftThumb({
  image,
  icon = 'redeem',
  done,
  size = 56,
  onOpen,
}: {
  image: string | null
  icon?: string
  /** Regalato: spunta sopra la foto, o icona piena al posto del pacco. */
  done?: boolean
  size?: number
  onOpen?: () => void
}) {
  const box = { width: size, height: size }
  if (!image) {
    return (
      <span
        className={clsx(
          'flex shrink-0 items-center justify-center rounded-nested',
          done ? 'bg-primary text-on-primary' : 'bg-primary-container text-on-primary-container',
        )}
        style={box}
      >
        <Icon name={done ? 'check' : icon} size={Math.round(size * 0.45)} />
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
      {done && (
        <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-pill bg-primary text-on-primary">
          <Icon name="check" size={16} />
        </span>
      )}
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

/**
 * Foto del regalo nel form: carica dal dispositivo o prendila dal link del
 * negozio. La foto si carica subito (cosi' c'e' l'anteprima) e si collega al
 * regalo solo quando si salva; quelle abbandonate le pulisce il server.
 */
export function ImagePicker({
  current,
  choice,
  onChoice,
  link,
}: {
  /** Foto gia' salvata sul regalo. */
  current: string | null
  choice: ImageChoice
  onChoice: (choice: ImageChoice) => void
  /** Il link del form: se c'e', "Dal link" usa quello. */
  link: string
}) {
  const upload = useUploadImage()
  const fromUrl = useImageFromUrl()
  const input = useRef<HTMLInputElement>(null)
  const [askUrl, setAskUrl] = useState(false)
  const [otherUrl, setOtherUrl] = useState('')
  const shown = choice === undefined ? current : choice.url
  const busy = upload.isPending || fromUrl.isPending
  const error = upload.error ?? fromUrl.error
  const errorText =
    error instanceof ApiError
      ? (error.fieldErrors().file ?? error.fieldErrors().url ?? error.message)
      : error
        ? String(error)
        : null

  const takeFrom = async (url: string) => {
    upload.reset()
    const image = await fromUrl.mutateAsync(url).catch(() => null)
    if (image) {
      onChoice({ id: image.id, url: image.url })
      setAskUrl(false)
      setOtherUrl('')
    }
  }

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
                onClick={() => onChoice({ id: null, url: null })}
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
          fromUrl.reset()
          const image = await upload.mutateAsync(file).catch(() => null)
          if (image) onChoice({ id: image.id, url: image.url })
        }}
      />
    </div>
  )
}
