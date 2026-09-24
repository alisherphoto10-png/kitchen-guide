// Ссылка на гид для владельцев — одна настройка платформы. Пустое поле скрывает
// гид везде (вход, меню, профиль мини-аппа, команда /guide у ботов заведений).
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookMarked } from 'lucide-react'
import { api } from '../lib/api'
import { Modal, Spinner, errText, toast } from './ui'

type GuideSettings = { url: string; default_url: string; bots_sync?: { total: number; changed: number; failed: number } }

export function GuideModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: s, isLoading } = useQuery({ queryKey: ['guide-settings'], queryFn: () => api<GuideSettings>('/platform/guide') })
  const [url, setUrl] = useState('')
  useEffect(() => { if (s) setUrl(s.url) }, [s])

  const save = useMutation({
    mutationFn: (value: string) => api<GuideSettings>('/platform/guide', { method: 'PUT', body: { url: value } }),
    onSuccess: d => {
      qc.setQueryData(['guide-settings'], d)
      qc.setQueryData(['guide'], { url: d.url })
      setUrl(d.url)
      const b = d.bots_sync
      const bots = b && b.total ? ` Меню ботов: обновлено ${b.changed} из ${b.total}${b.failed ? `, не удалось ${b.failed}` : ''}.` : ''
      toast((d.url ? 'Ссылка сохранена.' : 'Гид скрыт.') + bots, b?.failed ? 'error' : 'ok')
    },
    onError: e => toast(errText(e), 'error'),
  })

  return (
    <Modal title={<span className="flex items-center gap-2"><BookMarked className="h-4 w-4 text-brand" />Гид для владельцев</span>} onClose={onClose}>
      {isLoading || !s ? <div className="flex justify-center py-8"><Spinner /></div> : (
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); save.mutate(url) }}>
          <p className="text-sm text-ink-2">
            Ссылка «Как это работает» и «Частые вопросы». Показывается на странице входа, в меню и профиле сайта,
            в профиле мини-аппа и по команде /guide в ботах заведений. Пустое поле — гид скрыт везде.
          </p>
          <label>
            <span className="field-label">Ссылка</span>
            <input className="input" type="url" inputMode="url" placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)} />
          </label>
          {s.url !== s.default_url && (
            <button type="button" className="text-left text-[13px] text-brand underline-offset-2 hover:underline" onClick={() => setUrl(s.default_url)}>
              Вставить ссылку по умолчанию
            </button>
          )}
          <button className="btn-primary" disabled={save.isPending || url.trim() === s.url}>
            {save.isPending ? 'Сохраняем…' : url.trim() ? 'Сохранить' : 'Сохранить — скрыть гид'}
          </button>
        </form>
      )}
    </Modal>
  )
}
