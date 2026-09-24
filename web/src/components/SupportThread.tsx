// Переписка по обращению — пузыри сообщений. side — чьи сообщения справа
// («мои»): сотрудник видит свои справа, администратор — ответы поддержки.
import type { SupportMessage, TicketStatus } from '../lib/types'

function time(iso: string) {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function StatusTag({ status, waiting }: { status: TicketStatus; waiting?: boolean }) {
  if (status === 'closed') return <span className="tag bg-paper-2 text-ink-muted">закрыто</span>
  if (waiting) return <span className="tag bg-brand-soft text-brand-ink">ждёт ответа</span>
  return <span className="tag bg-ok-soft text-ok">открыто</span>
}

export function SupportThread({ messages, side, userLabel }: { messages: SupportMessage[]; side: 'user' | 'admin'; userLabel: string }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {messages.map(m => {
        const mine = m.author === side
        const label = m.author === 'user' ? userLabel : (side === 'admin' ? (m.author_name || m.author_login || 'Поддержка') : 'Техподдержка')
        return (
          <li key={m.id} className={`flex flex-col max-w-[88%] ${mine ? 'self-end items-end' : 'self-start items-start'}`}>
            <span className="text-[11px] muted px-1 mb-0.5">{label} · {time(m.created_at)}</span>
            <div className={`rounded-2xl px-3.5 py-2.5 text-[14px] leading-snug whitespace-pre-wrap break-words
              ${mine ? 'bg-brand text-white rounded-br-md' : 'bg-paper-card border border-line rounded-bl-md'}`}>
              {m.text}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function ticketTime(iso: string) {
  return time(iso)
}
