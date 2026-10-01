'use client'
import { useState } from 'react'
import { useAppStore } from '@/store'
import { useTelegram } from '@/hooks/useTelegram'
import {
  Home, BookOpen, ClipboardCheck, ListOrdered, FolderOpen, User, Settings,
  BarChart3, Users, ClipboardList, ChevronDown, ChevronRight,
  Radio, Calendar, CalendarCheck, Package, Ruler, Link2, ClipboardMinus, History
, Warehouse, Bell, PartyPopper, ImageIcon, Send } from 'lucide-react'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Главная', Icon: Home },
  { id: 'search', label: 'ТТК', Icon: BookOpen },
  { id: 'checklist', label: 'Смена', Icon: ClipboardCheck },
  { id: 'plan', label: 'План', Icon: ListOrdered },
  { id: 'acts', label: 'Акты', Icon: FolderOpen },
  { id: 'warehouse', label: 'Склад', Icon: Warehouse },
  { id: 'profile', label: 'Профиль', Icon: User },
]

// Прямая ссылка (не таб стора, как остальные пункты) — /banquet живёт вне
// основной навигации/роутинга (см. PART-1), сюда добавлен только пункт-вход
// в неё. Доступ те же роли, что и у самого роута на бэкенде
// (requireRole('admin','chef','sushef','cook') в backend/src/api/banquet.js).
const BANQUET_ROLES = new Set(['admin', 'chef', 'sushef', 'cook', 'superadmin'])

const SIDEBAR_TOUR_IDS: Record<string, string> = { search: 'nav-ttk', plan: 'nav-plan', checklist: 'nav-checklist' }

// admin/chef/sushef ведут заготовки и чек-лист через раздел "Управление", а не как повара —
// им эти вкладки не нужны и не должны быть видны
const HIDDEN_FOR_MANAGERS = new Set(['checklist', 'plan'])

// Группировка и порядок должны совпадать с CATEGORIES в Admin.tsx (мобильный drawer / Mini App)
const ADMIN_GROUPS = [
  {
    label: 'Люди',
    items: [
      { id: 'users', label: 'Сотрудники', Icon: Users },
      { id: 'sections', label: 'Цеха', Icon: BarChart3 },
    ],
  },
  {
    label: 'Кухня',
    items: [
      { id: 'ttk', label: 'ТТК', Icon: BookOpen },
      { id: 'products', label: 'Продукты', Icon: Package },
      { id: 'units', label: 'Единицы измерения', Icon: Ruler },
      { id: 'templates', label: 'Шаблоны чек-листа', Icon: ClipboardList },
      { id: 'acts', label: 'Шаблоны актов', Icon: ClipboardMinus },
      { id: 'writeoff_reasons', label: 'Причины списания', Icon: ClipboardMinus },
    ],
  },
  {
    label: 'Контроль',
    items: [
      { id: 'monitor', label: 'Мониторинг', Icon: BarChart3 },
      { id: 'schedule', label: 'График', Icon: Calendar },
      { id: 'duty', label: 'Дежурства', Icon: CalendarCheck },
      { id: 'planhistory', label: 'История планов', Icon: History },
    ],
  },
  {
    label: 'Настройки',
    items: [
      { id: 'broadcast', label: 'Рассылка', Icon: Radio },
      { id: 'groups', label: 'Группы', Icon: Link2 },
      { id: 'plandate', label: 'Дата плана', Icon: Calendar },
      { id: 'notifications', label: 'Уведомления', Icon: Bell },
      { id: 'venue', label: 'Заведение', Icon: ImageIcon },
    ],
  },
]

