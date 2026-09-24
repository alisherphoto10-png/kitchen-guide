import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, LifeBuoy, LogOut, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { Modal, errText, toast } from '../components/ui'
import { ROLE_LABEL } from '../components/Layout'

// Системная кнопка «Назад» в шапке Telegram (есть, если страница открыта из мини-аппа).
function useTelegramBackButton(onBack: () => void) {
  useEffect(() => {
    const bb = (window as any).Telegram?.WebApp?.BackButton
    if (!bb) return
    bb.onClick(onBack)
    bb.show()
    return () => { bb.offClick(onBack); bb.hide() }
  }, [onBack])
}

export function AccountPage() {
  const { me, logout } = useSession()
  const navigate = useNavigate()
  const [f, setF] = useState({ current: '', next: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const mismatch = f.repeat !== '' && f.next !== f.repeat
  const home = me?.tenant ? '/recipes' : '/platform'
  // Мини-апп: вход через Telegram, пароль и выход не нужны.
  const miniApp = me?.via === 'telegram'
  const goHome = useCallback(() => navigate(home), [navigate, home])
  useTelegramBackButton(goHome)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/auth/password', { method: 'POST', body: { current: f.current, next: f.next } })
      toast('Пароль изменён')
      setF({ current: '', next: '', repeat: '' })
    } catch (err) {
      toast(errText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (!me) return null
  return (
    <div className="max-w-md mx-auto px-4 pt-4 lg:pt-8">
      <Link to={home} className="btn-ghost btn-sm -ml-2 mb-2"><ArrowLeft className="h-4 w-4" />{me.tenant ? 'К ТТК' : 'К заведениям'}</Link>
      <h1 className="h-page">Профиль</h1>

      <div className="card p-4 mt-4">
        <p className="font-semibold">{me.user.name || me.user.login}</p>
        <p className="text-sm muted">
          {me.user.login} · {me.user.is_platform_admin ? 'администратор платформы' : ROLE_LABEL[me.role].toLowerCase()}
          {me.tenant && !me.user.is_platform_admin && ` · ${me.tenant.name}`}
        </p>
        {miniApp && <p className="text-xs muted mt-1">Вход через Telegram{me.user.tg_username ? ` · @${me.user.tg_username}` : ''}</p>}
      </div>

      {miniApp ? (
        <button onClick={() => setSupportOpen(true)} className="card w-full mt-4 px-4 py-3.5 flex items-center gap-3 text-left hover:bg-paper transition-colors">
          <LifeBuoy className="h-5 w-5 text-brand flex-shrink-0" />
          <span className="flex-1 font-semibold">Техподдержка</span>
          <ChevronRight className="h-4 w-4 text-ink-faint" />
        </button>
      ) : (
        <>
          <form onSubmit={submit} className="card p-4 mt-4 grid gap-3">
            <h2 className="font-bold">Сменить пароль</h2>
            <label><span className="field-label">Текущий пароль</span><input type="password" className="input" autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} /></label>
            <label><span className="field-label">Новый пароль (от 6 символов)</span><input type="password" className="input" autoComplete="new-password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></label>
            <label><span className="field-label">Ещё раз</span><input type="password" className={`input ${mismatch ? '!border-bad' : ''}`} autoComplete="new-password" value={f.repeat} onChange={e => setF({ ...f, repeat: e.target.value })} /></label>
            {mismatch && <p className="text-xs text-bad -mt-1">Пароли не совпадают</p>}
            <button className="btn-primary mt-1" disabled={busy || !f.current || f.next.length < 6 || f.next !== f.repeat}>Сохранить</button>
          </form>
          <button onClick={logout} className="btn-outline w-full mt-4 lg:hidden"><LogOut className="h-4 w-4" />Выйти</button>
        </>
      )}

      {/* Заглушка: куда ведёт поддержка, решим позже (чат, бот, телефон). */}
      {supportOpen && (
        <Modal title="Техподдержка" onClose={() => setSupportOpen(false)} footer={<button className="btn-primary" onClick={() => setSupportOpen(false)}>Понятно</button>}>
          <p className="text-sm text-ink-2">Скоро здесь появится связь с поддержкой. А пока по любым вопросам обращайтесь к владельцу заведения.</p>
        </Modal>
      )}
    </div>
  )
}
