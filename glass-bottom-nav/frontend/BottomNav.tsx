import { useLayoutEffect, useRef, useState } from 'react'
import { CheckSquare, ClipboardList, FolderOpen, Home, Scissors, User } from 'lucide-react'
import { SkladNavButton } from './SkladNavButton'
import './BottomNav.css'

export type NavTab =
  | 'main'
  | 'ttk'
  | 'smena'
  | 'plan'
  | 'akty'
  | 'sklad-zakup'
  | 'sklad-spisanie'
  | 'profile'

// Порядок и иконки — как в текущей нижней навигации (Главная/ТТК/Смена/План/
// Акты/Склад/Профиль). "Склад" не в этом списке — рендерится отдельно через
// SkladNavButton, между "Акты" и "Профиль".
const LEFT_TABS: { key: NavTab; label: string; Icon: typeof Home }[] = [
  { key: 'main', label: 'Главная', Icon: Home },
  { key: 'ttk', label: 'ТТК', Icon: ClipboardList },
  { key: 'smena', label: 'Смена', Icon: CheckSquare },
  { key: 'plan', label: 'План', Icon: FolderOpen },
  { key: 'akty', label: 'Акты', Icon: Scissors },
]

/**
 * Нижняя навигация KitchenDesk — стекло вместо сплошного тёмного фона.
 * Согласовано на прототипах (см. BottomNav.css). Компонент управляемый:
 * какой раздел активен и что происходит при переходе решает вызывающий код.
 *
 * ВСТРАИВАНИЕ: замените текущий компонент нижней навигации на этот —
 * см. README.md рядом за пошаговой инструкцией и оговоркой, почему это
 * черновик, а не точный diff по реальному файлу (KitchenDesk не под git).
 */
export function BottomNav({ active, onNavigate }: { active: NavTab; onNavigate: (tab: NavTab) => void }) {
  const navRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  const isSklad = active === 'sklad-zakup' || active === 'sklad-spisanie'
  const activeKey = isSklad ? 'sklad' : active

  useLayoutEffect(() => {
    const nav = navRef.current
    const el = itemRefs.current[activeKey]
    if (!nav || !el) return
    const navRect = nav.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    setIndicator({ left: rect.left - navRect.left, width: rect.width })
  }, [activeKey])

  return (
    <nav ref={navRef} className="kd-glass-nav">
      {indicator && (
        <div
          className="kd-glass-indicator"
          style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }}
        />
      )}

      {LEFT_TABS.map(({ key, label, Icon }) => (
        <button
          key={key}
          ref={(el) => {
            itemRefs.current[key] = el
          }}
          onClick={() => onNavigate(key)}
          className={`kd-glass-nav-item ${active === key ? 'is-active' : ''}`}
        >
          <Icon />
          <span className="kd-label">{label}</span>
        </button>
      ))}

      <div
        ref={(el) => {
          itemRefs.current.sklad = el
        }}
        style={{ flex: 1 }}
      >
        <SkladNavButton
          active={isSklad}
          onNavigate={(tab) => onNavigate(tab === 'zakup' ? 'sklad-zakup' : 'sklad-spisanie')}
        />
      </div>

      <button
        ref={(el) => {
          itemRefs.current.profile = el
        }}
        onClick={() => onNavigate('profile')}
        className={`kd-glass-nav-item ${active === 'profile' ? 'is-active' : ''}`}
      >
        <User />
        <span className="kd-label">Профиль</span>
      </button>
    </nav>
  )
}
