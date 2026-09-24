import { useState, type FormEvent } from 'react'
import { LogOut } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { errText, toast } from '../components/ui'
import { ROLE_LABEL } from '../components/Layout'

export function AccountPage() {
  const { me, logout } = useSession()
  const [f, setF] = useState({ current: '', next: '', repeat: '' })
  const [busy, setBusy] = useState(false)
  const mismatch = f.repeat !== '' && f.next !== f.repeat

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
    <div className="max-w-md mx-auto px-4 pt-5 lg:pt-8">
      <h1 className="h-page">Аккаунт</h1>
      <div className="card p-4 mt-4">
        <p className="font-semibold">{me.user.name || me.user.login}</p>
        <p className="text-sm muted">
          {me.user.login} · {me.user.is_platform_admin ? 'администратор платформы' : ROLE_LABEL[me.role].toLowerCase()}
          {me.tenant && !me.user.is_platform_admin && ` · ${me.tenant.name}`}
        </p>
      </div>

      <form onSubmit={submit} className="card p-4 mt-4 grid gap-3">
        <h2 className="font-bold">Сменить пароль</h2>
        <label><span className="field-label">Текущий пароль</span><input type="password" className="input" autoComplete="current-password" value={f.current} onChange={e => setF({ ...f, current: e.target.value })} /></label>
        <label><span className="field-label">Новый пароль (от 6 символов)</span><input type="password" className="input" autoComplete="new-password" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></label>
        <label><span className="field-label">Ещё раз</span><input type="password" className={`input ${mismatch ? '!border-bad' : ''}`} autoComplete="new-password" value={f.repeat} onChange={e => setF({ ...f, repeat: e.target.value })} /></label>
        {mismatch && <p className="text-xs text-bad -mt-1">Пароли не совпадают</p>}
        <button className="btn-primary mt-1" disabled={busy || !f.current || f.next.length < 6 || f.next !== f.repeat}>Сохранить</button>
      </form>

      <button onClick={logout} className="btn-outline w-full mt-4 lg:hidden"><LogOut className="h-4 w-4" />Выйти</button>
    </div>
  )
}
