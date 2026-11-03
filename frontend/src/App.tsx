import { Navigate, Route, Routes } from 'react-router-dom'

import { AppLayout } from './components/Layout'
import { Skeleton } from './components/ui'
import { AccountPage } from './features/account/AccountPage'
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from './features/auth/AuthPages'
import { IdeasPage } from './features/ideas/IdeasPage'
import { ListDetailPage } from './features/lists/ListDetailPage'
import { ListsPage } from './features/lists/ListsPage'
import { SharedListPage } from './features/shared/SharedListPage'
import { useAuth } from './lib/auth'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth()
  if (!ready) return <Skeleton className="m-6 h-24" />
  if (!user) return <Navigate to="/accedi" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/accedi" element={<LoginPage />} />
      <Route path="/registrati" element={<RegisterPage />} />
      <Route path="/verifica-email/:token" element={<VerifyEmailPage />} />
      <Route path="/password-dimenticata" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
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
        <Route path="da-regalare" element={<IdeasPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
