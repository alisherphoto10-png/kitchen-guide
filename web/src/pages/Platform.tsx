import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, LogIn, Building2 } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { relDate } from '../lib/format'
import type { PlatformTenant } from '../lib/types'
import { Empty, ErrorBox, Modal, PageLoader, SecretReveal, errText, toast, useConfirm } from '../components/ui'

// Транслитерация названия в идентификатор-подсказку (его потом можно поправить руками).
const TR: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' }
const slugify = (s: string) => s.toLowerCase().split('').map(c => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export function PlatformPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { enterTenant } = useSession()
  const { data: tenants, isLoading, error } = useQuery({ queryKey: ['platform-tenants'], queryFn: () => api<PlatformTenant[]>('/platform/tenants') })
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState<{ name: string; login: string; password: string } | null>(null)
  const [confirm, confirmNode] = useConfirm()

  const toggle = useMutation({
    mutationFn: (t: PlatformTenant) => api(`/platform/tenants/${t.id}`, { method: 'PUT', body: { is_active: !t.is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform-tenants'] }),
    onError: e => toast(errText(e), 'error'),
  })

  const enter = (t: PlatformTenant) => { enterTenant(t.id); navigate('/recipes') }

  return (
    <div className="max-w-4xl mx-auto px-4 lg:px-8 pt-5 lg:pt-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="h-page">Заведения</h1>
        <button className="btn-primary h-9" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Заведение</button>
      </div>
      <p className="text-sm muted mt-1 mb-5">Клиенты платформы. У каждого свои ТТК, категории и команда — данные не пересекаются.</p>

      {isLoading ? <PageLoader /> : error ? <ErrorBox error={error} /> : !tenants?.length ? (
        <Empty icon={<Building2 className="h-8 w-8" />} title="Заведений пока нет" text="Создайте первое — вместе с ним появится логин владельца." />
      ) : (
        <ul className="card divide-y divide-line">
          {tenants.map(t => (
            <li key={t.id} className={`px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${t.is_active ? '' : 'opacity-60'}`}>
              <div className="flex-1 min-w-[200px]">
                <p className="font-semibold">{t.name} {!t.is_active && <span className="tag bg-ink text-paper ml-1">приостановлено</span>}</p>
                <p className="text-xs muted">{t.slug} · {t.recipe_count} ТТК · {t.user_count} сотр. · активность {relDate(t.last_activity_at)}</p>
              </div>
              <button className="btn-ghost btn-sm" onClick={async () => {
                if (t.is_active && !(await confirm({ title: `Приостановить «${t.name}»?`, text: 'Все сотрудники заведения сразу потеряют доступ. Данные сохранятся, включить обратно можно в любой момент.', ok: 'Приостановить', danger: true }))) return
                toggle.mutate(t)
              }}>{t.is_active ? 'Приостановить' : 'Включить'}</button>
              <button className="btn-outline btn-sm" onClick={() => enter(t)}><LogIn className="h-3.5 w-3.5" />Войти</button>
            </li>
          ))}
        </ul>
      )}

      {adding && <AddTenant onClose={() => setAdding(false)} onCreated={c => { setAdding(false); setCreated(c) }} />}
      {created && (
        <Modal title={`«${created.name}» создано`} onClose={() => setCreated(null)} footer={<button className="btn-primary" onClick={() => setCreated(null)}>Готово</button>}>
          <SecretReveal label="Доступ владельца — передайте клиенту. Пароль больше не покажется." login={created.login} password={created.password} />
        </Modal>
      )}
      {confirmNode}
    </div>
  )
}

function AddTenant({ onClose, onCreated }: { onClose: () => void; onCreated: (c: { name: string; login: string; password: string }) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', slug: '', ownerName: '', ownerLogin: '' })
  const [slugTouched, setSlugTouched] = useState(false)
  const create = useMutation({
    mutationFn: () => api<{ tenant: PlatformTenant; owner: { login: string; password: string } }>('/platform/tenants', { method: 'POST', body: f }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['platform-tenants'] }); onCreated({ name: r.tenant.name, ...r.owner }) },
    onError: e => toast(errText(e), 'error'),
  })
  return (
    <Modal title="Новое заведение" onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!f.name.trim() || !f.slug || !f.ownerLogin || create.isPending} onClick={() => create.mutate()}>Создать</button>
      </>}>
      <div className="grid gap-4">
        <label><span className="field-label">Название</span>
          <input className="input" autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} />
        </label>
        <label><span className="field-label">Идентификатор (латиница)</span>
          <input className="input font-mono" value={f.slug} onChange={e => { setSlugTouched(true); setF({ ...f, slug: e.target.value.toLowerCase() }) }} />
          <span className="text-xs muted mt-1 block">Понадобится для ссылки на мини-апп бота. Лучше не менять потом.</span>
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className="field-label">Имя владельца</span><input className="input" value={f.ownerName} onChange={e => setF({ ...f, ownerName: e.target.value })} /></label>
          <label><span className="field-label">Логин владельца</span>
            <input className="input" autoCapitalize="none" spellCheck={false} value={f.ownerLogin} onChange={e => setF({ ...f, ownerLogin: e.target.value.toLowerCase() })} />
          </label>
        </div>
      </div>
    </Modal>
  )
}
