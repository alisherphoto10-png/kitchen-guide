import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useSession } from './lib/session'
import { Layout } from './components/Layout'
import { PageLoader } from './components/ui'
import { LoginPage } from './pages/Login'
import { RecipesPage } from './pages/Recipes'
import { RecipeEditorPage } from './pages/RecipeEditor'
import { CategoriesPage } from './pages/Categories'
import { TeamPage } from './pages/Team'
import { PlatformPage } from './pages/Platform'
import { AccountPage } from './pages/Account'
import { TgAppPage } from './pages/TgApp'
import type { Role } from './lib/types'

function Guard({ min, platform, children }: { min?: Role; platform?: boolean; children: ReactNode }) {
  const { me, can } = useSession()
  if (!me) return null
  if (platform) return me.user.is_platform_admin ? <>{children}</> : <Navigate to="/" replace />
  if (!me.tenant) return <Navigate to="/platform" replace />
  if (min && !can(min)) return <Navigate to="/recipes" replace />
  return <>{children}</>
}

export function App() {
  const { me, loading } = useSession()
  const { pathname } = useLocation()
  // Мини-апп входит сам (через Telegram) — независимо от того, есть ли уже сессия.
  if (pathname === '/tg-app') {
    return <Routes><Route path="/tg-app" element={<TgAppPage />} /></Routes>
  }
  if (loading) return <PageLoader />
  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  const home = me.tenant ? '/recipes' : '/platform'
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/recipes" element={<Guard><RecipesPage /></Guard>} />
        <Route path="/recipes/:id" element={<Guard><RecipesPage /></Guard>} />
        <Route path="/recipes/new" element={<Guard min="editor"><RecipeEditorPage /></Guard>} />
        <Route path="/recipes/:id/edit" element={<Guard min="editor"><RecipeEditorPage /></Guard>} />
        <Route path="/categories" element={<Guard min="editor"><CategoriesPage /></Guard>} />
        <Route path="/team" element={<Guard min="owner"><TeamPage /></Guard>} />
        <Route path="/platform" element={<Guard platform><PlatformPage /></Guard>} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  )
}