export function Sidebar({ isWebVersion = false }: { isWebVersion?: boolean } = {}) {
  const { activeTab, setActiveTab, user, adminTab, setAdminTab } = useAppStore()
  const { haptic } = useTelegram()
  const [adminOpen, setAdminOpen] = useState(activeTab === 'admin')
  const isAdmin = user && ['admin','sushef','superadmin'].includes(user.role)  // chef — только просмотр
  const isManager = user && ['admin','sushef'].includes(user.role)
  const navItems = isManager ? NAV_ITEMS.filter(item => !HIDDEN_FOR_MANAGERS.has(item.id)) : NAV_ITEMS
  const showBanquet = isWebVersion && !!user && BANQUET_ROLES.has(user.role)
  // Формы заказов внешних клиентов ОКО (мастер /web/oko-order, Этап 3) — модуль
  // только ОКО (заведение 1); сервер проверяет то же самое сам.
  const showOkoOrders = isWebVersion && !!user && (user.role === 'superadmin' || (user.role === 'admin' && String(user.restaurant_id) === '1'))
  const initials = user?.name?.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase() || '?'

  return (
    <aside className="hidden lg:flex flex-col w-[260px] bg-[#070f1f] h-screen fixed left-0 top-0 z-40">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="w-9 h-9 rounded-xl overflow-hidden border border-white/10 flex-shrink-0 flex items-center justify-center bg-white/5 p-1.5">
          <img src="/logo-icon-light.png" alt="KitchenDesk" className="w-full h-full object-contain" />
        </div>
        <div>
          <div className="text-sm font-bold text-white">KitchenDesk</div>
          <div className="text-xs text-gray-500">Система управления кухней</div>
        </div>
      </div>

      <nav data-tour="nav-main" className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold px-3 mb-2">Меню</div>
        {navItems.map(({ id, label, Icon }) => {
          const active = activeTab === id
          const button = (
            <button key={id} data-tour={SIDEBAR_TOUR_IDS[id]} onClick={() => { haptic.select(); setActiveTab(id as any); setAdminOpen(false) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all duration-200 ${
                active ? 'bg-green-500/10 text-green-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/4'
              }`}>
              <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={active ? 2 : 1.5} />
              {label}
            </button>
          )
          // "Банкет" — прямая ссылка на отдельную страницу /banquet (вне
          // стора/табов, см. PART-1), вставлена сразу перед "Профиль".
          if (id === 'profile' && showBanquet) {
            return (
              <div key="banquet-wrap">
                <a href="/banquet/" onClick={() => haptic.select()}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all duration-200 text-gray-500 hover:text-gray-300 hover:bg-white/4">
                  <PartyPopper className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                  Банкет
                </a>
                {button}
              </div>
            )
          }
          return button
        })}

        {isAdmin && (
          <div>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest font-semibold px-3 mb-2 mt-3">Администратор</div>
            <button onClick={() => { haptic.select(); setActiveTab('admin' as any); setAdminOpen(!adminOpen) }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all duration-200 ${
                activeTab === 'admin' ? 'bg-green-500/10 text-green-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/4'
              }`}>
              <Settings className="h-4 w-4 flex-shrink-0" strokeWidth={activeTab === 'admin' ? 2 : 1.5} />
              <span className="flex-1 text-left">Управление</span>
              {adminOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>

            {adminOpen && (
              <div className="ml-3 border-l border-white/6 pl-3 mb-1">
                {ADMIN_GROUPS.map((group, gi) => (
                  <div key={group.label} className={gi > 0 ? 'mt-2' : ''}>
                    <div className="px-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-gray-600">
                      {group.label}
                    </div>
                    {group.items.map(({ id, label, Icon }) => (
                      <button key={id}
                        onClick={() => { haptic.select(); setActiveTab('admin' as any); setAdminTab(id); }}
                        className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg mb-0.5 text-xs font-medium transition-all ${adminTab === id ? 'text-green-400 bg-green-500/8' : 'text-gray-500 hover:text-gray-300 hover:bg-white/4'}`}>
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                        {label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {showOkoOrders && (
              <a href="/web/oko-order/" onClick={() => haptic.select()}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm font-medium transition-all duration-200 text-gray-500 hover:text-gray-300 hover:bg-white/4">
                <Send className="h-4 w-4 flex-shrink-0" strokeWidth={1.5} />
                Заказы клиентов
              </a>
            )}
          </div>
        )}
      </nav>

      <div className="px-4 py-4 border-t border-white/6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-700/20 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-green-400">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-white truncate">{user?.name || ''}</div>
          <div className="text-xs text-gray-500 truncate">{user?.section || 'Нет цеха'}</div>
        </div>
      </div>
    </aside>
  )
}
