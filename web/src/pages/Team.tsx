import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, KeyRound, Send, Eye, EyeOff, Dices, Copy } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { relDate } from '../lib/format'
import type { Role, User } from '../lib/types'
import { ErrorBox, Modal, PageLoader, SecretReveal, errText, toast, useConfirm } from '../components/ui'
import { ROLE_LABEL } from '../components/Layout'

const ROLE_HINT: Record<Role, string> = {
  owner: 'всё, включая команду',
  viewer: 'смотрит и пересчитывает',
}

// Без похожих символов (0/O, 1/l/I) — пароль диктуют голосом или переписывают с экрана.
function generatePassword(len = 8) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), b => alphabet[b % alphabet.length]).join('')
}

type Secret = { login: string; password: string; title: string }

export function TeamPage() {
  const qc = useQueryClient()
  const { me } = useSession()
  const { data: users, isLoading, error } = useQuery({ queryKey: ['team'], queryFn: () => api<User[]>('/team') })
  const [adding, setAdding] = useState(false)
  const [secret, setSecret] = useState<Secret | null>(null)
  const [confirm, confirmNode] = useConfirm()
  const onError = (e: unknown) => toast(errText(e), 'error')
  const bot = me?.tenant?.bot
  const botOn = !!bot?.is_active

  const tgUnlink = useMutation({
    mutationFn: (u: User) => api(`/team/${u.id}/telegram`, { method: 'DELETE' }),
    onSuccess: () => { toast('Привязка Telegram сброшена'); qc.invalidateQueries({ queryKey: ['team'] }) }, onError,
  })
  const update = useMutation({
    mutationFn: (p: { id: number; body: Partial<User> }) => api<User>('/team/' + p.id, { method: 'PUT', body: p.body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }), onError,
  })
  const [pwFor, setPwFor] = useState<User | null>(null)

  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-8 pt-5 lg:pt-8">
      <div className="flex items-center justify-between gap-2">
        <h1 className="h-page">Команда</h1>
        <button className="btn-primary h-9" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" />Сотрудник</button>
      </div>
      <p className="text-sm muted mt-1 mb-4">У каждого свой логин и пароль — ими входят на сайт и один раз в Telegram-боте.</p>

      {bot && <BotLinkCard username={bot.username} active={botOn} />}

      {isLoading ? <PageLoader /> : error ? <ErrorBox error={error} /> : (
        <ul className="card divide-y divide-line">
          {users!.map(u => (
            <li key={u.id} className={`px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${u.is_active ? '' : 'opacity-60'}`}>
              <div className="flex-1 min-w-[180px]">
                <p className="font-semibold">{u.name || u.login}{u.id === me?.user.id && <span className="muted font-normal"> · это вы</span>}</p>
                <p className="text-xs muted">{u.login} · вход {relDate(u.last_login_at)}{!u.is_active && ' · отключён'}</p>
                {bot && (u.tg_linked ? (
                  <p className="text-xs text-ok mt-0.5 flex flex-wrap items-center gap-x-1">
                    <Send className="h-3 w-3" />Telegram привязан{u.tg_username ? ` · @${u.tg_username}` : ''}
                    <button className="text-ink-muted underline underline-offset-2 ml-1" onClick={async () => {
                      if (await confirm({
                        title: `Сбросить привязку Telegram у ${u.name || u.login}?`,
                        text: 'Бот и мини-апп перестанут пускать этот Telegram. Сотрудник (или новый аккаунт) сможет привязаться заново, войдя в боте логином и паролем.',
                        ok: 'Сбросить привязку',
                      })) tgUnlink.mutate(u)
                    }}>сбросить</button>
                  </p>
                ) : <p className="text-xs text-ink-faint mt-0.5">Telegram не привязан</p>)}
              </div>
              <select className="input h-9 w-auto text-[13px]" value={u.role} disabled={update.isPending}
                onChange={e => update.mutate({ id: u.id, body: { role: e.target.value as Role } })}>
                {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button className="btn-ghost btn-sm" onClick={() => setPwFor(u)}><KeyRound className="h-3.5 w-3.5" />Пароль</button>
              {u.id !== me?.user.id && (
                <button className="btn-ghost btn-sm" onClick={async () => {
                  if (u.is_active && !(await confirm({ title: `Отключить ${u.name || u.login}?`, text: 'Сотрудник сразу потеряет доступ — и на сайте, и в боте. Включить обратно можно в любой момент.', ok: 'Отключить', danger: true }))) return
                  update.mutate({ id: u.id, body: { is_active: !u.is_active } })
                }}>{u.is_active ? 'Отключить' : 'Включить'}</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid sm:grid-cols-2 gap-2 text-[13px]">
        {(Object.keys(ROLE_LABEL) as Role[]).map(r => (
          <div key={r} className="rounded-xl bg-paper-2/60 px-3 py-2"><b>{ROLE_LABEL[r]}</b> — {ROLE_HINT[r]}</div>
        ))}
      </div>

      {pwFor && <SetPassword user={pwFor} onClose={() => setPwFor(null)} onDone={s => { setPwFor(null); setSecret(s) }} />}
      {adding && <AddUser onClose={() => setAdding(false)} onCreated={s => { setAdding(false); setSecret(s) }} />}
      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} footer={<button className="btn-primary" onClick={() => setSecret(null)}>Готово</button>}>
          <div className="grid gap-3">
            <SecretReveal label="Передайте сотруднику — после закрытия пароль здесь больше не покажется" login={secret.login} password={secret.password} />
            {botOn && <p className="text-[13px] text-ink-2">С этими же данными сотрудник один раз входит в боте <b>@{bot!.username}</b> — дальше ТТК открываются в Telegram без пароля.</p>}
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  )
}

// Одна общая ссылка на бота — её можно отправить в общий чат кухни.
function BotLinkCard({ username, active }: { username: string; active: boolean }) {
  const url = `https://t.me/${username}`
  const [copied, setCopied] = useState(false)
  if (!active) {
    return <div className="rounded-xl bg-paper-2/60 px-4 py-3 mb-4 text-sm text-ink-2">Бот заведения <b>@{username}</b> сейчас отключён — вход через Telegram не работает.</div>
  }
  return (
    <div className="card p-4 mb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Send className="h-5 w-5 text-brand flex-shrink-0" />
        <div className="flex-1 min-w-[200px]">
          <p className="font-semibold">Ссылка на бота для всех сотрудников</p>
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-brand font-semibold break-all">{url}</a>
        </div>
        <button className="btn-outline btn-sm" onClick={() => navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>
          <Copy className="h-3.5 w-3.5" />{copied ? 'Скопировано' : 'Скопировать'}
        </button>
      </div>
      <p className="text-xs muted mt-2">Можно отправить в общий чат. Сотрудник открывает бота, жмёт «Старт» и один раз вводит свой логин и пароль — Telegram привязывается к нему навсегда. Перепривязать можно только через сброс здесь.</p>
    </div>
  )
}

function AddUser({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Secret) => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ name: '', login: '', password: generatePassword(), role: 'viewer' as Role })
  const loginOk = /^[a-z0-9._-]{3,40}$/.test(f.login)
  const passwordOk = passwordValid(f.password)
  const create = useMutation({
    mutationFn: () => api<{ user: User; password: string }>('/team', { method: 'POST', body: f }),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ['team'] }); onCreated({ login: r.user.login, password: r.password, title: 'Сотрудник добавлен' }) },
    onError: e => toast(errText(e), 'error'),
  })
  return (
    <Modal title="Новый сотрудник" onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!loginOk || !passwordOk || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Создаём…' : 'Создать'}</button>
      </>}>
      <div className="grid gap-4">
        <label><span className="field-label">Имя</span><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label>
            <span className="field-label">Логин (латиница)</span>
            <input className={`input ${f.login && !loginOk ? '!border-bad' : ''}`} value={f.login} autoCapitalize="none" spellCheck={false} autoComplete="off"
              onChange={e => setF({ ...f, login: e.target.value.toLowerCase().trim() })} placeholder="напр. ivan.cook" />
          </label>
          <PasswordField value={f.password} onChange={password => setF({ ...f, password })} />
        </div>
        {f.login && !loginOk && <p className="text-xs text-bad -mt-2">Логин: 3–40 символов — латинские буквы, цифры, точка, дефис, подчёркивание.</p>}
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
        <p className="text-xs muted">Этими логином и паролем сотрудник входит на сайт и один раз — в Telegram-боте заведения.</p>
      </div>
    </Modal>
  )
}

const passwordValid = (p: string) => p.length >= 6 && p.length <= 100

// Пароль задаёт владелец: можно оставить сгенерированный или вписать свой, хоть одни цифры.
function PasswordField({ value, onChange, autoFocus }: { value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const [show, setShow] = useState(true)
  return (
    <label>
      <span className="field-label">Пароль (от 6 символов, можно одни цифры)</span>
      <div className="relative">
        <input className={`input pr-[4.5rem] font-mono ${!passwordValid(value) ? '!border-bad' : ''}`} type={show ? 'text' : 'password'} value={value}
          autoComplete="new-password" spellCheck={false} autoFocus={autoFocus} onChange={e => onChange(e.target.value)} />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex">
          <button type="button" className="btn-ghost btn-sm w-8 px-0" onClick={() => setShow(v => !v)} aria-label={show ? 'Скрыть' : 'Показать'}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
          <button type="button" className="btn-ghost btn-sm w-8 px-0" onClick={() => onChange(generatePassword())} aria-label="Сгенерировать" title="Сгенерировать"><Dices className="h-4 w-4" /></button>
        </div>
      </div>
    </label>
  )
}

function SetPassword({ user, onClose, onDone }: { user: User; onClose: () => void; onDone: (s: Secret) => void }) {
  const [password, setPassword] = useState('')
  const save = useMutation({
    mutationFn: () => api<{ password: string }>(`/team/${user.id}/reset-password`, { method: 'POST', body: { password } }),
    onSuccess: r => onDone({ login: user.login, password: r.password, title: 'Пароль изменён' }),
    onError: e => toast(errText(e), 'error'),
  })
  return (
    <Modal title={`Пароль · ${user.name || user.login}`} onClose={onClose}
      footer={<>
        <button className="btn-ghost" onClick={onClose}>Отмена</button>
        <button className="btn-primary" disabled={!passwordValid(password) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
      </>}>
      <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (passwordValid(password)) save.mutate() }}>
        <PasswordField value={password} onChange={setPassword} autoFocus />
        <p className="text-xs muted">Впишите свой пароль (например, 6 цифр) или нажмите кубик — сгенерируется случайный. Старый пароль перестанет работать сразу; привязка Telegram не меняется.</p>
      </form>
    </Modal>
  )
}
