import clsx from 'clsx'

import { useAiQuote, useAiWallet } from '../api/hooks'
import { gettext, interpolate } from '../lib/i18n'
import { Icon } from './ui'

/**
 * Le pannocchie 🌽 di oggi: la quota della chiave di casa per le funzioni AI
 * piccole (ADR 0020). Sta nella barra dell'app (in fondo al rail su desktop,
 * nell'angolo in alto su mobile) e porta alla pagina AI dell'account su
 * cornhub. Se cornhub non risponde non si mostra niente.
 */
export function CornCounter({ compact = false }: { compact?: boolean }) {
  const { data } = useAiWallet()
  if (data?.pannocchie_left === undefined) return null
  const left = data.pannocchie_left
  const day = data.pannocchie_day ?? 0
  // Sotto un quinto della quota il contatore si fa rosso: sta per finire.
  const low = day > 0 && left < day / 5
  const title = interpolate(
    gettext('Pannocchie rimaste oggi: %s su %s. Quota gratuita per le funzioni AI piccole.'),
    [left, day],
  )
  return (
    <a
      href={data.account_url}
      title={title}
      aria-label={title}
      className={clsx(
        'state inline-flex items-center rounded-pill font-medium tabular-nums transition-colors',
        low
          ? 'bg-error-container text-on-error-container'
          : 'bg-secondary-container text-on-secondary-container',
        compact
          ? 'flex-col gap-0 px-2 py-1 text-label-small'
          : 'gap-1 px-2.5 py-1 text-body-medium',
      )}
    >
      {/* Le pannocchie sono l'unita' della quota: niente traduzione. */}
      <span aria-hidden="true">🌽</span>
      <span>{left}</span>
    </a>
  )
}

/**
 * Stato di una funzione AI per il suo bottone. Le funzioni grandi usano la
 * chiave dell'utente: il bottone mostra la chiave (``AiKeyIcon``) e resta
 * spento finche' l'utente non ne ha una adatta (``allowed`` false, con il
 * motivo in ``message``, che ``AiCost`` mostra accanto con il link).
 * Stessi argomenti di ``AiCost``: la stima e' la stessa query.
 */
export function useAiGate(feature: string, { count = 1, fast = false } = {}) {
  const features = count > 1 ? [`${feature}:${count}`] : [feature]
  const { data, isLoading } = useAiQuote(features, fast)
  const item = data?.items[0]
  return {
    loading: isLoading,
    large: item?.tier === 'large',
    // Se cornhub non risponde alla stima non si blocca: decide la chiamata vera.
    allowed: item ? item.allowed : true,
    message: item?.message ?? '',
    accountUrl: data?.account_url ?? '',
  }
}

/** Il simbolo dei bottoni delle funzioni grandi: "usa la tua chiave". */
export function AiKeyIcon({ size = 18 }: { size?: number }) {
  return (
    <span title={gettext('Usa la tua chiave API')} className="inline-flex">
      <Icon name="key" size={size} />
    </span>
  )
}
