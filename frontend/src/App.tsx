import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AppLayout } from './components/Layout'
import { Skeleton } from './components/ui'
import { AccountPage } from './features/account/AccountPage'
import { ExtensionPage } from './features/account/ExtensionPage'
import { NotificationsPage } from './features/account/NotificationsPage'
import { LoginPage } from './features/auth/AuthPages'
import { IdeasPage } from './features/ideas/IdeasPage'
import { JoinListPage } from './features/lists/JoinListPage'
import { ListDetailPage } from './features/lists/ListDetailPage'
import { ListsPage } from './features/lists/ListsPage'
import { SharedListPage } from './features/shared/SharedListPage'
import { useAuth } from './lib/auth'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <Skeleton className="m-6 h-24" />
  if (!user) {
    // Dopo il login (su cornhub) si torna dove si voleva andare: un invito
    // aperto da sloggato, o /estensione aperta dall'estensione Chrome, non
    // deve finire sulla home.
    const path = location.pathname + location.search
    const next = path === '/' ? '' : `?next=${encodeURIComponent(path)}`
    return <Navigate to={`/accedi${next}`} replace />
  }
  return children
}

export default function App() {
  return (
    <Routes>
      {/* Registrazione, password e conferma email stanno su cornhub (ADR 0020). */}
      <Route path="/accedi" element={<LoginPage />} />
      {/* Il link condiviso: pubblico, senza login. */}
      <Route path="/l/:token" element={<SharedListPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<ListsPage />} />
        <Route path="liste/:listId" element={<ListDetailPage />} />
        <Route path="unisciti/:token" element={<JoinListPage />} />
        <Route path="da-regalare" element={<IdeasPage />} />
        <Route path="avvisi" element={<NotificationsPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="estensione" element={<ExtensionPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
