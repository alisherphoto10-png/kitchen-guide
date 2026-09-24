// Куда слать уведомления о новых обращениях: отдельный бот платформы + группа/тема
// (или личка с этим ботом). Чат находим по getUpdates бота — chat_id вручную не ищем.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Search, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { relDate } from '../lib/format'
import type { NotifyChat, SupportNotifySettings } from '../lib/types'
import { Modal, Spinner, errText, toast, useConfirm } from './ui'
import { TokenField } from './BotModal'

export function SupportNotifyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const key = ['support-notify']
  const { data: s, isLoading } = useQuery({ queryKey: key, queryFn: () => api<SupportNotifySettings>('/platform/support/notify') })
  const [token, setToken] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [chats, setChats] = useState<NotifyChat[] | null>(null)
  const [confirm, confirmNode] = useConfirm()

  const saved = (msg: string) => (data: SupportNotifySettings) => {
    qc.setQueryData(key, data)
    toast(msg)
  }
  const onError = (e: unknown) => toast(errText(e), 'error')

  const setBot = useMutation({
    mutationFn: () => api<SupportNotifySettings>('/platform/support/notify/bot', { method: 'PUT', body: { token } }),
    onSuccess: d => { saved(`@${d.bot_username} подключён`)(d); setToken(''); setReplacing(false); setChats(null) }, onError,
  })
  const find = useMutation({
    mutationFn: () => api<NotifyChat[]>('/platform/support/notify/chats'),
    onSuccess: setChats, onError,
  })
  const setChat = useMutation({
    mutationFn: (c: NotifyChat) => api<SupportNotifySettings>('/platform/support/notify/chat', {
      method: 'PUT', body: { chat_id: c.chat_id, thread_id: c.thread_id, chat_title: c.topic ? `${c.title} → ${c.topic}` : c.title },
    }),
    onSuccess: d => { saved('Готово — пробное сообщение отправлено в чат')(d); setChats(null) }, onError,
  })
  const remove = useMutation({
    mutationFn: () => api<SupportNotifySettings>('/platform/support/notify', { method: 'DELETE' }),
    onSuccess: saved('Уведомления отключены'), onError,
  })

  const hasBot = !!s?.bot_username
  const tokenForm = (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (token) setBot.mutate() }}>
      <TokenField value={token} onChange={setToken} autoFocus />
      <button className="btn-primary" disabled={!token || setBot.isPending}>{setBot.isPending ? 'Проверяем…' : hasBot ? 'Заменить бота' : 'Подключить'}</button>
    </form>
  )

  return (
    <Modal title={<span className="flex items-center gap-2"><Bell className="h-4 w-4 text-brand" />Уведомления об обращениях</span>} onClose={onClose}>
      {isLoading || !s ? <div className="flex justify-center py-8"><Spinner /></div> : (
        <div className="grid gap-5">
          <p className="text-sm text-ink-2">
            О каждом новом обращении и сообщении в открытом бот пришлёт уведомление в выбранную группу или тему —
            сайт не нужно держать открытым. Отвечать — здесь, на сайте.
          </p>

          <section>
            <h3 className="text-sm font-bold mb-2">1. Бот для уведомлений</h3>
            {hasBot && !replacing ? (
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-ok" />
                <span className="flex-1">@{s.bot_username} <span className="muted font-mono text-xs">…{s.token_last4}</span></span>
                <button className="btn-ghost btn-sm" onClick={() => setReplacing(true)}>Заменить</button>
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="text-[13px] text-ink-2">
                  Создайте в <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-brand font-semibold">@BotFather</a> отдельного
                  бота (например, «Калькуляции — поддержка») и вставьте его токен. Бот заведения сюда не подойдёт.
                </p>
                {tokenForm}
                {replacing && <button className="btn-ghost btn-sm justify-self-start" onClick={() => { setReplacing(false); setToken('') }}>Отмена</button>}
              </div>
            )}
          </section>

          {hasBot && (
            <section>
              <h3 className="text-sm font-bold mb-2">2. Куда слать</h3>
              {s.chat_id ? (
                <div className="rounded-xl border border-line px-3 py-2.5 mb-3 text-sm">
                  <p className="font-semibold">{s.chat_title || s.chat_id}</p>
                  {s.last_error
                    ? <p className="flex items-start gap-1.5 text-[13px] text-warn mt-1"><AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />Не доставлено {relDate(s.last_error_at || null)}: {s.last_error}</p>
                    : <p className="text-xs muted mt-0.5">Работает{s.last_ok_at ? ` · проверено ${relDate(s.last_ok_at)}` : ''}</p>}
                </div>
              ) : <p className="text-[13px] text-warn mb-3">Чат ещё не выбран — уведомления не отправляются.</p>}

              <ol className="text-[13px] text-ink-2 list-decimal pl-5 space-y-0.5 mb-3">
                <li>Добавьте @{s.bot_username} в группу (или откройте с ним личный чат).</li>
                <li>В нужной теме группы отправьте <code className="font-mono">/start@{s.bot_username}</code> (в личке — просто <code className="font-mono">/start</code>).</li>
                <li>Нажмите «Найти чаты» и выберите нужный — туда придёт пробное сообщение.</li>
              </ol>
              <button className="btn-outline btn-sm" onClick={() => find.mutate()} disabled={find.isPending}>
                <Search className="h-4 w-4" />{find.isPending ? 'Ищем…' : 'Найти чаты'}
              </button>

              {chats && (
                chats.length === 0 ? (
                  <p className="text-[13px] muted mt-3">Бот пока ничего не видел. Отправьте команду из шага 2 и нажмите «Найти» ещё раз.</p>
                ) : (
                  <ul className="grid gap-1.5 mt-3">
                    {chats.map(c => (
                      <li key={`${c.chat_id}:${c.thread_id || ''}`}>
                        <button className="w-full text-left rounded-xl border border-line px-3 py-2 hover:bg-paper disabled:opacity-60"
                          disabled={setChat.isPending} onClick={() => setChat.mutate(c)}>
                          <span className="block text-sm font-semibold">{c.title}{c.topic && <span className="text-brand"> → {c.topic}</span>}</span>
                          <span className="block text-xs muted">{c.type === 'private' ? 'личный чат' : c.thread_id ? 'тема группы' : 'группа'} · {c.chat_id}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </section>
          )}

          {hasBot && (
            <button className="btn-ghost btn-sm justify-self-start text-bad" disabled={remove.isPending} onClick={async () => {
              if (await confirm({ title: 'Отключить уведомления?', text: 'Бот и выбранный чат будут забыты. Обращения продолжат приходить на сайт.', ok: 'Отключить', danger: true })) remove.mutate()
            }}><Trash2 className="h-4 w-4" />Отключить уведомления</button>
          )}
        </div>
      )}
      {confirmNode}
    </Modal>
  )
}
