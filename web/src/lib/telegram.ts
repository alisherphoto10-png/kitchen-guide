// Мини-апп Telegram: доступ к window.Telegram.WebApp и мелкие хелперы.
import { useEffect } from 'react'

declare global {
  interface Window {
    Telegram?: { WebApp?: {
      initData: string
      initDataUnsafe?: { start_param?: string }
      ready: () => void
      expand: () => void
      close: () => void
      setHeaderColor?: (c: string) => void
      setBackgroundColor?: (c: string) => void
      BackButton?: { show: () => void; hide: () => void; onClick: (f: () => void) => void; offClick: (f: () => void) => void }
    } }
  }
}

// Системная кнопка «Назад» в шапке Telegram (есть, если страница открыта из мини-аппа).
export function useTelegramBackButton(onBack: () => void) {
  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton
    if (!bb) return
    bb.onClick(onBack)
    bb.show()
    return () => { bb.offClick(onBack); bb.hide() }
  }, [onBack])
}

// Закрыть мини-апп (вернуться в чат с ботом). Вне Telegram — false.
export function closeMiniApp(): boolean {
  const wa = window.Telegram?.WebApp
  if (!wa?.close) return false
  wa.close()
  return true
}
