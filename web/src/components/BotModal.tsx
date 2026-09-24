// Бот заведения: подключение по токену от @BotFather, состояние вебхука,
// выключение/включение, замена токена, удаление. Только администратор платформы.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, ExternalLink, Power, RefreshCw, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api'
import { relDate } from '../lib/format'
import type { BotStatus, PlatformTenant } from '../lib/types'
import { Modal, Spinner, errText, toast, useConfirm } from './ui'

export function TokenField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <label className="block">
      <span className="field-label">Токен от @BotFather</span>
      <input className="input font-mono text-[13px]" value={value} onChange={e => onChange(e.target.value.trim())}
        placeholder="123456789:AAH…" autoComplete="off" spellCheck={false} autoFocus={autoFocus} />
    </label>
  )
}

export function BotFatherHelp() {
  return (
    <ol className="text-[13px] text-ink-2 list-decimal pl-5 space-y-0.5">
      <li>Откройте <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-brand font-semibold">@BotFather</a> в Telegram.</li>
      <li>Команда <code className="font-mono">/newbot</code> → имя (например, «ТТК Жигули-бар») → username, оканчивающийся на <code className="font-mono">bot</code>.</li>
      <li>Скопируйте токен из ответа и вставьте сюда. Вебхук и кнопку меню настроим сами.</li>
    </ol>
  )
}

export function BotModal({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const qc = useQueryClient()
  const key = ['platform-bot', tenant.id]
  const { data: bot, isLoading } = useQuery({ queryKey: key, queryFn: () => api<BotStatus | null>(`/platform/tenants/${tenant.id}/bot`) })
  const [token, setToken] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [confirm, confirmNode] = useConfirm()

  const done = (msg: string) => (data?: BotStatus | null) => {
    toast(msg)
    if (data !== undefined) qc.setQueryData(key, data)
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['platform-tenants'] })
    setToken('')
    setReplacing(false)
  }
  const onError = (e: unknown) => toast(errText(e), 'error')

  const connect = useMutation({
    mutationFn: () => api<BotStatus>(`/platform/tenants/${tenant.id}/bot`, { method: 'PUT', body: { token } }),
    onSuccess: b => done(`@${b.username} подключён`)(b), onError,
  })
  const toggle = useMutation({
    mutationFn: (on: boolean) => api<BotStatus>(`/platform/tenants/${tenant.id}/bot/${on ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: b => done(b.is_active ? 'Бот включён' : 'Бот отключён')(b), onError,
  })
  const remove = useMutation({
    mutationFn: () => api(`/platform/tenants/${tenant.id}/bot`, { method: 'DELETE' }),
    onSuccess: () => done('Бот удалён')(null), onError,
  })
  const busy = connect.isPending || toggle.isPending || remove.isPending

  const tokenForm = (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (token) connect.mutate() }}>
      <TokenField value={token} onChange={setToken} autoFocus />
      <button className="btn-primary" disabled={!token || busy}>{connect.isPending ? 'Проверяем в Telegram…' : replacing ? 'Заменить токен' : 'Подключить'}</button>
    </form>
  )

  return (
    <Modal title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-brand" />Бот · {tenant.name}</span>} onClose={onClose}>
      {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : !bot ? (
        <div className="grid gap-4">
          <p className="text-sm text-ink-2">У заведения ещё нет бота. Через бота сотрудники открывают ТТК в Telegram — мини-приложением, без логина и пароля.</p>
          <BotFatherHelp />
          {tokenForm}
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${bot.is_active ? 'bg-ok-soft text-ok' : 'bg-paper-2 text-ink-muted'}`}><Bot className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <a href={bot.bot_link} target="_blank" rel="noreferrer" className="font-bold inline-flex items-center gap-1 hover:text-brand">@{bot.username}<ExternalLink className="h-3.5 w-3.5" /></a>
              <p className="text-xs muted">токен …{bot.token_last4} · подключён {relDate(bot.created_at)} · последнее сообщение {relDate(bot.last_update_at)}</p>
            </div>
            <span className={`tag ${bot.is_active ? 'bg-ok-soft text-ok' : 'bg-ink text-paper'}`}>{bot.is_active ? 'работает' : 'отключён'}</span>
          </div>

          <WebhookState bot={bot} />

          {bot.mini_app_link && bot.is_active && (
            <div className="rounded-xl bg-paper-2/60 px-3 py-2.5 text-[13px]">
              <p className="muted mb-0.5">Прямая ссылка на мини-апп этого заведения:</p>
              <code className="font-mono break-all select-all">{bot.mini_app_link}</code>
              <p className="muted mt-1">Работает, если у бота в @BotFather включено Main Mini App. Кнопка «ТТК» в меню бота работает в любом случае.</p>
            </div>
          )}

          {replacing ? (
            <div className="rounded-xl border border-line p-3 grid gap-3">
              <p className="text-[13px] text-ink-2">Новый токен того же бота (после «Revoke» в @BotFather) или токен другого бота — старый при этом замолчит.</p>
              {tokenForm}
              <button className="btn-ghost btn-sm justify-self-start" onClick={() => { setReplacing(false); setToken('') }}>Отмена</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {bot.is_active ? (
                <button className="btn-outline btn-sm" disabled={busy} onClick={async () => {
                  if (await confirm({ title: `Отключить @${bot.username}?`, text: 'Бот перестанет отвечать, мини-апп перестанет пускать сотрудников. Токен и привязки сотрудников сохранятся — включить обратно можно в любой момент.', ok: 'Отключить', danger: true })) toggle.mutate(false)
                }}><Power className="h-3.5 w-3.5" />Отключить</button>
              ) : (
                <button className="btn-primary btn-sm" disabled={busy} onClick={() => toggle.mutate(true)}><Power className="h-3.5 w-3.5" />{toggle.isPending ? 'Включаем…' : 'Включить'}</button>
              )}
              <button className="btn-outline btn-sm" disabled={busy} onClick={() => setReplacing(true)}><RefreshCw className="h-3.5 w-3.5" />Заменить токен</button>
              <button className="btn-danger btn-sm ml-auto" disabled={busy} onClick={async () => {
                if (await confirm({ title: `Удалить @${bot.username} из заведения?`, text: 'Вебхук снимем, токен сотрём. Привязки Telegram у сотрудников останутся — пригодятся, если подключить бота снова.', ok: 'Удалить', danger: true })) remove.mutate()
              }}><Trash2 className="h-3.5 w-3.5" />Удалить</button>
            </div>
          )}
        </div>
      )}
      {confirmNode}
    </Modal>
  )
}

function WebhookState({ bot }: { bot: BotStatus }) {
  const t = bot.telegram
  if (bot.last_error) return <Alert text={bot.last_error} />
  if (!t) return null
  if (t.error) return <Alert text={`Не удалось проверить бота в Telegram: ${t.error}`} />
  if (!bot.is_active) return null
  if (!t.webhook_ok) return <Alert text="Вебхук в Telegram указывает не на нас (возможно, токен используется где-то ещё). Нажмите «Отключить», затем «Включить» — вебхук настроится заново." />
  if (t.last_error_message) return <Alert text={`Telegram сообщает об ошибке доставки${t.last_error_date ? ` (${relDate(t.last_error_date)})` : ''}: ${t.last_error_message}`} />
  return (
    <p className="flex items-center gap-1.5 text-[13px] text-ok"><CheckCircle2 className="h-4 w-4" />Вебхук настроен, Telegram доставляет сообщения{t.pending_update_count ? ` (в очереди ${t.pending_update_count})` : ''}.</p>
  )
}

function Alert({ text }: { text: string }) {
  return <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn"><AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />{text}</p>
}
