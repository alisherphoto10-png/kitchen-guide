// «Частые вопросы» на странице гида (администратор платформы): список
// вопрос/ответ, порядок, редактирование. Страница гида подхватывает список
// сразу (GET /api/guide/content), без пересборки. Пока вопросов нет — блок
// на странице гида скрыт целиком.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { Spinner, errText, toast, useConfirm } from '../components/ui'

type GuideFaq = { id: number; question: string; answer: string }

const onError = (e: unknown) => toast(errText(e), 'error')

export function FaqPage() {
  const qc = useQueryClient()
  const key = ['guide-faq']
  const { data: faq, isLoading } = useQuery({ queryKey: key, queryFn: () => api<GuideFaq[]>('/platform/guide/faq') })
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [confirm, confirmNode] = useConfirm()
  const refresh = () => qc.invalidateQueries({ queryKey: key })

  const save = useMutation({
    mutationFn: ({ id, question, answer }: { id: number | 'new'; question: string; answer: string }) => id === 'new'
      ? api<GuideFaq>('/platform/guide/faq', { method: 'POST', body: { question, answer } })
      : api<GuideFaq>(`/platform/guide/faq/${id}`, { method: 'PUT', body: { question, answer } }),
    onSuccess: () => { refresh(); setEditing(null); toast('Сохранено — уже на странице гида') },
    onError,
  })
  const remove = useMutation({
    mutationFn: (id: number) => api(`/platform/guide/faq/${id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); toast('Вопрос удалён') }, onError,
  })
  const move = useMutation({
    mutationFn: ({ id, dir }: { id: number; dir: 'up' | 'down' }) => api<GuideFaq[]>(`/platform/guide/faq/${id}/move`, { method: 'POST', body: { dir } }),
    onSuccess: d => qc.setQueryData(key, d), onError,
  })

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 pt-5 lg:pt-8 pb-8 grid gap-4">
      <div className="flex items-center gap-2">
        <h1 className="h-page flex-1">Частые вопросы</h1>
        {editing !== 'new' && <button type="button" className="btn-primary h-9" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Вопрос</button>}
      </div>
      <p className="text-sm text-ink-2 -mt-2">Список показывается на странице гида, который открывают владельцы заведений.</p>
      {editing === 'new' && <FaqForm busy={save.isPending} onCancel={() => setEditing(null)} onSave={(q, a) => save.mutate({ id: 'new', question: q, answer: a })} />}
      {isLoading || !faq ? <div className="flex justify-center py-6"><Spinner /></div> : !faq.length ? (
        editing !== 'new' && <p className="text-sm muted">Вопросов пока нет — блок «Частые вопросы» на странице гида скрыт.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {faq.map((f, i) => (
            <li key={f.id} className="p-3">
              {editing === f.id ? (
                <FaqForm initial={f} busy={save.isPending} onCancel={() => setEditing(null)} onSave={(q, a) => save.mutate({ id: f.id, question: q, answer: a })} />
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{f.question}</p>
                    <p className="text-[13px] text-ink-2 whitespace-pre-line line-clamp-3 mt-0.5">{f.answer}</p>
                  </div>
                  <div className="flex items-start gap-0.5 flex-shrink-0">
                    <button type="button" className="btn-ghost btn-sm w-7 px-0" disabled={i === 0 || move.isPending} onClick={() => move.mutate({ id: f.id, dir: 'up' })} aria-label="Выше"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" className="btn-ghost btn-sm w-7 px-0" disabled={i === faq.length - 1 || move.isPending} onClick={() => move.mutate({ id: f.id, dir: 'down' })} aria-label="Ниже"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" className="btn-ghost btn-sm w-7 px-0" onClick={() => setEditing(f.id)} aria-label="Изменить"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" className="btn-ghost btn-sm w-7 px-0 text-bad" aria-label="Удалить" onClick={async () => {
                      if (await confirm({ title: 'Удалить вопрос?', text: f.question, ok: 'Удалить', danger: true })) remove.mutate(f.id)
                    }}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmNode}
    </div>
  )
}

function FaqForm({ initial, busy, onSave, onCancel }: { initial?: GuideFaq; busy: boolean; onSave: (q: string, a: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState(initial?.question || '')
  const [a, setA] = useState(initial?.answer || '')
  return (
    <form className="grid gap-2 rounded-xl border border-line p-3 bg-paper" onSubmit={e => { e.preventDefault(); onSave(q, a) }}>
      <label><span className="field-label">Вопрос</span>
        <input className="input" maxLength={300} value={q} onChange={e => setQ(e.target.value)} autoFocus />
      </label>
      <label><span className="field-label">Ответ</span>
        <textarea className="input min-h-[96px] py-2" maxLength={4000} value={a} onChange={e => setA(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>Отмена</button>
        <button className="btn-primary btn-sm" disabled={busy || !q.trim() || !a.trim()}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </form>
  )
}
