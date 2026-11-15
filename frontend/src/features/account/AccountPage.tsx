import { useState } from 'react'

import { useAuthConfig } from '../../api/hooks'
import { LanguageSwitcher } from '../../components/LanguageSwitcher'
import { Page } from '../../components/Layout'
import { Avatar, ErrorBanner, Icon, Segmented } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { gettext } from '../../lib/i18n'
import type { NotifyBy, User } from '../../lib/types'
import { ExtensionSection } from './ExtensionPage'

/**
 * L'account nell'app: chi sei (dall'account della suite, su cornhub), dove
 * arrivano gli avvisi, le estensioni collegate e la lingua.
 */
export function AccountPage() {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <Page className="px-5 pt-5 md:px-8 md:pt-8">
      <div className="grid gap-5">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-[28px] font-medium leading-9 md:text-headline-small">
            {gettext('Account')}
          </h1>
          <button type="button" className="btn-outlined btn-sm" onClick={() => logout()}>
            <Icon name="logout" size={18} />
            {gettext('Esci')}
          </button>
        </header>

        <SuiteAccountSection user={user} />
        <NotifySection user={user} />
        <ExtensionSection />
        <LanguageSection />
      </div>
    </Page>
  )
}

/**
 * Nome, email e password sono dell'account della suite (cornhub, ADR 0020):
 * qui si vedono soltanto, con i link per cambiarli e per chiavi e limiti AI.
 */
function SuiteAccountSection({ user }: { user: User }) {
  const { data: config } = useAuthConfig()
  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <div className="flex items-center gap-3">
        <Avatar name={user.display_name} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-body-large font-medium">{user.display_name}</h2>
          <p className="truncate text-body-small text-on-surface-variant">{user.email}</p>
        </div>
      </div>
      <p className="mt-4 text-body-medium text-on-surface-variant">
        {gettext(
          "Nome, email e password sono dell'account della suite ino: valgono per tutte le app e si cambiano su cornhub. Il nome è quello che vede chi apre le tue liste.",
        )}
      </p>
      {config && (
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="btn-tonal btn-sm" href={config.account_url}>
            <Icon name="manage_accounts" size={18} />
            {gettext('Account della suite')}
          </a>
          <a className="btn-outlined btn-sm" href={config.ai_url}>
            <Icon name="key" size={18} />
            {gettext('Chiavi e limiti AI')}
          </a>
        </div>
      )}
    </section>
  )
}

/** Dove arrivano gli avvisi (prezzo sceso): nell'app, per email o entrambi. */
function NotifySection({ user }: { user: User }) {
  const { setUser } = useAuth()
  const [error, setError] = useState<unknown>(null)
  const value: NotifyBy = user.notify_by ?? 'both'
  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">{gettext('Avvisi')}</h2>
      <p className="mt-1 text-body-small text-on-surface-variant">
        {gettext('Quando scende il prezzo di un regalo con la campanella: dove vuoi saperlo?')}
      </p>
      <Segmented
        className="mt-3"
        value={value}
        options={[
          { value: 'app', label: gettext('Solo nell’app') },
          { value: 'email', label: gettext('Solo per email') },
          { value: 'both', label: gettext('Entrambi') },
        ]}
        onChange={async (notify_by) => {
          setError(null)
          try {
            setUser(await api.patch<User>('/api/me', { notify_by }))
          } catch (err) {
            setError(err)
          }
        }}
      />
      <ErrorBanner error={error} />
    </section>
  )
}

/** Lingua dell'interfaccia e delle mail, salvata sul profilo. */
function LanguageSection() {
  return (
    <section className="rounded-card bg-surface-container-low p-5">
      <h2 className="text-body-large font-medium">{gettext('Lingua')}</h2>
      <p className="mt-1 text-body-small text-on-surface-variant">
        {gettext("Vale per l'app e per le mail che ti mandiamo.")}
      </p>
      <LanguageSwitcher className="mt-3" />
    </section>
  )
}
