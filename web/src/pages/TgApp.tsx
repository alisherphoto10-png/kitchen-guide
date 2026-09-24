// Точка входа мини-аппа: /tg-app?t=<slug>. Заведение — из параметра ссылки
// (кнопка бота) или из start_param (ссылка t.me/<бот>?startapp=<slug>).
// Вход — по initData, подпись которого сервер проверяет токеном бота этого заведения.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { errText, Spinner } from '../components/ui'

declare global {
  interface Window {
    Telegram?: { WebApp?: {
      initData: string
      initDataUnsafe?: { start_param?: string }
      ready: () => void
      expand: () => void
      setHeaderColor?: (c: string) => void
      setBackgroundColor?: (c: string) => void
    } }
  }
}

function loadTelegramScript(): Promise<void> {
  if (window.Telegram?.WebApp) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://telegram.org/js/telegram-web-app.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Не загрузился скрипт Telegram'))
    document.head.appendChild(s)
  })
}

export function TgAppPage() {
  const { loginTelegram } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await loadTelegramScript()
        const wa = window.Telegram?.WebApp
        if (!wa?.initData) throw new Error('Откройте эту страницу из Telegram — кнопкой «ТТК» в боте заведения.')
        wa.ready()
        wa.expand()
        wa.setHeaderColor?.('#F6F3EE')
        wa.setBackgroundColor?.('#F6F3EE')
        const tenant = new URLSearchParams(window.location.search).get('t') || wa.initDataUnsafe?.start_param || ''
        if (!tenant) throw new Error('В ссылке не указано заведение. Откройте приложение кнопкой в боте.')
        await loginTelegram(wa.initData, tenant)
        if (!cancelled) navigate('/recipes', { replace: true })
      } catch (e) {
        if (!cancelled) setError(errText(e))
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-8 text-center">
      <svg viewBox="0 0 32 32" className="h-12 w-12 mb-5"><rect width="32" height="32" rx="9" fill="#B4471F" /><path d="M9 10h14M9 16h14M9 22h9" stroke="#F6F3EE" strokeWidth="2.6" strokeLinecap="round" /></svg>
      {error ? (
        <>
          <p className="font-bold">Не получилось войти</p>
          <p className="text-sm muted mt-2 max-w-xs">{error}</p>
        </>
      ) : (
        <>
          <Spinner />
          <p className="text-sm muted mt-3">Открываем технологические карты…</p>
        </>
      )}
    </div>
  )
}
