import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, KeyRound, Send } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { relDate } from '../lib/format'
import type { Role, User } from '../lib/types'
import { ErrorBox, Modal, PageLoader, SecretReveal, errText, toast, useConfirm } from '../components/ui'
import { ROLE_LABEL } from '../components/Layout'

const ROLE_HINT: Record<Role, string> = {
  owner: 'всё, включая команду',
  editor: 'создаёт и правит ТТК, выгружает',
  viewer: 'смотрит и пересчитывает',
}

export function TeamPage() {
  const qc = useQueryClient()
  const { me } = useSession()
  const { data: users, isLoading, error } = useQuery({ queryKey: ['team'], queryFn: () => api<User[]>('/team') })
  const [adding, setAdding] = useState(false)
  const [secret, setSecret] = useState<{ login: string; password: string; title: string } | null>(null)
  const [confirm, confirmNode] = useConfirm()
  const [invite, setInvite] = useState<{ name: string; url: string; expires_at: string } | null>(null)
  const onError = (e: unknown) => toast(errText(e), 'error')
  const bot = me?.tenant?.bot
  const botOn = !!bot?.is_active

  const tgLink = useMutation({
    mutationFn: (u: User) => api<{ url: string; expires_at: string }>(`/team/${u.id}/telegram-link`, { method: 'POST' }).then(r => ({ ...r, name: u.name || u.login })),
    onSuccess: r => setInvite(r), onError,
  })
  const tgUnlink = useMutation({
    mutationFn: (u: User) => api(`/team/${u.id}/telegram`, { method: 'DELETE' }),
    onSuccess: () => { toast('Telegram отвязан'); qc.invalidateQueries({ queryKey: ['team'] }) }, onError,
  })

  const update = useMutation({
    mutationFn: (p: { id: number; body: Partial<User> }) => api<User>('/team/' + p.id, { method: 'PUT', body: p.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }), onError,
  })
  const reset = useMutation({
    mutationFn: (u: User) => api<{ password: string }>(`/team/${u.id}/reset-password`, { method: 'POST' }).then(r => ({ ...r, login: u.login })),
    onSuccess: r => setSecret({ login: r.login, password: r.password, title: 'Новый пароль' }), onError,
  })

  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-8 pt-5 lg:pt-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="h-page">Команда</h1>
        <button className="btn-primary h-9" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" />Сотрудник</button>
      </div>
      <p className="text-sm muted mt-1 mb-5">
        Каждому — свой логин. Пароль показывается один раз при создании или сбросе.
        {botOn
          ? <> Через бота <a href={`https://t.me/${bot!.username}`} target="_blank" rel="noreferrer" className="text-brand font-semibold">@{bot!.username}</a> сотрудники открывают ТТК прямо в Telegram — пришлите им приглашение.</>
          : bot ? ' Бот заведения сейчас отключён — вход через Telegram не работает.' : ' Вход через Telegram появится, когда к заведению подключат бота.'}
      </p>

      {isLoading ? <PageLoader /> : error ? <ErrorBox error={error} /> : (
        <ul className="card divide-y divide-line">
          {users!.map(u => (
            <li key={u.id} className={`px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${u.is_active ? '' : 'opacity-60'}`}>
              <div className="flex-1 min-w-[160px]">
                <p className="font-semibold">{u.name || u.login}{u.id === me?.user.id && <span className="muted font-normal"> · это вы</span>}</p>
                <p className="text-xs muted">{u.login} · вход {relDate(u.last_login_at)}{!u.is_active && ' · отключён'}</p>
                {u.tg_linked && (
                  <p className="text-xs text-ok mt-0.5 flex items-center gap-1"><Send className="h-3 w-3" />Telegram{u.tg_username ? ` @${u.tg_username}` : ''}
                    <button className="text-ink-muted underline underline-offset-2 ml-1" onClick={async () => {
                      if (await confirm({ title: `Отвязать Telegram у ${u.name || u.login}?`, text: 'Вход через бота для этого сотрудника перестанет работать, пока вы не пришлёте новое приглашение.', ok: 'Отвязать' })) tgUnlink.mutate(u)
                    }}>отвязать</button>
                  </p>
                )}
              </div>
              {botOn && u.is_active && (
                <button className="btn-ghost btn-sm" disabled={tgLink.isPending} onClick={() => tgLink.mutate(u)}>
                  <Send className="h-3.5 w-3.5" />{u.tg_linked ? 'Перепривязать' : 'В Telegram'}
                </button>
              )}
              <select className="input h-9 w-auto text-[13px]" value={u.role} disabled={update.isPending}
                onChange={e => update.mutate({ id: u.id, body: { role: e.target.value as Role } })}>
                {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button className="btn-ghost btn-sm" onClick={async () => {
                if (await confirm({ title: `Сбросить пароль для ${u.name || u.login}?`, text: 'Старый пароль перестанет работать сразу.', ok: 'Сбросить' })) reset.mutate(u)
              }}><KeyRound className="h-3.5 w-3.5" />Пароль</button>
              {u.id !== me?.user.id && (
                <button className="btn-ghost btn-sm" onClick={async () => {
                  if (u.is_active && !(await confirm({ title: `Отключить ${u.name || u.login}?`, text: 'Сотрудник сразу потеряет доступ. Включить обратно можно в любой момент.', ok: 'Отключить', danger: true }))) return
                  update.mutate({ id: u.id, body: { is_active: !u.is_active } })
                }}>{u.is_active ? 'Отключить' : 'Включить'}</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid sm:grid-cols-3 gap-2 text-[13px]">
        {(Object.keys(ROLE_LABEL) as Role[]).map(r => (
          <div key={r} className="rounded-xl bg-paper-2/60 px-3 py-2"><b>{ROLE_LABEL[r]}</b> — {ROLE_HINT[r]}</div>
        ))}
      </div>

      {adding && <AddUser onClose={() => setAdding(false)} onCreated={(login, password) => { setAdding(false); setSecret({ login, password, title: 'Сотрудник добавлен' }) }} />}
      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} footer={<button className="btn-primary" onClick={() => setSecret(null)}>Готово</button>}>
          <SecretReveal label="Передайте сотруднику — после закрытия пароль больше не покажется" login={secret.login} password={secret.password} />
        </Modal>
      )}
      {invite && <InviteModal invite={invite} onClose={() => setInvite(null)} />}
      {confirmNode}
    </div>
  )
}

function InviteModal({ invite, onClose }: { invite: { name: string; url: string; expires_at: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const expires = new Date(invite.expires_at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return (
    <Modal title={`Приглашение для ${invite.name}`} onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>Готово</button>}>
      <div className="grid gap-3">
        <p className="text-sm text-ink-2">Отправьте сотруднику эту ссылку. Он откроет её в Telegram, нажмёт «Старт» — и бот привяжет его аккаунт. Дальше ТТК открываются кнопкой «ТТК» в боте, без логина и пароля.</p>
        <div className="rounded-xl border border-line bg-paper-2/60 p-3">
          <code className="font-mono text-[13px] break-all select-all">{invite.url}</code>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(invite.url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? 'Скопировано' : 'Скопировать'}</button>
          <a className="btn-ghost btn-sm" href={`https://t.me/share/url?url=${encodeURIComponent(invite.url)}`} target="_blank" rel="noreferrer">Переслать в Telegram</a>
        </div>
        <p className="text-xs muted">Ссылка одноразовая, действует до {expires}. Новое приглашение отменяет прежнее.</p>
      </div>
    </Modal>
  )
}

function AddUser({ onClose, onCreated }: { onClose: () => void; onCreated: (login: string, password: string) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', login: '', role: 'viewer' as Role })
  const create = useMutation({
    mutationFn: () => api<{ user: User; password: string }>('/team', { method: 'POST', body: f }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['team'] }); onCreated(r.user.login, r.password) },
    onError: e => toast(errText(e), 'error'),
  })
  return (
    <Modal title="Новый сотрудник" onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!f.login.trim() || create.isPending} onClick={() => create.mutate()}>Создать</button>
      </>}>
      <div className="grid gap-4">
        <label><span className="field-label">Имя</span><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <label>
          <span className="field-label">Логин (латиница)</span>
          <input className="input" value={f.login} autoCapitalize="none" spellCheck={false} onChange={e => setF({ ...f, login: e.target.value.toLowerCase() })} placeholder="напр. ivan.cook" />
        </label>
        <div>
          <span className="field-label">Роль</span>
          <div className="grid gap-1.5">
            {(Object.keys(ROLE_LABEL) as Role[]).map(r => (
              <label key={r} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 cursor-pointer ${f.role === r ? 'border-brand bg-brand-soft/40' : 'border-line'}`}>
                <input type="radio" name="role" checked={f.role === r} onChange={() => setF({ ...f, role: r })} className="accent-[#B4471F]" />
                <span className="text-sm"><b>{ROLE_LABEL[r]}</b> <span className="muted">— {ROLE_HINT[r]}</span></span>
              </label>
            ))}
          </div>
        </div>
        <p className="text-xs muted">Пароль сгенерируется автоматически и покажется один раз.</p>
      </div>
    </Modal>
  )
}
