'use client'
import { useEffect, useState } from 'react'
import { OkoOrderSetup } from '@/components/features/okoOrder/OkoOrderSetup'

// /web/oko-order — мастер настройки форм заказов внешних клиентов ОКО
// (группы → темы → позиции/пользователи, макет 01, Этап 3). Права проверяет
// сервер: /api/oko-order/admin/* пускает только администратора ОКО и
// суперадмина, остальным экран покажет «Нет доступа».
export default function OkoOrderSetupPage() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('web_token') || !localStorage.getItem('web_user')) {
      window.location.href = '/web-login?redirect=' + encodeURIComponent('/web/oko-order/')
      return
    }
    setReady(true)
  }, [])

  return (
    // Свой контейнер прокрутки: в globals.css у html/body overflow: hidden.
    <div id="oko-order-scroll" className="fixed inset-0 overflow-y-auto bg-[#040816] text-white font-sans">
      {ready ? <OkoOrderSetup /> : <div className="min-h-screen flex items-center justify-center text-green-400 text-sm">Загрузка...</div>}
    </div>
  )
}
