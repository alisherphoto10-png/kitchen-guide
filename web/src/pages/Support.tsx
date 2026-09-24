// Инбокс техподдержки (администратор платформы): обращения всех заведений,
// переписка, ответ (уходит сотруднику в чат с ботом заведения), закрытие.
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell, BellOff, LifeBuoy, Send, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import type { SupportMessage, SupportNotifySettings, SupportTicket } from '../lib/types'
import { Empty, ErrorBox, PageLoader, errText, toast, useConfirm } from '../components/ui'
import { StatusTag, SupportThread, ticketTime } from '../components/SupportThread'
import { SupportNotifyModal } from '../components/SupportNotifyModal'
import { ROLE_LABEL } from '../components/Layout'
import { useIsDesktop } from '../hooks/useMedia'

type Filter = 'open' | 'closed' | ''
const FILTERS: { key: Filter; label: string }[] = [{ key: 'open', label: 'Открытые' }, { key: 'closed', label: 'Закрытые' }, { key: '', label: 'Все' }]

type TicketFull = SupportTicket & { messages: SupportMessage[] }

export function SupportPage() {
  const { id } = useParams()
  const selectedId = id ? Number(id) : null
  const isDesktop = useIsDesktop()
  const [filter, setFilter] = useState<Filter>('open')
  const [notifyOpen, setNotifyOpen] = useState(false)

  const { data: tickets, isLoading, error } = useQuery({
    queryKey: ['support-tickets', filter],
    queryFn: () => api<SupportTicket[]>('/platform/support/tickets' + (filter ? `?status=${filter}` : '')),
    refetchInterval: 20_000,
    placeholderData: prev => prev,
  })
  const { data: notify } = useQuery({ queryKey: ['support-notify'], queryFn: () => api<SupportNotifySettings>('/platform/support/notify') })

  const list = (
    <div className="px-4 lg:px-0 pt-4 lg:pt-0">
      <div className="flex items-center gap-2 mb-3">
        <h1 className="h-page flex-1">Техподдержка</h1>
        <button className="btn-ghost btn-sm" onClick={() => setNotifyOpen(true)} title="Уведомления в Telegram">
          {notify?.configured
            ? <Bell className={`h-4 w-4 ${notify.last_error ? 'text-warn' : 'text-ok'}`} />
            : <BellOff className="h-4 w-4 text-ink-faint" />}
          Уведомления
        </button>
      </div>
      {!notify?.configured && notify && (
        <button onClick={() => setNotifyOpen(true)} className="w-full text-left rounded-xl bg-warn-soft text-warn text-[13px] px-3 py-2 mb-3">
          Уведомления о новых обращениях в Telegram не настроены — нажмите, чтобы подключить.
        </button>
      )}
      <div className="flex gap-1 mb-3">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`chip ${filter === f.key ? 'chip-active' : ''}`}>{f.label}</button>
        ))}
      </div>
      {isLoading ? <PageLoader /> : error ? <ErrorBox error={error} /> : !tickets?.length ? (
        <Empty icon={<LifeBuoy className="h-10 w-10" strokeWidth={1.5} />} title={filter === 'open' ? 'Открытых обращений нет' : 'Обращений нет'}
          text="Сотрудники пишут через «Техподдержка» в профиле мини-аппа или командой /support в боте заведения." />
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {tickets.map(t => {
            const waiting = t.status === 'open' && t.last_author === 'user'
            return (
              <li key={t.id}>
                <Link to={`/support/${t.id}`}
                  className={`block px-4 py-3 transition-colors ${selectedId === t.id ? 'bg-brand-soft/60' : 'hover:bg-paper'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${waiting ? 'font-extrabold' : 'font-bold'}`}>№{t.id}</span>
                    <StatusTag status={t.status} waiting={waiting} />
                    <span className="text-xs muted ml-auto flex-shrink-0">{ticketTime(t.updated_at)}</span>
                  </div>
                  <p className="text-[13px] font-semibold truncate mt-0.5">{t.tenant_name} · {t.user_name || t.user_login}</p>
                  <p className="text-[13px] text-ink-2 truncate">{t.last_author === 'admin' && <span className="muted">Вы: </span>}{t.last_text}</p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  const modal = notifyOpen && <SupportNotifyModal onClose={() => setNotifyOpen(false)} />

  if (isDesktop) {
    return (
      <div className="px-8 pt-8 grid grid-cols-[minmax(300px,380px)_1fr] gap-6 items-start">
        <div className="sticky top-8">{list}</div>
        <div>{selectedId ? <TicketView key={selectedId} id={selectedId} /> : (
          <div className="card"><Empty icon={<LifeBuoy className="h-10 w-10" strokeWidth={1.5} />} title="Выберите обращение слева" /></div>
        )}</div>
        {modal}
      </div>
    )
  }
  return (
    <div className="max-w-2xl mx-auto">
      {selectedId ? <div className="px-4 pt-4"><TicketView key={selectedId} id={selectedId} /></div> : list}
      {modal}
    </div>
  )
}

function TicketView({ id }: { id: number }) {
  const qc = useQueryClient()
  const isDesktop = useIsDesktop()
  const [text, setText] = useState('')
  const [confirm, confirmNode] = useConfirm()
  const bottom = useRef<HTMLDivElement>(null)
  const key = ['support-ticket', id]

  const { data: t, isLoading, error } = useQuery({
    queryKey: key, queryFn: () => api<TicketFull>(`/platform/support/tickets/${id}`), refetchInterval: 10_000,
  })
  const count = t?.messages.length
  useEffect(() => { if (count && !isDesktop) bottom.current?.scrollIntoView({ block: 'end' }) }, [count, isDesktop])

  const done = (data: TicketFull) => {
    qc.setQueryData(key, data)
    qc.invalidateQueries({ queryKey: ['support-tickets'] })
    qc.invalidateQueries({ queryKey: ['support-summary'] })
  }
  const onError = (e: unknown) => toast(errText(e), 'error')
  const reply = useMutation({
    mutationFn: () => api<TicketFull>(`/platform/support/tickets/${id}/reply`, { method: 'POST', body: { text } }),
    onSuccess: d => { done(d); setText(''); toast('Ответ отправлен в Telegram') }, onError,
  })
  const setStatus = useMutation({
    mutationFn: (action: 'close' | 'reopen') => api<TicketFull>(`/platform/support/tickets/${id}/${action}`, { method: 'POST' }),
    onSuccess: d => { done(d); toast(d.status === 'closed' ? 'Обращение закрыто' : 'Обращение снова открыто') }, onError,
  })

  if (isLoading) return <PageLoader />
  if (error || !t) return <ErrorBox error={error} />

  const close = async () => {
    if (text.trim() && !(await confirm({ title: 'Закрыть без ответа?', text: 'В поле ответа есть неотправленный текст — он не уйдёт сотруднику.', ok: 'Закрыть' }))) return
    setStatus.mutate('close')
  }
  const send = () => { if (text.trim() && !reply.isPending) reply.mutate() }

  return (
    <div className="pb-6">
      {!isDesktop && <Link to="/support" className="btn-ghost btn-sm -ml-2 mb-2"><ArrowLeft className="h-4 w-4" />Все обращения</Link>}
      <div className="card p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold">Обращение №{t.id}</h2>
              <StatusTag status={t.status} waiting={t.status === 'open' && t.last_author === 'user'} />
            </div>
            <p className="text-sm mt-0.5"><b>{t.tenant_name}</b> · {t.user_name || t.user_login} <span className="muted">({t.user_login}, {ROLE_LABEL[t.user_role]?.toLowerCase()}{t.user_tg_username ? `, @${t.user_tg_username}` : ''})</span></p>
            <p className="text-xs muted mt-0.5">
              Создано {ticketTime(t.created_at)}
              {t.closed_at && ` · закрыто ${ticketTime(t.closed_at)}${t.closed_by_name ? ` (${t.closed_by_name})` : ''}`}
            </p>
          </div>
          {t.status === 'open'
            ? <button className="btn-outline btn-sm flex-shrink-0" disabled={setStatus.isPending} onClick={close}><CheckCircle2 className="h-4 w-4" />Закрыть</button>
            : <button className="btn-outline btn-sm flex-shrink-0" disabled={setStatus.isPending} onClick={() => setStatus.mutate('reopen')}><RotateCcw className="h-4 w-4" />Открыть снова</button>}
        </div>
      </div>

      <div className="mt-4">
        <SupportThread messages={t.messages} side="admin" userLabel={t.user_name || t.user_login} />
      </div>
      <div ref={bottom} />

      {t.status === 'open' ? (
        <div className="card p-3 mt-4">
          {!t.user_tg_linked && (
            <p className="flex items-start gap-2 text-[13px] text-warn mb-2"><AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />Сотрудник отвязан от Telegram — ответ доставить не получится.</p>
          )}
          <textarea className="input min-h-[88px] resize-y" placeholder="Ответ сотруднику — придёт ему в чат с ботом заведения" value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() } }} />
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs muted flex-1 hidden sm:block">Ctrl+Enter — отправить</span>
            <button className="btn-primary ml-auto" disabled={!text.trim() || reply.isPending} onClick={send}>
              <Send className="h-4 w-4" />{reply.isPending ? 'Отправляем…' : 'Ответить'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm muted text-center mt-5">Обращение закрыто. Чтобы ответить — откройте его снова.</p>
      )}
      {confirmNode}
    </div>
  )
}

