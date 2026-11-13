import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  useCreateExtensionToken,
  useDeleteExtensionToken,
  useExtensionTokens,
} from '../../api/hooks'
import { Page, PageHeader } from '../../components/Layout'
import { ErrorBanner, Icon } from '../../components/ui'
import { BASE_URL } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatDateTime } from '../../lib/format'
import { gettext, interpolate } from '../../lib/i18n'

/** Quanto aspettare che l'estensione confermi di aver ricevuto la chiave. */
const CONNECT_TIMEOUT_MS = 4000

/** La versione dell'estensione, se c'e': la scrive il suo content script (connect.js). */
function extensionVersion(): string | null {
  return document.documentElement.dataset.regalinoExtension ?? null
}

/** "Chrome su macOS": per riconoscere il browser in Account. */
function browserName(): string {
  const agent = navigator.userAgent
  const os = /Mac/.test(agent)
    ? 'macOS'
    : /Windows/.test(agent)
      ? 'Windows'
      : /Android/.test(agent)
        ? 'Android'
        : /Linux/.test(agent)
          ? 'Linux'
          : ''
  const browser = /Edg\//.test(agent) ? 'Edge' : /Brave/.test(agent) ? 'Brave' : 'Chrome'
  return os ? interpolate(gettext('%s su %s'), [browser, os]) : browser
}

/** Manda la chiave all'estensione e aspetta che risponda; falso se non risponde. */
function handOver(key: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      resolve(false)
    }, CONNECT_TIMEOUT_MS)
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return
      if (event.data?.type !== 'regalino:connected') return
      window.clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(true)
    }
    window.addEventListener('message', onMessage)
    window.postMessage(
      { type: 'regalino:connect', key, api: BASE_URL, name },
      window.location.origin,
    )
  })
}

/**
 * `/estensione` (ADR 0016): l'estensione apre questa pagina, chi e' gia'
 * entrato tocca "Collega" e la chiave passa all'estensione senza copiarla.
 */
export function ExtensionPage() {
  const { user } = useAuth()
  const [version, setVersion] = useState(extensionVersion)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = useCreateExtensionToken()
  const remove = useDeleteExtensionToken()

  useEffect(() => {
    // Il content script gira a inizio pagina, ma per sicurezza si riguarda.
    if (version) return
    const timer = window.setInterval(() => setVersion(extensionVersion()), 500)
    return () => window.clearInterval(timer)
  }, [version])

  const connect = async () => {
    setError(null)
    const token = await create.mutateAsync(browserName()).catch(() => null)
    if (!token) return
    if (await handOver(token.key, user?.display_name ?? '')) {
      setConnected(true)
    } else {
      // Una chiave che nessuno ha ricevuto non deve restare valida.
      remove.mutate(token.id)
      setError(gettext('L’estensione non ha risposto. Ricarica la pagina e riprova.'))
    }
  }

  return (
    <Page>
      <PageHeader
        title={gettext('Estensione per Chrome')}
        subtitle={gettext(
          'Aggiungi un regalo dalla pagina del negozio con un tocco, o importa una lista Amazon o Elfster intera.',
        )}
        back={{ to: '/account', label: gettext('Account') }}
      />
      <div className="grid max-w-2xl gap-4 px-5 md:px-8">
        <ErrorBanner error={error ?? create.error} />
        {connected ? (
          <section className="grid gap-3 rounded-card bg-success-container p-5 text-on-success-container">
            <p className="flex items-center gap-2 text-title-medium">
              <Icon name="check_circle" size={24} filled />
              {gettext('Estensione collegata')}
            </p>
            <p className="text-body-medium">
              {gettext(
                'Puoi chiudere questa pagina. Su un prodotto, o su una lista Amazon o Elfster, tocca l’icona di Regalino nella barra di Chrome.',
              )}
            </p>
          </section>
        ) : version ? (
          <section className="grid gap-3 rounded-card bg-surface-container-low p-5">
            <h2 className="text-body-large font-medium">
              {interpolate(gettext('Collega l’estensione a %s'), [user?.email ?? ''])}
            </h2>
            <p className="text-body-medium text-on-surface-variant">
              {gettext(
                'L’estensione riceve una chiave sua: può leggere le pagine che le chiedi, vedere le tue liste e aggiungerci regali. Nient’altro. La scolleghi quando vuoi da Account.',
              )}
            </p>
            <button
              type="button"
              className="btn-filled justify-self-start"
              disabled={create.isPending}
              onClick={() => void connect()}
            >
              <Icon name="extension" size={20} />
              {gettext('Collega l’estensione')}
            </button>
          </section>
        ) : (
          <section className="grid gap-3 rounded-card bg-surface-container-low p-5">
            <h2 className="text-body-large font-medium">{gettext('Installa l’estensione')}</h2>
            <ol className="grid list-decimal gap-2 pl-5 text-body-medium">
              <li>
                {gettext('Scarica la cartella')} <code className="amount">extension/</code>{' '}
                {gettext('dal repository di Regalino.')}
              </li>
              <li>
                {gettext('In Chrome apri')} <code className="amount">chrome://extensions</code>{' '}
                {gettext('e accendi “Modalità sviluppatore”.')}
              </li>
              <li>
                {gettext('Tocca “Carica estensione non pacchettizzata” e scegli la cartella.')}
              </li>
              <li>{gettext('Ricarica questa pagina e tocca “Collega l’estensione”.')}</li>
            </ol>
          </section>
        )}
        <p className="px-1 text-body-small text-on-surface-variant">
          <Link to="/account" className="font-medium text-primary">
            {gettext('Browser collegati')}
          </Link>{' '}
          {gettext('si vedono e si scollegano in Account.')}
        </p>
      </div>
    </Page>
  )
}

/** In Account: i browser con l'estensione collegata, e "Scollega". */
export function ExtensionSection() {
  const { data, error } = useExtensionTokens()
  const remove = useDeleteExtensionToken()
  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-body-large font-medium">{gettext('Estensione per Chrome')}</h2>
        <Link to="/estensione" className="btn-tonal btn-sm">
          <Icon name="extension" size={18} />
          {gettext('Collega')}
        </Link>
      </div>
      <p className="mt-1 text-body-small text-on-surface-variant">
        {gettext('Aggiungi regali dalla pagina del negozio e importa liste da Amazon o Elfster.')}
      </p>
      <ErrorBanner error={error ?? remove.error} />
      {data && data.length > 0 && (
        <div className="mt-3 grid gap-2">
          {data.map((token) => (
            <div
              key={token.id}
              className="flex items-center gap-3 rounded-row bg-surface px-4 py-3"
            >
              <Icon name="extension" size={22} className="text-on-surface-variant" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-large">
                  {token.name || gettext('Browser')}
                </span>
                <span className="block text-body-small text-on-surface-variant">
                  {token.last_used_at
                    ? interpolate(gettext('Usata l’ultima volta il %s'), [
                        formatDateTime(token.last_used_at),
                      ])
                    : interpolate(gettext('Collegata il %s'), [formatDateTime(token.created_at)])}
                </span>
              </span>
              <button
                type="button"
                className="btn-text btn-sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate(token.id)}
              >
                {gettext('Scollega')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
