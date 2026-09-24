import { useCallback, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, LifeBuoy, LogOut, ChevronRight, MessagesSquare, BookMarked, ExternalLink } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { closeMiniApp, openExternal, useTelegramBackButton } from '../lib/telegram'
import { GUIDE_LABEL, useGuideUrl } from '../lib/guide'
import { plural } from '../lib/format'
import type { MyTicket } from '../lib/types'
import { errText, toast } from '../components/ui'
import { ROLE_LABEL } from '../components/Layout'

export function AccountPage() {
  const { me, logout } = useSession()
  const navigate = useNavigate()
  const [f, setF] = useState({ current: '', next: '', repeat: '' })
  const [busy, setBusy] = useState(false)
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

      <GuideLink miniApp={miniApp} />

      {miniApp ? (
        <SupportLinks />
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
    </div>
  )
}

// Гид для владельцев. На сайте — обычная ссылка в новую вкладку, в мини-аппе —
// Telegram.WebApp.openLink (браузер, а не внутри мини-аппа). Ссылки нет — пункта нет.
function GuideLink({ miniApp }: { miniApp: boolean }) {
  const url = useGuideUrl()
  if (!url) return null
  const body = <>
    <BookMarked className="h-5 w-5 text-brand flex-shrink-0" />
    <span className="flex-1 min-w-0">
      <span className="block font-semibold">{GUIDE_LABEL}</span>
      <span className="block text-xs muted">Как работают «Калькуляции» — откроется в браузере</span>
    </span>
    <ExternalLink className="h-4 w-4 text-ink-faint" />
  </>
  const cls = 'card mt-4 w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-paper transition-colors'
  return miniApp
    ? <button onClick={() => openExternal(url)} className={cls}>{body}</button>
    : <a href={url} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a>
}

// Мини-апп: «Техподдержка» закрывает приложение — бот в чате просит написать
// обращение, переписка идёт там. История обращений — тут же, в приложении.
function SupportLinks() {
  const [busy, setBusy] = useState(false)
  const { data: tickets } = useQuery({ queryKey: ['my-tickets'], queryFn: () => api<MyTicket[]>('/support/my') })
  const open = tickets?.find(t => t.status === 'open')

  const start = async () => {
    setBusy(true)
    try {
      await api('/support/request', { method: 'POST' })
      if (!closeMiniApp()) toast('Бот написал вам в чат — отправьте обращение туда')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card mt-4 divide-y divide-line overflow-hidden">
      <button onClick={start} disabled={busy} className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-paper transition-colors disabled:opacity-60">
        <LifeBuoy className="h-5 w-5 text-brand flex-shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold">Техподдержка</span>
          <span className="block text-xs muted">
            {open ? `Обращение №${open.id} открыто — продолжите в чате с ботом` : 'Напишите нам — ответим в чат с ботом'}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 text-ink-faint" />
      </button>
      <Link to="/support/my" className="w-full px-4 py-3.5 flex items-center gap-3 hover:bg-paper transition-colors">
        <MessagesSquare className="h-5 w-5 text-ink-muted flex-shrink-0" />
        <span className="flex-1 font-semibold">История обращений</span>
        {!!tickets?.length && <span className="text-sm muted">{tickets.length} {plural(tickets.length, 'обращение', 'обращения', 'обращений')}</span>}
        <ChevronRight className="h-4 w-4 text-ink-faint" />
      </Link>
    </div>
  )
}
