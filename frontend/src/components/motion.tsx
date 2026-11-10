// Le animazioni che sono componenti: il pacco che pensa mentre lavora l'AI e i
// coriandoli di "fatto!". Le keyframes stanno in index.css (sezione "moto").

import clsx from 'clsx'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { gettext } from '../lib/i18n'

/* ------------------------------------------------------------ AiThinking -- */

/** Ogni quanto cambia il messaggio: abbastanza per leggerlo, non per annoiarsi. */
const LINE_MS = 2200

/** Una scintilla a quattro punte, centrata in (x, y). */
function Spark({ x, y, r, delay }: { x: number; y: number; r: number; delay: number }) {
  const d = `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`
  return <path className="think-spark" d={d} style={{ animationDelay: `${delay}ms` }} />
}

/**
 * Gemini sta lavorando (spesso per decine di secondi): un pacco col coperchio
 * che salta, qualche scintilla e un messaggio che cambia, cosi' si capisce che
 * sta succedendo qualcosa e non che la pagina e' ferma. `compact` e' la
 * versione in riga, per "Altre idee" sotto quelle gia' arrivate.
 */
export function AiThinking({
  lines,
  compact,
  className,
}: {
  /** I messaggi che si alternano, in ordine; l'ultimo resta finche' non arriva la risposta. */
  lines: string[]
  compact?: boolean
  className?: string
}) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (index >= lines.length - 1) return
    const timer = window.setTimeout(() => setIndex((current) => current + 1), LINE_MS)
    return () => window.clearTimeout(timer)
  }, [index, lines.length])
  const size = compact ? 40 : 96

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'flex items-center',
        compact ? 'gap-3 px-1' : 'flex-col gap-3 py-6 text-center',
        className,
      )}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 96 96"
        aria-hidden
        className="shrink-0 overflow-visible"
      >
        <g fill="var(--tertiary)">
          <Spark x={14} y={30} r={7} delay={0} />
          <Spark x={84} y={22} r={9} delay={500} />
          <Spark x={86} y={64} r={5} delay={1000} />
          <Spark x={10} y={70} r={5} delay={1300} />
        </g>
        <g className="think-box">
          <rect x="22" y="46" width="52" height="38" rx="5" fill="var(--wrap-1-paper)" />
          <rect x="43" y="46" width="10" height="38" fill="var(--wrap-1-ribbon)" />
        </g>
        <g className="think-lid">
          <rect x="18" y="34" width="60" height="14" rx="4" fill="var(--wrap-1-paper)" />
          <rect x="18" y="44" width="60" height="4" fill="rgba(31,27,26,0.06)" />
          <rect x="43" y="34" width="10" height="14" fill="var(--wrap-1-ribbon)" />
          <path
            d="M48 34c-4-9-16-13-18-6-1.7 5 6.5 6 18 6zm0 0c4-9 16-13 18-6 1.7 5-6.5 6-18 6z"
            fill="var(--wrap-1-ribbon)"
          />
        </g>
      </svg>
      <p
        key={index}
        className={clsx(
          'think-line ai-text font-medium',
          compact ? 'text-body-medium' : 'text-body-large',
        )}
      >
        {lines[Math.min(index, lines.length - 1)]}
      </p>
    </div>
  )
}

/** Righe finte delle idee in arrivo, con la luce dorata dell'AI. */
export function AiSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="skeleton-ai h-[84px]"
          style={{ animationDelay: `${index * -400}ms` }}
        />
      ))}
    </div>
  )
}

/** I messaggi del wizard "Ispirami". */
export const INSPIRE_LINES = () => [
  gettext('Penso a cosa le/gli piace…'),
  gettext('Giro per negozi con la fantasia…'),
  gettext('Scarto i soliti calzini…'),
  gettext('Controllo che stia nel budget…'),
  gettext('Incarto le idee migliori…'),
]

/** I messaggi delle "Alternative" sul link condiviso. */
export const ALTERNATIVES_LINES = () => [
  gettext('Guardo cosa c’è già in lista…'),
  gettext('Cerco qualcosa di simile…'),
  gettext('Evito i doppioni…'),
  gettext('Incarto le idee migliori…'),
]

/* -------------------------------------------------------------- Confetti -- */

const CONFETTI_COLORS = [
  'var(--primary)',
  'var(--tertiary)',
  'var(--tertiary-container)',
  'var(--primary-container)',
  'var(--success)',
  'var(--wrap-1-ribbon)',
  'var(--wrap-4-ribbon)',
]
const CONFETTI_PIECES = 36
const CONFETTI_MS = 1700

/**
 * Coriandoli da (x, y) dello schermo (di default dal centro): per "Lo regalo
 * io" e simili. Si smonta da solo; per rilanciarli si cambia `key`.
 */
export function Confetti({ x, y, onDone }: { x?: number; y?: number; onDone?: () => void }) {
  const [alive, setAlive] = useState(true)
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_PIECES }, (_, index) => {
        // A ventaglio verso l'alto, poi la "gravita'" li porta giu' (dy positivo).
        const angle = (-90 + (Math.random() - 0.5) * 150) * (Math.PI / 180)
        const distance = 120 + Math.random() * 200
        return {
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance + 160 + Math.random() * 120,
          rot: (Math.random() - 0.5) * 900,
          width: 6 + Math.random() * 6,
          height: 8 + Math.random() * 8,
          round: Math.random() < 0.3,
          color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
          delay: Math.random() * 120,
        }
      }),
    [],
  )
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAlive(false)
      onDone?.()
    }, CONFETTI_MS)
    return () => window.clearTimeout(timer)
    // Solo al montaggio: un `onDone` nuovo a ogni render non deve riavviare il timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!alive) return null
  const left = x ?? window.innerWidth / 2
  const top = y ?? window.innerHeight * 0.45
  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[80] overflow-hidden">
      <div className="absolute" style={{ left, top }}>
        {pieces.map((piece, index) => (
          <span
            key={index}
            className="confetti-piece"
            style={
              {
                '--dx': `${piece.dx}px`,
                '--dy': `${piece.dy}px`,
                '--rot': `${piece.rot}deg`,
                width: piece.round ? piece.width : piece.width * 0.7,
                height: piece.round ? piece.width : piece.height,
                borderRadius: piece.round ? '999px' : '2px',
                background: piece.color,
                animationDelay: `${piece.delay}ms`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>,
    document.body,
  )
}
