import { useAiQuote } from '../api/hooks'
import { gettext, interpolate } from '../lib/i18n'
import { Icon } from './ui'

/**
 * Accanto al bottone di una funzione AI grande: dice chi paga e quanto, prima
 * di premere (ADR 0020). Nell'oro del nastro, il segno dell'AI (ADR 0013).
 *
 * - piccola, sulla chiave di casa: "1 🌽" (pannocchie della quota del giorno);
 * - grande, con la chiave dell'utente: "~0,12 € con la tua chiave";
 * - non disponibile (serve la chiave, limite raggiunto): il motivo e il link
 *   a cornhub per aggiungere la chiave o alzare il limite.
 *
 * ``count``: quante volte l'azione chiama la funzione (es. tre link da importare).
 */
export function AiCost({ feature, count = 1 }: { feature: string; count?: number }) {
  const features = count > 1 ? [`${feature}:${count}`] : [feature]
  const { data } = useAiQuote(features)
  const item = data?.items[0]
  if (!item || !data) return null

  if (!item.allowed) {
    return (
      <p className="flex items-start gap-2 rounded-row bg-surface-container p-3 text-body-small text-on-surface-variant">
        <Icon name="key" size={18} className="text-tertiary" />
        <span>
          {item.message}{' '}
          <a className="font-medium text-primary underline" href={data.account_url}>
            {gettext('Apri cornhub')}
          </a>
        </span>
      </p>
    )
  }
  if (item.billed_to === 'house') {
    return (
      <span
        className="inline-flex items-center gap-1 text-body-small text-on-surface-variant"
        title={interpolate(gettext('Pannocchie rimaste oggi: %s'), [data.pannocchie_left])}
      >
        {/* Il numero e la pannocchia non si traducono. */}
        {`${item.estimate_pannocchie ?? 1} 🌽`}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill bg-tertiary-container px-2.5 py-1 text-label-small text-on-tertiary-container"
      title={item.note || undefined}
    >
      <Icon name="key" size={14} />
      {interpolate(gettext('~%s con la tua chiave'), [item.estimate_label ?? ''])}
    </span>
  )
}
