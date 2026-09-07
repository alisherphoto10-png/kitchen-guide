import { useState } from 'react'
import { Warehouse, PackagePlus, PackageMinus } from 'lucide-react'
// import { useTelegram } from '../hooks/useTelegram' // если хук лежит в проекте по этому пути —
// раскомментируйте и добавьте haptic.impact('light') на toggle() и в choose(), как в остальных
// кнопках KitchenDesk (см. IikoCard.tsx — там haptic.success()/haptic.error() на каждое действие).

/**
 * Кнопка "Склад" в нижней навигации: тап раскрывает дугой вверх две
 * подвкладки — Закуп и Списание — вместо прямого перехода в раздел.
 *
 * Форма — согласованный вариант A из прототипа
 * (https://claude.ai/code/artifact/a22fb092-747e-43c3-aa7f-22e09767e728):
 * скруглённый квадрат вместо круглых кнопок, механика (дуга, спрятанные
 * подписи до раскрытия) — по референсу из присланного видео-туториала.
 *
 * ВСТРАИВАНИЕ: замените текущую кнопку/ссылку "Склад" в компоненте нижней
 * навигации на этот компонент — он занимает то же место в ряду (flex-1,
 * как соседние вкладки), просто вместо прямой навигации по тапу открывает
 * веер. Реальная нижняя панель не входит в этот репозиторий (KitchenDesk не
 * под git — правки вносятся на сервере), поэтому здесь черновик-компонент
 * под интеграцию, а не точный diff по реальному файлу:
 *
 *   1. Найдите файл, где рендерится ряд нижней навигации (Главная/ТТК/
 *      Смена/План/Акты/Склад/Профиль).
 *   2. Там, где сейчас "Склад" — обычная кнопка/Link с переходом на
 *      /sklad (или как называется роут), замените на:
 *        <SkladNavButton
 *          active={текущий раздел === 'sklad'}
 *          onNavigate={(tab) => navigate(tab === 'zakup' ? '/sklad/zakup' : '/sklad/spisanie')}
 *        />
 *      (подставьте свой способ навигации — react-router navigate(),
 *      состояние вкладки и т.п.)
 *   3. Расстояние разлёта (70px по горизонтали, 18px вверх) подобрано под
 *      ширину кнопки ~46px — если реальная кнопка в ряду уже/шире, подправьте
 *      -translate-x-[70px]/translate-x-[70px] и -translate-y-[18px] на глаз.
 */
export function SkladNavButton({
  active,
  onNavigate,
}: {
  /** true, если пользователь сейчас в разделе "Склад" (закуп или списание) */
  active: boolean
  /** вызывается с 'zakup' или 'spisanie' при выборе подвкладки */
  onNavigate: (tab: 'zakup' | 'spisanie') => void
}) {
  const [open, setOpen] = useState(false)

  function choose(tab: 'zakup' | 'spisanie') {
    setOpen(false)
    onNavigate(tab)
  }

  return (
    <div className="relative flex-1">
      {/* затемнение экрана при раскрытом меню — тап вне кнопок закрывает */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 transition-opacity" onClick={() => setOpen(false)} />
      )}

      {/* веер из двух кнопок над "Склад" — спрятан (scale-50, opacity-0) пока не открыт */}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 -translate-x-1/2">
        <button
          onClick={() => choose('zakup')}
          aria-label="Закуп"
          className={`pointer-events-auto absolute bottom-0 left-1/2 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-green-600 text-[#040816] shadow-lg shadow-black/40 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            open
              ? '-translate-x-[70px] -translate-y-[18px] scale-100 opacity-100'
              : '-translate-x-1/2 translate-y-0 scale-50 opacity-0'
          }`}
        >
          <PackagePlus className="h-5 w-5" />
        </button>
        <span
          className={`pointer-events-none absolute bottom-[54px] left-1/2 -translate-x-[92px] whitespace-nowrap text-[10px] font-semibold text-white transition-opacity duration-200 ${
            open ? 'opacity-100 delay-100' : 'opacity-0'
          }`}
        >
          Закуп
        </span>

        <button
          onClick={() => choose('spisanie')}
          aria-label="Списание"
          className={`pointer-events-auto absolute bottom-0 left-1/2 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-green-600 text-[#040816] shadow-lg shadow-black/40 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            open
              ? 'translate-x-[70px] -translate-y-[18px] scale-100 opacity-100'
              : '-translate-x-1/2 translate-y-0 scale-50 opacity-0'
          }`}
        >
          <PackageMinus className="h-5 w-5" />
        </button>
        <span
          className={`pointer-events-none absolute bottom-[54px] left-1/2 translate-x-[18px] whitespace-nowrap text-[10px] font-semibold text-white transition-opacity duration-200 ${
            open ? 'opacity-100 delay-100' : 'opacity-0'
          }`}
        >
          Списание
        </span>
      </div>

      {/* сама кнопка "Склад" — иконка/подпись оформите как у соседних вкладок в ряду */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`z-50 flex w-full flex-col items-center gap-1 py-1 ${
          active || open ? 'text-green-500' : 'text-gray-500'
        }`}
      >
        <Warehouse className="h-5 w-5" />
        <span className="text-[10px] font-semibold">Склад</span>
      </button>
    </div>
  )
}
