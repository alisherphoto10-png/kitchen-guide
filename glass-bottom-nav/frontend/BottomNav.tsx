import { useLayoutEffect, useRef, useState } from 'react'
import {
  CheckSquare,
  ClipboardList,
  FolderOpen,
  Home,
  PackageMinus,
  PackagePlus,
  Scissors,
  User,
  Warehouse,
} from 'lucide-react'
// import { useTelegram } from '../hooks/useTelegram' // если хук лежит в проекте по этому пути —
// раскомментируйте и добавьте haptic.impact('light') в toggleSklad()/chooseSklad(), как в
// остальных кнопках KitchenDesk (см. IikoCard.tsx — haptic.success()/haptic.error() на каждое действие).

/*
 * Стекло нижней навигации KitchenDesk — один файл, копируется целиком.
 * Согласовано на прототипах:
 *   1) https://claude.ai/code/artifact/a22fb092-747e-43c3-aa7f-22e09767e728 (форма веера — вариант A)
 *   2) https://claude.ai/code/artifact/51c4e698-8b33-4973-a304-76bca691e1e0 (финал: вся лента и
 *      плитки "Склад" — один и тот же рецепт прозрачного зелёного стекла)
 *
 * CSS ниже, а не Tailwind-утилиты — эффект стекла требует многослойного
 * градиента + backdrop-filter + нескольких теней сразу, и как отдельные
 * Tailwind-классы в JSX это читалось бы хуже, чем несколько именованных
 * классов. Рендерится один раз через <style> внутри компонента.
 */
const GLASS_NAV_CSS = `
.kd-glass-nav {
  position: relative;
  display: flex;
  padding: 8px 6px;
  padding-bottom: calc(8px + env(safe-area-inset-bottom));
  border-radius: 26px;
  background: linear-gradient(135deg, rgba(110, 240, 165, 0.38), rgba(20, 110, 68, 0.4));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(190, 255, 215, 0.4);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
}

.kd-glass-indicator {
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 0;
  border-radius: 20px;
  background: #34c17a; /* акцент KitchenDesk — замените на переменную темы, если она есть в проекте */
  transition:
    transform 380ms cubic-bezier(0.34, 1.2, 0.4, 1),
    width 380ms cubic-bezier(0.34, 1.2, 0.4, 1);
  pointer-events: none;
  z-index: 0;
}

.kd-glass-nav-item {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  background: none;
  border: none;
  font-family: inherit;
  color: rgba(230, 245, 235, 0.7);
  padding: 8px 2px;
  cursor: pointer;
  transition: color 200ms ease;
}
.kd-glass-nav-item svg { width: 18px; height: 18px; }
.kd-glass-nav-item .kd-label { font-size: 10px; font-weight: 700; }
.kd-glass-nav-item.is-active { color: #06140c; }
/* превью-состояние "Склад" (веер открыт, выбор ещё не сделан) — светлее
   обычного, но не тёмное: под кнопкой ещё нет сплошной пилюли-индикатора */
.kd-glass-nav-item.is-open { color: #eafff2; }

.kd-sklad-wrap { position: relative; flex: 1; z-index: 1; }

.kd-sklad-scrim {
  position: fixed;
  inset: 0;
  background: rgba(4, 7, 5, 0);
  transition: background 220ms ease;
  z-index: 40;
  pointer-events: none;
}
.kd-sklad-scrim.is-open { background: rgba(4, 7, 5, 0.5); pointer-events: auto; }

.kd-fan {
  position: absolute;
  left: 50%;
  bottom: 100%;
  z-index: 50;
  pointer-events: none;
}

/* та же формула стекла, что у ленты — один материал на всё */
.kd-glass-tile {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 50px;
  height: 50px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #eafff2;
  background: linear-gradient(135deg, rgba(110, 240, 165, 0.38), rgba(20, 110, 68, 0.4));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(190, 255, 215, 0.4);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.4);
  transform: translate(-50%, 0) scale(0.4);
  opacity: 0;
  transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease;
  pointer-events: none;
}
.kd-glass-tile svg { width: 21px; height: 21px; }

.kd-fan.is-open .kd-glass-tile { opacity: 1; pointer-events: auto; }
.kd-fan.is-open .kd-fan-zakup { transform: translate(calc(-50% - 58px), -20px) scale(1); }
.kd-fan.is-open .kd-fan-spisanie { transform: translate(calc(-50% + 58px), -20px) scale(1); }

.kd-fan-label {
  position: absolute;
  bottom: 54px;
  left: 50%;
  font-size: 10px;
  font-weight: 700;
  color: #eef2ee;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 200ms ease 120ms;
  pointer-events: none;
}
.kd-fan-label-zakup { transform: translateX(-92px); }
.kd-fan-label-spisanie { transform: translateX(18px); }
.kd-fan.is-open .kd-fan-label { opacity: 1; }
`

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
// Акты/Склад/Профиль). "Склад" не в этом списке — рендерится отдельно ниже,
// между "Акты" и "Профиль".
const LEFT_TABS: { key: NavTab; label: string; Icon: typeof Home }[] = [
  { key: 'main', label: 'Главная', Icon: Home },
  { key: 'ttk', label: 'ТТК', Icon: ClipboardList },
  { key: 'smena', label: 'Смена', Icon: CheckSquare },
  { key: 'plan', label: 'План', Icon: FolderOpen },
  { key: 'akty', label: 'Акты', Icon: Scissors },
]

