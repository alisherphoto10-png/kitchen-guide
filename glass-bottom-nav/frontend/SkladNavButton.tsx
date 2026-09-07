import { useState } from 'react'
import { PackageMinus, PackagePlus, Warehouse } from 'lucide-react'
import './BottomNav.css'
// import { useTelegram } from '../hooks/useTelegram' // если хук лежит в проекте по этому пути —
// раскомментируйте и добавьте haptic.impact('light') в toggle() и choose(), как в остальных
// кнопках KitchenDesk (см. IikoCard.tsx — haptic.success()/haptic.error() на каждое действие).

/**
 * Кнопка "Склад" в нижней навигации: тап раскрывает дугой вверх две
 * прозрачные зелёные плитки — Закуп и Списание — вместо прямого перехода.
 * Рендерится внутри {@link BottomNav} на месте обычной вкладки.
 */
export function SkladNavButton({
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
