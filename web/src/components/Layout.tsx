import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Tags, Users, Building2, LogOut, UserCircle2, ArrowLeft, LifeBuoy } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import type { Role } from '../lib/types'

const ROLE_LABEL: Record<Role, string> = { owner: 'Владелец', editor: 'Технолог', viewer: 'Повар' }

// Сколько открытых обращений в техподдержку ждут ответа — бейдж в меню.
function useSupportWaiting(enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['support-summary'],
    queryFn: () => api<{ open: number; waiting: number }>('/platform/support/summary'),
    enabled, refetchInterval: 30_000,
  })
  return data?.waiting || 0
}

function useNav() {
  const { me, can } = useSession()
  const waiting = useSupportWaiting(!!me?.user.is_platform_admin)
  const items = [] as { to: string; label: string; Icon: typeof BookOpen; badge?: number }[]
  if (me?.tenant) {
    items.push({ to: '/recipes', label: 'ТТК', Icon: BookOpen })
    if (can('editor')) items.push({ to: '/categories', label: 'Категории', Icon: Tags })
    if (can('owner')) items.push({ to: '/team', label: 'Команда', Icon: Users })
  }
  if (me?.user.is_platform_admin) {
    items.push({ to: '/platform', label: 'Заведения', Icon: Building2 })
    items.push({ to: '/support', label: 'Поддержка', Icon: LifeBuoy, badge: waiting })
  }
  return items
}

function Badge({ n }: { n: number }) {
  return <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-white text-[11px] font-bold leading-[18px] text-center">{n > 99 ? '99+' : n}</span>
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 flex-shrink-0" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#B4471F" />
      <path d="M9 10h14M9 16h14M9 22h9" stroke="#F6F3EE" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  )
}

export function Layout() {
  const { me, logout, enterTenant } = useSession()
  const nav = useNav()
  const navigate = useNavigate()
  const adminInside = me?.user.is_platform_admin && me.tenant

  const leaveTenant = () => { enterTenant(null); navigate('/platform') }

  return (
    <div className="min-h-dvh lg:pl-[240px]">
      {/* Боковая панель (десктоп) */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[240px] flex-col border-r border-line bg-paper-2/60">
        <div className="flex items-center gap-2.5 px-5 h-16">
          <Mark />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Калькуляции</p>
            <p className="text-sm font-bold truncate">{me?.tenant?.name || 'Платформа'}</p>
          </div>
        </div>
        <nav className="flex-1 px-3 pt-2 flex flex-col gap-0.5">
          {nav.map(({ to, label, Icon, badge }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-semibold transition-colors
                ${isActive ? 'bg-paper-card text-ink shadow-card' : 'text-ink-2 hover:bg-paper-card/60'}`}>
              {({ isActive }) => <>
                <Icon className={`h-[18px] w-[18px] ${isActive ? 'text-brand' : 'text-ink-muted'}`} />
                <span className="flex-1">{label}</span>
                {!!badge && <Badge n={badge} />}
              </>}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <NavLink to="/account" className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-paper-card/60">
            <UserCircle2 className="h-8 w-8 text-ink-faint flex-shrink-0" strokeWidth={1.5} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{me?.user.name || me?.user.login}</p>
              <p className="text-xs muted">{me?.user.is_platform_admin ? 'Администратор платформы' : me && ROLE_LABEL[me.role]}</p>
            </div>
          </NavLink>
          {me?.via !== 'telegram' && (
            <button onClick={logout} className="btn-ghost btn-sm w-full justify-start mt-1 text-ink-muted"><LogOut className="h-4 w-4" />Выйти</button>
          )}
        </div>
      </aside>

      {/* Верхняя панель (мобильный) */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-2.5 px-4 h-14 border-b border-line bg-paper/90 backdrop-blur">
        {/* Лого и название ведут на главный экран — у повара нижних вкладок нет. */}
        <Link to={me?.tenant ? '/recipes' : '/platform'} className="flex flex-1 min-w-0 items-center gap-2.5">
          <Mark />
          <p className="flex-1 min-w-0 text-[15px] font-bold truncate">{me?.tenant?.name || 'Платформа'}</p>
        </Link>
        <NavLink to="/account" className="btn-icon btn-ghost h-9 w-9" aria-label="Профиль"><UserCircle2 className="h-5 w-5" /></NavLink>
      </header>

      {adminInside && (
        <div className="flex items-center gap-2 px-4 lg:px-8 py-2 bg-ink text-paper text-[13px]">
          <span className="flex-1 min-w-0 truncate">Вы внутри заведения <b>{me.tenant!.name}</b> как администратор платформы</span>
          <button onClick={leaveTenant} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline flex-shrink-0">
            <ArrowLeft className="h-3.5 w-3.5" />К заведениям
          </button>
        </div>
      )}

      <main className="pb-24 lg:pb-10">
        <Outlet />
      </main>

      {/* Нижние вкладки (мобильный) */}
      {nav.length > 1 && (
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-paper-card/95 backdrop-blur safe-bottom">
          <div className="flex">
            {nav.map(({ to, label, Icon, badge }) => (
              <NavLink key={to} to={to}
                className={({ isActive }) => `relative flex-1 flex flex-col items-center gap-0.5 pt-2 pb-2 text-[11px] font-semibold
                  ${isActive ? 'text-brand' : 'text-ink-muted'}`}>
                <Icon className="h-5 w-5" />{label}
                {!!badge && <span className="absolute top-1 left-1/2 ml-1.5"><Badge n={badge} /></span>}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
    </div>
  )
}

export { ROLE_LABEL }
