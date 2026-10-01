'use client'
import { OkoOrderSetup } from '@/components/features/okoOrder/OkoOrderSetup'

// /web/oko-order — мастер настройки форм заказов внешних клиентов ОКО
// (группы → темы → позиции/пользователи, макет 01, Этап 3). Вход — тот же
// пароль, что у /oko-order/admin/ (не логин KitchenDesk), его спрашивает
// сам мастер.
export default function OkoOrderSetupPage() {
  return (
    // Свой контейнер прокрутки: в globals.css у html/body overflow: hidden.
    <div id="oko-order-scroll" className="fixed inset-0 overflow-y-auto bg-[#040816] text-white font-sans">
      <OkoOrderSetup />
    </div>
  )
}
