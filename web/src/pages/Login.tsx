import { useState, type FormEvent } from 'react'
import { useSession } from '../lib/session'
import { errText } from '../components/ui'
import { useGuideUrl } from '../lib/guide'

export function LoginPage() {
  const { login } = useSession()
  const [form, setForm] = useState({ login: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const guideUrl = useGuideUrl()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(form.login.trim(), form.password)
    } catch (err) {
      setError(errText(err))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.1fr_1fr]">
      {/* Левая половина — «лист ТТК» как образ продукта */}
      <div className="hidden lg:flex relative overflow-hidden bg-ink text-paper p-12 flex-col justify-between">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="h-9 w-9"><rect width="32" height="32" rx="9" fill="#B4471F" /><path d="M9 10h14M9 16h14M9 22h9" stroke="#F6F3EE" strokeWidth="2.6" strokeLinecap="round" /></svg>
          <span className="text-sm font-bold uppercase tracking-[0.12em] text-paper/80">Калькуляции</span>
        </div>
        <div className="max-w-md">
          <p className="text-4xl font-extrabold leading-[1.1] tracking-tight">Технологические карты кухни — в одном месте.</p>
          <p className="mt-4 text-paper/60 leading-relaxed">Состав брутто/нетто с потерями, полуфабрикаты, пересчёт на любое количество порций и выгрузка в PDF и Excel.</p>
        </div>
        <div className="rounded-2xl bg-paper/[0.06] border border-paper/10 p-5 font-mono text-[13px] text-paper/70 leading-7">
          <div className="flex justify-between text-paper/40"><span>Ингредиент</span><span>брутто · нетто</span></div>
          <div className="flex justify-between"><span>Говядина вырезка</span><span>0,240 · 0,200</span></div>
          <div className="flex justify-between"><span>Лук репчатый</span><span>0,060 · 0,050</span></div>
          <div className="flex justify-between"><span>П/ф соус демиглас</span><span>0,080 · 0,080</span></div>
          <div className="flex justify-between text-brand-soft"><span>× 12 порций</span><span>пересчитано</span></div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2.5 mb-10">
            <svg viewBox="0 0 32 32" className="h-9 w-9"><rect width="32" height="32" rx="9" fill="#B4471F" /><path d="M9 10h14M9 16h14M9 22h9" stroke="#F6F3EE" strokeWidth="2.6" strokeLinecap="round" /></svg>
            <span className="text-sm font-bold uppercase tracking-[0.12em] text-ink-2">Калькуляции</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Вход</h1>
          <p className="muted text-sm mt-1 mb-7">Логин и пароль выдаёт владелец заведения.</p>

          <label className="field-label" htmlFor="login">Логин</label>
          <input id="login" className="input h-11" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus
            value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} />

          <label className="field-label mt-4" htmlFor="password">Пароль</label>
          <input id="password" type="password" className="input h-11" autoComplete="current-password"
            value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />

          {error && <p className="mt-4 text-sm text-bad" role="alert">{error}</p>}

          <button className="btn-primary w-full h-11 mt-6" disabled={busy || !form.login || !form.password}>
            {busy ? 'Входим…' : 'Войти'}
          </button>

          {guideUrl && (
            <p className="mt-6 text-center text-[13px]">
              <a href={guideUrl} target="_blank" rel="noopener noreferrer" className="muted underline underline-offset-2 hover:text-brand">Что такое «Калькуляции»?</a>
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