/**
 * Кнопка "Склад": тап раскрывает дугой вверх две прозрачные зелёные
 * плитки — Закуп и Списание — вместо прямого перехода. Определена в этом
 * же файле, чтобы всё копировалось одним куском.
 */
function SkladNavButton({
  active,
  onNavigate,
}: {
  /** true, если пользователь сейчас в разделе "Склад" (закуп или списание) */
  active: boolean
  /** вызывается с 'zakup' или 'spisanie' при выборе плитки */
  onNavigate: (tab: 'zakup' | 'spisanie') => void
}) {
  const [open, setOpen] = useState(false)

  function choose(tab: 'zakup' | 'spisanie') {
    setOpen(false)
    onNavigate(tab)
  }

  return (
    <div className="kd-sklad-wrap">
      <div className={`kd-sklad-scrim ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)} />

      <div className={`kd-fan ${open ? 'is-open' : ''}`}>
        <button className="kd-glass-tile kd-fan-zakup" onClick={() => choose('zakup')} aria-label="Закуп">
          <PackagePlus />
        </button>
        <span className="kd-fan-label kd-fan-label-zakup">Закуп</span>

        <button className="kd-glass-tile kd-fan-spisanie" onClick={() => choose('spisanie')} aria-label="Списание">
          <PackageMinus />
        </button>
        <span className="kd-fan-label kd-fan-label-spisanie">Списание</span>
      </div>

      {/*
        "is-active" (тёмный текст) — только когда реально активен раздел
        Склад, т.е. под кнопкой есть плотная зелёная пилюля-индикатор.
        Пока веер только открыт превью-выбором (open, но ещё не выбрали
        Закуп/Списание) — пилюли под кнопкой ещё нет, поэтому тёмный текст
        на стекле стал бы нечитаемым: используем более светлый "is-open".
      */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`kd-glass-nav-item ${active ? 'is-active' : open ? 'is-open' : ''}`}
      >
        <Warehouse />
        <span className="kd-label">Склад</span>
      </button>
    </div>
  )
}

/**
 * Нижняя навигация KitchenDesk — стекло вместо сплошного тёмного фона.
 * Управляемый компонент: какой раздел активен и что происходит при
 * переходе решает вызывающий код.
 *
 * ВСТРАИВАНИЕ: замените текущий компонент нижней навигации на этот —
 * см. README.md рядом за пошаговой инструкцией. Это черновик под
 * интеграцию, а не точный diff по реальному файлу — KitchenDesk не под
 * git, файл с текущей навигацией отсюда не виден.
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
    <>
      <style>{GLASS_NAV_CSS}</style>
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
    </>
  )
}
