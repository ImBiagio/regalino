import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import { GiftWrap } from '../../components/gift'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { Icon } from '../../components/ui'
import { loginUrl, useAuth } from '../../lib/auth'
import { gettext } from '../../lib/i18n'

/**
 * Pagina piena: una card su superficie neutra con in testa il pacco (carta e
 * nastro) e il marchio. Il rosso resta un accento, non tutto lo sfondo.
 */
function Shell({
  title,
  children,
  footer,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-container-low p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="card-elevated overflow-hidden bg-surface">
          <div className="relative h-24">
            <GiftWrap seed="regalino" ribbon={12} x={78} y={58} className="h-full w-full" />
            <img
              src="/logo-mark.svg"
              alt=""
              width={64}
              height={64}
              className="absolute -bottom-8 left-6 h-16 w-16 rounded-[18px] shadow-fab-mobile sm:left-8"
            />
          </div>
          <div className="px-6 pb-6 pt-11 sm:px-8 sm:pb-8">
            <p className="text-title-large">Regalino</p>
            <p className="text-body-medium text-on-surface-variant">
              {gettext('I regali giusti, senza doppioni.')}
            </p>
            <h1 className="mb-4 mt-6 text-title-medium">{title}</h1>
            {children}
          </div>
        </div>

        {footer && <div className="mt-4 text-center text-body-medium">{footer}</div>}
        <div className="mt-4 flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  )
}

const AUTO_KEY = 'sso-auto-redirect'

const ERRORS: Record<string, string> = {
  annullato: gettext('Accesso annullato.'),
  scaduto: gettext('Il login ha impiegato troppo: riprova.'),
  stato: gettext("Il login non e' andato a buon fine: riprova."),
  cornhub: gettext("L'account della suite non risponde: riprova tra poco."),
  account: gettext("Questo account non puo' entrare nell'app."),
}

/**
 * Login e registrazione stanno su cornhub (account unico della suite, ADR
 * 0020): qui solo il bottone, e il redirect automatico se non c'e' un errore
 * da mostrare. Dopo il login cornhub torna sull'API, che apre la sessione e
 * rimanda alla pagina di partenza (``next``: un invito, la pagina
 * ``/estensione`` aperta dall'estensione Chrome, un link condiviso).
 */
export function LoginPage() {
  const { user, ready } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') || '/'
  const error = params.get('errore')
  const target = loginUrl(next)

  // Redirect automatico al massimo una volta ogni 30 secondi: se dopo il
  // ritorno da cornhub la sessione non parte (cornhub irraggiungibile dal
  // backend, account non piu' valido) si resta qui col bottone, senza un
  // giro infinito tra app e cornhub.
  useEffect(() => {
    if (!ready || user || error) return
    let last = 0
    try {
      last = Number(sessionStorage.getItem(AUTO_KEY) || 0)
    } catch {
      /* storage non disponibile: niente redirect automatico */
      return
    }
    if (Date.now() - last < 30_000) return
    try {
      sessionStorage.setItem(AUTO_KEY, String(Date.now()))
    } catch {
      return
    }
    window.location.assign(target)
  }, [ready, user, error, target])

  if (user) return <Navigate to={next} replace />
  return (
    <Shell title={gettext('Accedi')}>
      <p className="mb-4 text-body-medium text-on-surface-variant">
        {gettext("Si entra con l'account della suite ino: lo stesso per tutte le app.")}
      </p>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-row bg-error-container p-3 text-body-medium text-on-error-container"
        >
          {ERRORS[error] ?? gettext('Accesso non riuscito: riprova.')}
        </p>
      )}
      <a className="btn-filled w-full" href={target}>
        <Icon name="login" size={18} />
        {gettext('Accedi con cornhub')}
      </a>
    </Shell>
  )
}
