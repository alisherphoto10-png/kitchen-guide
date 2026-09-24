// Гид для владельцев (администратор платформы): ссылка (одна настройка;
// пустое поле скрывает гид везде — вход, меню, профиль мини-аппа, /guide в
// ботах) и свои фото вместо заглушек блюд на странице /guide/. Вопросы
// «Частые вопросы» — отдельная страница, см. pages/Faq.tsx.
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, ImagePlus, RotateCcw } from 'lucide-react'
import { api, upload } from '../lib/api'
import { Spinner, errText, toast, useConfirm } from '../components/ui'

type GuideSettings = { url: string; default_url: string; bots_sync?: { total: number; changed: number; failed: number } }
type GuidePhoto = { slot: string; label: string; default: string; cutout: boolean; url: string | null }

const onError = (e: unknown) => toast(errText(e), 'error')

export function GuidePage() {
  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 pt-5 lg:pt-8 pb-8 grid gap-7">
      <h1 className="h-page">Гид для владельцев</h1>
      <LinkSection />
      <PhotosSection />
    </div>
  )
}

function LinkSection() {
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
    onError,
  })

  if (isLoading || !s) return <div className="flex justify-center py-8"><Spinner /></div>
  return (
    <form className="card p-4 grid gap-3" onSubmit={e => { e.preventDefault(); save.mutate(url) }}>
      <div className="flex items-center gap-2">
        <h3 className="font-bold flex-1">Ссылка</h3>
        {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm"><ExternalLink className="h-3.5 w-3.5" />Открыть гид</a>}
      </div>
      <p className="text-sm text-ink-2">
        Показывается на странице входа, в меню и профиле сайта, в профиле мини-аппа и по команде /guide в ботах
        заведений. Пустое поле — гид скрыт везде.
      </p>
      <input className="input" type="url" inputMode="url" placeholder="https://…" aria-label="Ссылка на гид" value={url} onChange={e => setUrl(e.target.value)} />
      {s.default_url && s.url !== s.default_url && (
        <button type="button" className="text-left text-[13px] text-brand underline-offset-2 hover:underline" onClick={() => setUrl(s.default_url)}>
          Вставить ссылку по умолчанию
        </button>
      )}
      <button className="btn-primary" disabled={save.isPending || url.trim() === s.url}>
        {save.isPending ? 'Сохраняем…' : url.trim() ? 'Сохранить' : 'Сохранить — скрыть гид'}
      </button>
    </form>
  )
}

function PhotosSection() {
  const qc = useQueryClient()
  const key = ['guide-photos']
  const { data: photos, isLoading } = useQuery({ queryKey: key, queryFn: () => api<GuidePhoto[]>('/platform/guide/photos') })
  const [busySlot, setBusySlot] = useState<string | null>(null)
  const [confirm, confirmNode] = useConfirm()

  const run = async (slot: string, fn: () => Promise<GuidePhoto[]>, msg: string) => {
    setBusySlot(slot)
    try {
      qc.setQueryData(key, await fn())
      toast(msg)
    } catch (e) {
      onError(e)
    } finally {
      setBusySlot(null)
    }
  }
  const put = (p: GuidePhoto, file: File) => run(p.slot, () => upload<GuidePhoto[]>(`/platform/guide/photos/${p.slot}`, 'photo', file), 'Фото загружено — уже на странице гида')
  const reset = async (p: GuidePhoto) => {
    if (await confirm({ title: 'Вернуть заглушку?', text: `«${p.label}» снова покажет встроенное фото.`, ok: 'Вернуть' })) {
      run(p.slot, () => api<GuidePhoto[]>(`/platform/guide/photos/${p.slot}`, { method: 'DELETE' }), 'Возвращена заглушка')
    }
  }

  return (
    <section className="card p-4 grid gap-3">
      <h3 className="font-bold">Фото на странице гида</h3>
      <p className="text-sm text-ink-2">
        Свои фото вместо блюд-заглушек. JPG, PNG или WebP до 8 МБ. Для мест с пометкой «без фона» лучше PNG
        с прозрачным фоном — там тарелка стоит прямо на странице.
      </p>
      {isLoading || !photos ? <div className="flex justify-center py-6"><Spinner /></div> : (
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {photos.map(p => <PhotoSlot key={p.slot} p={p} busy={busySlot === p.slot} onFile={f => put(p, f)} onReset={() => reset(p)} />)}
        </ul>
      )}
      {confirmNode}
    </section>
  )
}

function PhotoSlot({ p, busy, onFile, onReset }: { p: GuidePhoto; busy: boolean; onFile: (f: File) => void; onReset: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <li className="grid gap-1.5 content-start">
      <div className={`relative aspect-square rounded-xl overflow-hidden border border-line ${p.cutout ? 'bg-paper-2' : 'bg-paper'}`}>
        <img src={p.url || p.default} alt="" className={`h-full w-full ${p.cutout ? 'object-contain p-2' : 'object-cover'}`} />
        {!p.url && <span className="absolute left-1.5 top-1.5 rounded-full bg-paper-card/90 px-2 py-0.5 text-[11px] font-semibold text-ink-muted">заглушка</span>}
        {busy && <div className="absolute inset-0 grid place-items-center bg-paper-card/70"><Spinner /></div>}
      </div>
      <p className="text-[13px] font-semibold leading-tight">{p.label}</p>
      {p.cutout && <p className="text-[11px] muted -mt-1">без фона</p>}
      <div className="flex gap-1">
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label={`Фото: ${p.label}`}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
        <button type="button" className="btn-outline btn-sm flex-1" disabled={busy} onClick={() => input.current?.click()}>
          <ImagePlus className="h-3.5 w-3.5" />{p.url ? 'Заменить' : 'Загрузить'}
        </button>
        {p.url && (
          <button type="button" className="btn-ghost btn-sm px-2" disabled={busy} onClick={onReset} title="Вернуть заглушку" aria-label={`Сбросить: ${p.label}`}>
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  )
}
