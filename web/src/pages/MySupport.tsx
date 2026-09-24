// История обращений сотрудника (мини-апп): список и переписка. Писать — в чате
// с ботом; здесь только просмотр.
import { useCallback } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, MessagesSquare, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { useTelegramBackButton } from '../lib/telegram'
import { plural } from '../lib/format'
import type { MyTicket, SupportMessage, TicketStatus } from '../lib/types'
import { Empty, ErrorBox, PageLoader } from '../components/ui'
import { StatusTag, SupportThread, ticketTime } from '../components/SupportThread'

export function MySupportPage() {
  const { id } = useParams()
  return id ? <MyTicketView id={Number(id)} /> : <MyTicketList />
}

function useBack(to: string) {
  const navigate = useNavigate()
  const back = useCallback(() => navigate(to), [navigate, to])
  useTelegramBackButton(back)
}

function MyTicketList() {
  useBack('/account')
  const { data: tickets, isLoading, error } = useQuery({
    queryKey: ['my-tickets'], queryFn: () => api<MyTicket[]>('/support/my'), refetchOnWindowFocus: true,
  })
  return (
    <div className="max-w-md mx-auto px-4 pt-4 lg:pt-8">
      <Link to="/account" className="btn-ghost btn-sm -ml-2 mb-2"><ArrowLeft className="h-4 w-4" />Профиль</Link>
      <h1 className="h-page">История обращений</h1>
      {isLoading ? <PageLoader /> : error ? <div className="mt-4"><ErrorBox error={error} /></div> : !tickets?.length ? (
        <Empty icon={<MessagesSquare className="h-10 w-10" strokeWidth={1.5} />} title="Обращений пока нет"
          text="Вопрос или проблема — «Техподдержка» в профиле. Ответ придёт в чат с ботом и появится здесь." />
      ) : (
        <ul className="card mt-4 divide-y divide-line overflow-hidden">
          {tickets.map(t => (
            <li key={t.id}>
              <Link to={`/support/my/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">№{t.id}</span>
                    <StatusTag status={t.status} />
                    <span className="text-xs muted ml-auto">{ticketTime(t.updated_at)}</span>
                  </div>
                  <p className="text-[13px] text-ink-2 truncate mt-0.5">{t.first_text}</p>
                  <p className="text-xs muted">{t.message_count} {plural(t.message_count, 'сообщение', 'сообщения', 'сообщений')}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-faint flex-shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface MyTicketFull { id: number; status: TicketStatus; created_at: string; closed_at: string | null; messages: SupportMessage[] }

function MyTicketView({ id }: { id: number }) {
  useBack('/support/my')
  const { data: t, isLoading, error } = useQuery({
    queryKey: ['my-ticket', id], queryFn: () => api<MyTicketFull>(`/support/my/${id}`), refetchOnWindowFocus: true,
  })
  return (
    <div className="max-w-md mx-auto px-4 pt-4 lg:pt-8">
      <Link to="/support/my" className="btn-ghost btn-sm -ml-2 mb-2"><ArrowLeft className="h-4 w-4" />Все обращения</Link>
      {isLoading ? <PageLoader /> : error || !t ? <ErrorBox error={error} /> : (
        <>
          <div className="flex items-center gap-2">
            <h1 className="h-page">Обращение №{t.id}</h1>
            <StatusTag status={t.status} />
          </div>
          <p className="text-xs muted mt-1">
            Создано {ticketTime(t.created_at)}{t.closed_at && ` · закрыто ${ticketTime(t.closed_at)}`}
          </p>
          <div className="mt-4"><SupportThread messages={t.messages} side="user" userLabel="Вы" /></div>
          <p className="text-xs muted text-center mt-5 mb-4">
            {t.status === 'open'
              ? 'Чтобы дописать — отправьте сообщение в чат с ботом, оно добавится сюда.'
              : 'Обращение закрыто. Новый вопрос — «Техподдержка» в профиле.'}
          </p>
        </>
      )}
    </div>
  )
}
