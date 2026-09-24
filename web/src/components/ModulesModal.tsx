// Платные модули заведения: включаются вручную администратором платформы после оплаты.
// Список модулей приходит с сервера (реестр server/src/modules.js) — новый модуль
// появится здесь без правок этого файла.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Puzzle } from 'lucide-react'
import { api } from '../lib/api'
import type { PlatformTenant, TenantModule } from '../lib/types'
import { Modal, Spinner, errText, toast } from './ui'

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
      className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-ok' : 'bg-line-strong'}`}>
      <span className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export function ModulesModal({ tenant, onClose }: { tenant: PlatformTenant; onClose: () => void }) {
  const qc = useQueryClient()
  const key = ['platform-modules', tenant.id]
  const { data: modules, isLoading } = useQuery({ queryKey: key, queryFn: () => api<TenantModule[]>(`/platform/tenants/${tenant.id}/modules`) })

  const toggle = useMutation({
    mutationFn: (m: TenantModule) => api<TenantModule[]>(`/platform/tenants/${tenant.id}/modules/${m.key}`, { method: 'PUT', body: { enabled: !m.enabled } }),
    onSuccess: (list, m) => {
      qc.setQueryData(key, list)
      qc.invalidateQueries({ queryKey: ['platform-tenants'] })
      toast(`«${m.title}» ${m.enabled ? 'выключен' : 'включён'} для ${tenant.name}`)
    },
    onError: e => toast(errText(e), 'error'),
  })

  return (
    <Modal title={<span className="flex items-center gap-2"><Puzzle className="h-4 w-4 text-brand" />Модули · {tenant.name}</span>} onClose={onClose}>
      <p className="text-sm text-ink-2 mb-4">Платные функции. Новые заведения получают их выключенными — включите после оплаты. Выключенная функция остаётся на экране, но заблокирована с подсказкой «обратитесь к администратору». Базовые ТТК (карточки, поиск, состав) работают всегда.</p>
      {isLoading ? <div className="flex justify-center py-6"><Spinner /></div> : (
        <ul className="grid gap-2">
          {modules!.map(m => (
            <li key={m.key} className={`rounded-xl border px-3 py-3 flex items-start gap-3 ${m.enabled ? 'border-ok/40 bg-ok-soft/40' : 'border-line'}`}>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{m.title}</p>
                <p className="text-[13px] text-ink-2">{m.description}</p>
                {m.changed_at && (
                  <p className="text-xs muted mt-1">
                    {m.enabled ? 'Включён' : 'Выключен'} {new Date(m.changed_at).toLocaleDateString('ru-RU')}{m.changed_by ? ` · ${m.changed_by}` : ''}
                  </p>
                )}
              </div>
              <Switch checked={m.enabled} disabled={toggle.isPending} onChange={() => toggle.mutate(m)} label={m.title} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
