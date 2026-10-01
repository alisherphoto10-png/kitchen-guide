'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Check, ChevronRight, ImagePlus, Link2, MoreVertical, Plus, RefreshCw, Search, Send, Users, X,
} from 'lucide-react'

// Мастер настройки форм заказов ОКО по макету 01 (Этап 3, 2026-10-01,
// kitchen-guide print-agent/README.md). Соответствие терминов подтверждено
// пользователем: «Группа» — Telegram-группа клиента, где закреплены кнопки
// «Заполнить заказ»; «Тема» — форма заказа (Облако, ВМЯСО…) в своей теме этой
// группы; «Позиции» — каталог формы; «Пользователи» — повара ОКО, которые
// принимают заказ по своей категории, и доставщик.
//
// Работает поверх того же API и с тем же паролем, что и старая
// /oko-order/admin/ (решение пользователя 2026-10-01: во всех панелях один
// пароль, не вход KitchenDesk). Пароль живёт в sessionStorage под тем же
// ключом, что у старой админки. Формы хранятся целым конфигом — перед
// каждым сохранением конфиг перечитывается с сервера и меняется только своя
// форма, чтобы не затереть правки из соседней вкладки.

type Item = { name: string; category?: string | null; unit?: string; photoUrl?: string | null }
type Cook = { label: string; username?: string; userId?: number; category?: string | null }
type Person = { label: string; username?: string; userId?: number }
type Form = {
  label: string
  sourceGroupChatId?: string
  sourceThreadId?: string
  kitchenGroupChatId?: string
  kitchenThreadId?: string
  items: Item[]
  cookMentions?: Cook[]
  deliveryPerson?: Person | null
  coverUrl?: string
  logoUrl?: string
  categoryPhotos?: Record<string, string>
  active?: boolean
  groupActive?: boolean
  pinned?: { chatId: string; threadId: string | null; messageId: number } | null
  formUrl?: string | null
  [k: string]: any
}
type Config = Record<string, Form>
type Group = { title: string; description?: string; photoUrl?: string; active?: boolean }
type KnownChat = { title?: string; type?: string; topics?: Record<string, string>; people?: Record<string, { firstName?: string; lastName?: string; username?: string | null }> }
type Known = Record<string, KnownChat>
type OrderStatus = 'new' | 'cooking' | 'shipping' | 'delivered'
type OrderView = {
  id: string; createdAt: number | null; date: string | null; venue: string; venueLabel: string
  items: { name: string; qty: number; unit: string }[] | null; summary: string | null
  status: OrderStatus; comment: string | null; name: string | null; receiptPhoto: boolean
  timeline: { status: OrderStatus; at: number; via: string | null; trackUrl: string | null }[]
}

const API = '/api/oko-order/admin'
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://kitchendesk.chefplan.ru'
const PASSWORD_KEY = 'oko_admin_password'

class OkoApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
function storedPassword() {
  try { return sessionStorage.getItem(PASSWORD_KEY) || '' } catch { return '' }
}
// Неверный/сменившийся пароль (401) — мастер снова показывает ввод пароля.
let onUnauthorized: () => void = () => {}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Password': storedPassword(), ...options.headers },
  })
  if (res.status === 401) onUnauthorized()
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Ошибка сети' }))
    throw new OkoApiError(error.error || `HTTP ${res.status}`, res.status)
  }
  return res.json()
}
const okoApi = {
  config: () => request<Config>(`${API}/config`),
  saveConfig: (c: Config) => request<{ ok: boolean }>(`${API}/config`, { method: 'POST', body: JSON.stringify(c) }),
  known: () => request<Known>(`${API}/known-chats`),
  groups: () => request<Record<string, Group>>(`${API}/groups`),
  saveGroup: (chatId: string, g: Group) => request<{ ok: boolean }>(`${API}/groups`, { method: 'POST', body: JSON.stringify({ chatId, ...g }) }),
  deleteGroup: (chatId: string) => request<{ ok: boolean }>(`${API}/groups/delete`, { method: 'POST', body: JSON.stringify({ chatId }) }),
  setActive: (venue: string, active: boolean) => request<{ ok: boolean }>(`${API}/set-active`, { method: 'POST', body: JSON.stringify({ venue, active }) }),
  pin: (venue: string) => request<{ ok: boolean; formUrl: string }>(`${API}/pin-button`, { method: 'POST', body: JSON.stringify({ venue }) }),
  orders: (venue?: string) => request<{ orders: OrderView[] }>(`${API}/orders?limit=200${venue ? `&venue=${encodeURIComponent(venue)}` : ''}`),
  media: (data: string, kind: string) => request<{ ok: boolean; url: string }>(`${API}/media`, { method: 'POST', body: JSON.stringify({ data, kind }) }),
}

// Поля, которые считает сервер — при сохранении не отправляем.
const COMPUTED_FIELDS = ['formUrl', 'legacySlugAllowed', 'groupActive']
const DEFAULT_UNIT = 'шт.'
const UNITS = ['шт.', 'кг', 'г', 'л', 'мл', 'уп.', 'порц.']

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}
function slugify(text: string) {
  return text.toLowerCase().split('').map(ch => TRANSLIT[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}
function uniqueKey(config: Config, label: string) {
  const root = slugify(label) || 'forma'
  let key = root
  for (let n = 2; config[key]; n++) key = `${root}_${n}`
  return key
}
function cleanForm(form: Form): Form {
  const out: Form = { ...form }
  COMPUTED_FIELDS.forEach(f => delete out[f])
  return out
}
function itemUnit(item: Item) { return (item.unit || '').trim() || DEFAULT_UNIT }
function personName(p: { firstName?: string; lastName?: string } | undefined, id: string) {
  return [p?.firstName, p?.lastName].filter(Boolean).join(' ') || `ID ${id}`
}
function formPhoto(form: Form) {
  return form.coverUrl || Object.values(form.categoryPhotos || {})[0] || form.items.find(i => i.photoUrl)?.photoUrl || null
}
function formCategories(form: Form) {
  return Array.from(new Set(form.items.map(i => i.category).filter(Boolean))) as string[]
}
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
function topicName(known: Known, chatId?: string, threadId?: string) {
  if (!threadId) return 'Без темы (общий чат)'
  return known[String(chatId)]?.topics?.[String(threadId)] || `Тема #${threadId}`
}
// Первый символ целиком (эмодзи — две половинки UTF-16, slice их разрывает).
function firstChar(text?: string) { return Array.from(text || '')[0] || '?' }
function errText(e: any) { return e?.message || 'Не удалось выполнить действие' }

function downscale(file: File, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть картинку')) }
    img.src = url
  })
}
function pickImage(kind: string, maxSide: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      try {
        const data = await downscale(file, maxSide)
        const res = await okoApi.media(data, kind)
        resolve(res.url)
      } catch (e) { reject(e) }
    }
    input.click()
  })
}

// ── мелкие элементы ─────────────────────────────────────────────

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-40 ${on ? 'bg-green-500' : 'bg-white/15'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function Thumb({ url, alt, size = 'w-14 h-14', onClick }: { url?: string | null; alt: string; size?: string; onClick?: () => void }) {
  const inner = url
    ? <img src={url} alt={alt} className="w-full h-full object-cover" />
    : <span className="text-gray-500 text-lg font-semibold">{firstChar(alt).toUpperCase()}</span>
  const cls = `${size} rounded-xl overflow-hidden bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0`
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} relative group`} aria-label="Сменить фото">
        {inner}
        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><ImagePlus className="w-5 h-5 text-white" /></span>
      </button>
    : <div className={cls}>{inner}</div>
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-500">{hint}</span>}
    </label>
  )
}

const inputCls = 'w-full bg-[#0a1326] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-green-500/60'
const cardCls = 'bg-[#0a1222] border border-white/8 rounded-2xl'
const primaryBtn = 'whitespace-nowrap flex-shrink-0 inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 hover:bg-green-400 text-[#04140a] font-semibold text-sm px-4 py-2.5 transition-colors disabled:opacity-50'
const ghostBtn = 'whitespace-nowrap inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-white text-sm px-4 py-2.5 transition-colors disabled:opacity-50'

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Menu({ items }: { items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5" aria-label="Меню">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 min-w-[220px] bg-[#0f1a30] border border-white/10 rounded-xl shadow-xl py-1">
          {items.map(it => (
            <button key={it.label} type="button" onClick={() => { setOpen(false); it.onClick() }}
              className={`w-full text-left px-3.5 py-2 text-sm hover:bg-white/5 ${it.danger ? 'text-red-400' : 'text-gray-200'}`}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const STEPS = ['Подключаем группу', 'Настраиваем группу', 'Создаём тему', 'Готово']
function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {STEPS.map((s, i) => {
        const n = i + 1, done = n < current, active = n === current
        return (
          <li key={s} className="flex items-center gap-2 flex-shrink-0">
            <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${active ? 'bg-green-500 text-[#04140a]' : done ? 'bg-green-500/20 text-green-400' : 'bg-white/8 text-gray-500'}`}>
              {done ? <Check className="w-3.5 h-3.5" /> : n}
            </span>
            <span className={`text-xs ${active ? 'text-white font-medium' : 'text-gray-500'}`}>{s}</span>
            {n < STEPS.length && <ChevronRight className="w-3.5 h-3.5 text-gray-700" />}
          </li>
        )
      })}
    </ol>
  )
}

// ── экраны ──────────────────────────────────────────────────────

type View =
  | { name: 'orders' }
  | { name: 'groups' }
  | { name: 'connect'; replace?: string }
  | { name: 'group'; chatId: string }
  | { name: 'topic'; chatId: string; key: string | null }
  | { name: 'done'; chatId: string; key: string }

type Data = { config: Config; groups: Record<string, Group>; known: Known }

function PasswordGate({ onLogin }: { onLogin: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!value || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}${API}/config`, { headers: { 'X-Admin-Password': value } })
      if (res.ok) {
        try { sessionStorage.setItem(PASSWORD_KEY, value) } catch {}
        onLogin()
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(res.status === 401 ? 'Неверный пароль' : body.error || `Ошибка ${res.status}`)
    } catch {
      setError('Нет связи с сервером')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-5">
      <form onSubmit={submit} className={`${cardCls} p-6 w-full max-w-sm flex flex-col gap-4`}>
        <div>
          <div className="text-lg font-bold text-white">Заказы клиентов ОКО</div>
          <div className="text-sm text-gray-500 mt-1">Введите пароль — тот же, что в панели /oko-order/admin/</div>
        </div>
        <input type="password" className={inputCls} value={value} onChange={e => setValue(e.target.value)} placeholder="Пароль" autoFocus autoComplete="current-password" />
        {error && <div className="text-sm text-red-400">{error}</div>}
        <button type="submit" className={primaryBtn} disabled={busy || !value}>{busy ? 'Проверяю…' : 'Войти'}</button>
      </form>
    </div>
  )
}

export function OkoOrderSetup() {
  // null — ещё не заглянули в sessionStorage (статическая сборка Next рендерит без него).
  const [authed, setAuthed] = useState<boolean | null>(null)
  useEffect(() => { setAuthed(!!storedPassword()) }, [])
  onUnauthorized = () => {
    try { sessionStorage.removeItem(PASSWORD_KEY) } catch {}
    setAuthed(false)
  }
  if (authed === null) return <div className="min-h-screen flex items-center justify-center text-green-400 text-sm">Загрузка...</div>
  if (!authed) return <PasswordGate onLogin={() => setAuthed(true)} />
  return <OkoOrderWizard />
}

function OkoOrderWizard() {
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<{ status?: number; text: string } | null>(null)
  const [view, setView] = useState<View>({ name: 'groups' })
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const reload = async () => {
    const [config, groups, known] = await Promise.all([okoApi.config(), okoApi.groups(), okoApi.known()])
    setData({ config, groups, known })
    return { config, groups, known }
  }
  useEffect(() => {
    reload().catch(e => { if (e instanceof OkoApiError && e.status === 401) return; setLoadError({ status: e instanceof OkoApiError ? e.status : undefined, text: errText(e) }) })
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => { document.getElementById('oko-order-scroll')?.scrollTo({ top: 0 }) }, [view])

  const notify = (kind: 'ok' | 'error', text: string) => setToast({ kind, text })

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-white font-semibold">{loadError.status === 403 ? 'Нет доступа' : 'Не удалось загрузить'}</div>
        <div className="text-gray-400 text-sm max-w-sm">{loadError.text}</div>
        <a href="/web" className="text-green-400 text-sm underline">Перейти в KitchenDesk</a>
      </div>
    )
  }
  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-green-400 text-sm">Загрузка...</div>
  }

  const step = view.name === 'groups' || view.name === 'connect' ? 1 : view.name === 'group' ? 2 : view.name === 'topic' ? 3 : 4
  const navCls = (on: boolean) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium ${on ? 'bg-green-500/10 text-green-400' : 'text-gray-500 hover:text-gray-300 hover:bg-white/4'}`
  const props = { data, reload, setView, notify }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden lg:flex flex-col w-[240px] bg-[#070f1f] min-h-screen p-4 gap-1 flex-shrink-0">
        <div className="flex items-center gap-3 px-2 py-3 mb-3">
          <img src="/logo-icon-light.png" alt="" className="w-8 h-8 object-contain" />
          <div>
            <div className="text-sm font-bold text-white">KitchenDesk</div>
            <div className="text-[11px] text-gray-500">Заказы клиентов ОКО</div>
          </div>
        </div>
        <button onClick={() => setView({ name: 'orders' })} className={navCls(view.name === 'orders')}>
          <Send className="w-4 h-4" /> Заказы
        </button>
        <button onClick={() => setView({ name: 'groups' })} className={navCls(view.name !== 'orders')}>
          <Link2 className="w-4 h-4" /> Группы
        </button>
        <a href="/web" className="mt-auto flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-gray-500 hover:text-gray-300">
          <ArrowLeft className="w-4 h-4" /> Вернуться в KitchenDesk
        </a>
      </aside>

      <main className="flex-1 min-w-0 px-4 py-5 lg:px-10 lg:py-8 pb-24">
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          <div className="lg:hidden flex items-center gap-2">
            <a href="/web" className="inline-flex items-center gap-1.5 text-xs text-gray-500 mr-auto"><ArrowLeft className="w-3.5 h-3.5" /> KitchenDesk</a>
            <button onClick={() => setView({ name: 'orders' })} className={`text-xs px-3 py-1.5 rounded-lg ${view.name === 'orders' ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-gray-400'}`}>Заказы</button>
            <button onClick={() => setView({ name: 'groups' })} className={`text-xs px-3 py-1.5 rounded-lg ${view.name !== 'orders' ? 'bg-green-500/15 text-green-400' : 'bg-white/5 text-gray-400'}`}>Группы</button>
          </div>
          {view.name !== 'orders' && <Steps current={step} />}
          {view.name === 'orders' && <OrdersScreen {...props} />}
          {view.name === 'groups' && <GroupsScreen {...props} />}
          {view.name === 'connect' && <ConnectScreen {...props} replace={view.replace} />}
          {view.name === 'group' && <GroupScreen {...props} chatId={view.chatId} />}
          {view.name === 'topic' && <TopicScreen {...props} chatId={view.chatId} formKey={view.key} />}
          {view.name === 'done' && <DoneScreen {...props} chatId={view.chatId} formKey={view.key} />}
        </div>
      </main>

      {toast && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-sm shadow-lg max-w-[90vw] ${toast.kind === 'ok' ? 'bg-green-500 text-[#04140a]' : 'bg-red-500 text-white'}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}

type ScreenProps = {
  data: Data
  reload: () => Promise<Data>
  setView: (v: View) => void
  notify: (kind: 'ok' | 'error', text: string) => void
}

function groupIds(data: Data) {
  const ids = new Set(Object.keys(data.groups))
  Object.values(data.config).forEach(f => { if (f.sourceGroupChatId) ids.add(String(f.sourceGroupChatId)) })
  return Array.from(ids)
}
function groupTitle(data: Data, chatId: string) {
  return data.groups[chatId]?.title || data.known[chatId]?.title || `Группа ${chatId}`
}
function groupForms(data: Data, chatId: string) {
  return Object.entries(data.config).filter(([, f]) => String(f.sourceGroupChatId || '') === chatId)
}

// Шаг 1 — список групп / пустое состояние
function GroupsScreen({ data, reload, setView, notify }: ScreenProps) {
  const ids = groupIds(data)
  const [busy, setBusy] = useState<string | null>(null)

  const toggleGroup = async (chatId: string, active: boolean) => {
    setBusy(chatId)
    try {
      const g = data.groups[chatId]
      await okoApi.saveGroup(chatId, { title: groupTitle(data, chatId), description: g?.description, photoUrl: g?.photoUrl, active })
      await reload()
      notify('ok', active ? 'Группа включена — формы снова принимают заказы' : 'Группа выключена — формы её тем закрыты для заказов')
    } catch (e) { notify('error', errText(e)) } finally { setBusy(null) }
  }

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Группы</h1>
          <p className="text-sm text-gray-500 mt-1">Telegram-группы клиентов, из которых приходят заказы</p>
        </div>
        <button className={primaryBtn} onClick={() => setView({ name: 'connect' })}><Plus className="w-4 h-4" /> Подключить группу</button>
      </div>

      {ids.length === 0 ? (
        <div className={`${cardCls} p-8 flex flex-col items-center text-center gap-3`}>
          <div className="w-16 h-16 rounded-full bg-sky-500/15 flex items-center justify-center"><Send className="w-7 h-7 text-sky-400" /></div>
          <div className="text-lg font-semibold text-white">Подключите Telegram-группу</div>
          <p className="text-sm text-gray-400 max-w-xs">Выберите группу клиента — в её темах появятся кнопки «Заполнить заказ».</p>
          <button className={primaryBtn} onClick={() => setView({ name: 'connect' })}>Подключить группу</button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {ids.map(chatId => {
            const forms = groupForms(data, chatId)
            const g = data.groups[chatId]
            const active = g ? g.active !== false : true
            const photo = g?.photoUrl || forms.map(([, f]) => formPhoto(f)).find(Boolean) || null
            return (
              <div key={chatId} className={`${cardCls} p-3.5 flex items-center gap-3.5`}>
                <button className="flex items-center gap-3.5 flex-1 min-w-0 text-left" onClick={() => setView({ name: 'group', chatId })}>
                  <Thumb url={photo} alt={groupTitle(data, chatId)} />
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{groupTitle(data, chatId)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {forms.length} {plural(forms.length, 'тема', 'темы', 'тем')} · {active ? <span className="text-green-400">активна</span> : <span className="text-gray-400">выключена</span>}
                    </div>
                  </div>
                </button>
                <Toggle on={active} disabled={busy === chatId} onChange={v => toggleGroup(chatId, v)} label="Группа активна" />
                <ChevronRight className="w-4 h-4 text-gray-600 hidden sm:block" />
              </div>
            )
          })}
        </div>
      )}

      <div className={`${cardCls} p-5`}>
        <div className="text-sm font-semibold text-white mb-3">Как это работает?</div>
        <ol className="flex flex-col gap-2.5">
          {['Подключаете Telegram-группу клиента', 'Создаёте в ней темы-формы и выбираете позиции', 'Назначаете поваров, которые принимают заказ, и доставщика', 'Закрепляете кнопку «Заполнить заказ» — готово'].map((t, i) => (
            <li key={t} className="flex items-center gap-3 text-sm text-gray-400">
              <span className="w-6 h-6 rounded-full bg-green-500/15 text-green-400 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>{t}
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

// Шаг 1б — выбор группы из тех, что видел бот
function ConnectScreen({ data, reload, setView, notify, replace }: ScreenProps & { replace?: string }) {
  const used = new Set(groupIds(data))
  const candidates = Object.entries(data.known).filter(([id, c]) => !used.has(id) && c.type !== 'private')
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const connect = async (chatId: string) => {
    setBusy(true)
    try {
      if (replace) {
        const old = data.groups[replace]
        await okoApi.saveGroup(chatId, { title: old?.title || data.known[chatId]?.title || 'Группа', description: old?.description, photoUrl: old?.photoUrl, active: old?.active !== false })
        if (old) await okoApi.deleteGroup(replace)
      } else {
        await okoApi.saveGroup(chatId, { title: (data.known[chatId]?.title || 'Группа').slice(0, 60), active: true })
      }
      await reload()
      notify('ok', 'Группа подключена')
      setView({ name: 'group', chatId })
    } catch (e) { notify('error', errText(e)) } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={() => setView(replace ? { name: 'group', chatId: replace } : { name: 'groups' })} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white w-fit">
        <ArrowLeft className="w-4 h-4" /> Назад
      </button>
      <div>
        <h1 className="text-2xl font-bold text-white">{replace ? 'Сменить Telegram-группу' : 'Подключаем группу'}</h1>
        <p className="text-sm text-gray-500 mt-1">Выберите группу, в которую бот KitchenDesk уже добавлен</p>
      </div>
      <div className={`${cardCls} divide-y divide-white/6`}>
        {candidates.length === 0 && (
          <div className="p-5 text-sm text-gray-400">Новых групп нет — все, которые видел бот, уже подключены.</div>
        )}
        {candidates.map(([id, c]) => (
          <div key={id} className="flex items-center gap-3 p-3.5">
            <Thumb url={null} alt={c.title || id} size="w-11 h-11" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-white truncate">{c.title || `Группа ${id}`}</div>
              <div className="text-xs text-gray-500">{Object.keys(c.topics || {}).length} {plural(Object.keys(c.topics || {}).length, 'тема', 'темы', 'тем')} · ID {id}</div>
            </div>
            <button className={primaryBtn} disabled={busy} onClick={() => connect(id)}>Выбрать</button>
          </div>
        ))}
      </div>
      <div className={`${cardCls} p-4 text-sm text-gray-400 flex flex-col gap-2`}>
        <div className="text-white font-medium">Нужной группы нет в списке?</div>
        <ol className="list-decimal ml-5 flex flex-col gap-1">
          <li>Добавьте бота KitchenDesk в группу клиента и сделайте его администратором.</li>
          <li>Напишите в группе (в нужной теме) любое сообщение — так бот её «увидит».</li>
          <li>Нажмите «Обновить список».</li>
        </ol>
        <button className={`${ghostBtn} w-fit mt-1`} disabled={refreshing}
          onClick={async () => { setRefreshing(true); try { await reload() } catch (e) { notify('error', errText(e)) } finally { setRefreshing(false) } }}>
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Обновить список
        </button>
      </div>
    </>
  )
}

// Шаг 2 — настройки группы и её темы
function GroupScreen({ data, reload, setView, notify, chatId }: ScreenProps & { chatId: string }) {
  const g = data.groups[chatId]
  const [title, setTitle] = useState(groupTitle(data, chatId))
  const [description, setDescription] = useState(g?.description || '')
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(g?.photoUrl)
  const [active, setActive] = useState(g ? g.active !== false : true)
  const [saving, setSaving] = useState(false)
  const [busyForm, setBusyForm] = useState<string | null>(null)
  const forms = groupForms(data, chatId)
  const known = data.known[chatId]

  const save = async () => {
    if (!title.trim()) return notify('error', 'Укажите название группы')
    setSaving(true)
    try {
      await okoApi.saveGroup(chatId, { title: title.trim(), description: description.trim(), photoUrl, active })
      await reload()
      notify('ok', 'Изменения сохранены')
    } catch (e) { notify('error', errText(e)) } finally { setSaving(false) }
  }
  const changePhoto = async () => {
    try { const url = await pickImage('group', 800); if (url) setPhotoUrl(url) } catch (e) { notify('error', errText(e)) }
  }
  const setFormActive = async (key: string, v: boolean) => {
    setBusyForm(key)
    try { await okoApi.setActive(key, v); await reload() } catch (e) { notify('error', errText(e)) } finally { setBusyForm(null) }
  }
  const pin = async (key: string) => {
    if (!confirm('Отправить в тему клиента новое сообщение с кнопкой «Заполнить заказ» и закрепить его?')) return
    setBusyForm(key)
    try { await okoApi.pin(key); await reload(); notify('ok', 'Кнопка отправлена и закреплена') } catch (e) { notify('error', errText(e)) } finally { setBusyForm(null) }
  }
  const copyLink = async (form: Form) => {
    if (!form.formUrl) return notify('error', 'У формы ещё нет ссылки')
    try { await navigator.clipboard.writeText(form.formUrl); notify('ok', 'Ссылка скопирована') } catch { prompt('Ссылка на форму:', form.formUrl) }
  }
  const removeForm = async (key: string, form: Form) => {
    if (!confirm(`Удалить тему «${form.label}»? Кнопка «Заполнить заказ» в Telegram перестанет работать. Уже отправленные заказы останутся.`)) return
    setBusyForm(key)
    try {
      const fresh = await okoApi.config()
      if (Object.keys(fresh).length <= 1) throw new Error('Нельзя удалить последнюю форму')
      delete fresh[key]
      const next: Config = {}
      Object.entries(fresh).forEach(([k, f]) => { next[k] = cleanForm(f) })
      await okoApi.saveConfig(next)
      await reload()
      notify('ok', 'Тема удалена')
    } catch (e) { notify('error', errText(e)) } finally { setBusyForm(null) }
  }
  const removeGroup = async () => {
    if (!confirm(`Убрать группу «${title}» из списка?`)) return
    try { await okoApi.deleteGroup(chatId); await reload(); setView({ name: 'groups' }) } catch (e) { notify('error', errText(e)) }
  }

  return (
    <>
      <button onClick={() => setView({ name: 'groups' })} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white w-fit">
        <ArrowLeft className="w-4 h-4" /> Назад
      </button>

      <div className={`${cardCls} p-4 flex items-center gap-4`}>
        <Thumb url={photoUrl} alt={title} size="w-24 h-16 sm:w-28 sm:h-[72px]" onClick={changePhoto} />
        <div className="min-w-0">
          <div className="text-xl font-bold text-white truncate">{title || 'Без названия'}</div>
          <span className="inline-flex items-center gap-1 mt-1 text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400"><Check className="w-3 h-3" /> Подключена</span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Название группы"><input className={inputCls} value={title} maxLength={60} onChange={e => setTitle(e.target.value)} /></Field>
        <Field label="Описание (необязательно)">
          <textarea className={`${inputCls} min-h-[72px]`} value={description} maxLength={300} onChange={e => setDescription(e.target.value)} placeholder="Например: заказы десертов и выпечки для Облака" />
        </Field>
        <Field label="Telegram-группа">
          <div className={`${inputCls} flex items-center gap-3`}>
            <span className="truncate flex-1">{known?.title || `ID ${chatId}`}</span>
            <span className="text-xs text-green-400 flex items-center gap-1 flex-shrink-0"><Check className="w-3 h-3" /> Подключена</span>
            <button type="button" disabled={forms.length > 0} title={forms.length ? 'Сначала удалите темы группы — их кнопки закреплены в этой группе' : ''}
              onClick={() => setView({ name: 'connect', replace: chatId })}
              className="text-xs px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/12 disabled:opacity-40 flex-shrink-0">Изменить</button>
          </div>
        </Field>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-300 w-20">Статус</span>
          <Toggle on={active} onChange={setActive} label="Группа активна" />
          <div>
            <div className="text-sm text-white">{active ? 'Активна' : 'Выключена'}</div>
            <div className="text-xs text-gray-500">{active ? 'Формы группы принимают заказы' : 'Все формы группы показывают «приём закрыт»'}</div>
          </div>
        </div>
      </div>

      <Section title="Темы" subtitle="Формы заказа — у каждой своя кнопка в своей теме группы"
        action={<button className={primaryBtn} onClick={() => setView({ name: 'topic', chatId, key: null })}><Plus className="w-4 h-4" /> Добавить тему</button>}>
        {forms.length === 0 && <div className={`${cardCls} p-5 text-sm text-gray-400`}>Тем пока нет — добавьте первую.</div>}
        <div className="flex flex-col gap-2.5">
          {forms.map(([key, form]) => {
            const cats = formCategories(form)
            return (
              <div key={key} className={`${cardCls} p-3 flex items-center gap-3`}>
                <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => setView({ name: 'topic', chatId, key })}>
                  <Thumb url={formPhoto(form)} alt={form.label} size="w-20 h-14" />
                  <div className="min-w-0">
                    <div className="text-white font-medium truncate">{form.label}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {cats.length ? cats.join(', ') : 'без категорий'} · {form.items.length} {plural(form.items.length, 'позиция', 'позиции', 'позиций')}
                    </div>
                    <div className="text-[11px] text-gray-600 truncate">{topicName(data.known, chatId, form.sourceThreadId)}{form.pinned ? ' · кнопка закреплена' : ' · кнопка не закреплена'}</div>
                  </div>
                </button>
                <Toggle on={form.active !== false} disabled={busyForm === key} onChange={v => setFormActive(key, v)} label="Тема активна" />
                <Menu items={[
                  { label: 'Открыть', onClick: () => setView({ name: 'topic', chatId, key }) },
                  { label: 'Скопировать ссылку на форму', onClick: () => copyLink(form) },
                  { label: form.pinned ? 'Закрепить кнопку заново' : 'Закрепить кнопку в теме', onClick: () => pin(key) },
                  { label: 'Удалить тему', onClick: () => removeForm(key, form), danger: true },
                ]} />
              </div>
            )
          })}
        </div>
      </Section>

      <button className={`${primaryBtn} w-full py-3.5 text-base`} disabled={saving} onClick={save}>{saving ? 'Сохраняю…' : 'Сохранить изменения'}</button>
      {forms.length === 0 && g && (
        <button className="text-sm text-red-400 hover:text-red-300 w-fit mx-auto" onClick={removeGroup}>Убрать группу из списка</button>
      )}
    </>
  )
}

// Шаг 3 — тема (форма): название, тема Telegram, получатель, позиции, пользователи
function TopicScreen({ data, reload, setView, notify, chatId, formKey }: ScreenProps & { chatId: string; formKey: string | null }) {
  const original = formKey ? data.config[formKey] : null
  const siblings = groupForms(data, chatId).filter(([k]) => k !== formKey)
  const [draft, setDraft] = useState<Form>(() => original
    ? JSON.parse(JSON.stringify(cleanForm(original)))
    : {
        label: '',
        sourceGroupChatId: chatId,
        sourceThreadId: '',
        // Новая тема по умолчанию шлёт заказы туда же, куда соседние темы группы.
        kitchenGroupChatId: siblings[0]?.[1].kitchenGroupChatId || '',
        kitchenThreadId: siblings[0]?.[1].kitchenThreadId || '',
        items: [],
        cookMentions: siblings[0] ? JSON.parse(JSON.stringify(siblings[0][1].cookMentions || [])) : [],
        deliveryPerson: siblings[0]?.[1].deliveryPerson ? { ...siblings[0][1].deliveryPerson } : null,
      })
  const [active, setActiveState] = useState(original ? original.active !== false : true)
  const [category, setCategory] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  const [addingUser, setAddingUser] = useState(false)
  const [extraCatalog, setExtraCatalog] = useState<Item[]>([])

  const patch = (p: Partial<Form>) => setDraft(d => ({ ...d, ...p }))

  // Каталог для выбора: позиции всех форм (по имени; версия этой формы важнее) + только что добавленные.
  const catalog = useMemo(() => {
    const map = new Map<string, Item>()
    Object.values(data.config).forEach(f => f.items.forEach(i => { if (!map.has(i.name)) map.set(i.name, i) }))
    extraCatalog.forEach(i => map.set(i.name, i))
    draft.items.forEach(i => map.set(i.name, i))
    return Array.from(map.values())
  }, [data.config, extraCatalog, draft.items])
  const categories = useMemo(() => Array.from(new Set(catalog.map(i => i.category).filter(Boolean))) as string[], [catalog])
  const selected = new Set(draft.items.map(i => i.name))
  const visible = catalog
    .filter(i => !category || i.category === category)
    .filter(i => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(selected.has(b.name)) - Number(selected.has(a.name)))

  const toggleItem = (item: Item) => {
    if (selected.has(item.name)) patch({ items: draft.items.filter(i => i.name !== item.name) })
    else patch({ items: [...draft.items, { ...item }] })
  }
  const setItemField = (name: string, p: Partial<Item>) => patch({ items: draft.items.map(i => i.name === name ? { ...i, ...p } : i) })

  const kitchenChat = data.known[String(draft.kitchenGroupChatId || '')]
  const sourceTopics = Object.entries(data.known[chatId]?.topics || {})
  const usedThreads = new Map(siblings.map(([, f]) => [String(f.sourceThreadId || ''), f.label]))
  const draftCats = formCategories(draft)
  const users = (draft.cookMentions || []).length + (draft.deliveryPerson ? 1 : 0)

  const save = async () => {
    const label = draft.label.trim()
    if (!label) return notify('error', 'Укажите название темы')
    if (!draft.items.length) return notify('error', 'Выберите хотя бы одну позицию')
    if (!draft.kitchenGroupChatId) return notify('error', 'Выберите, куда приходят заказы')
    if (usedThreads.has(String(draft.sourceThreadId || ''))) return notify('error', `Эта тема Telegram уже занята формой «${usedThreads.get(String(draft.sourceThreadId || ''))}»`)
    setSaving(true)
    try {
      const fresh = await okoApi.config()
      if (formKey && !fresh[formKey]) throw new Error('Эту тему уже удалили в другой вкладке — обновите страницу')
      const key = formKey || uniqueKey(fresh, label)
      const next: Config = {}
      Object.entries(fresh).forEach(([k, f]) => { next[k] = cleanForm(f) })
      const form: Form = { ...draft, label, sourceGroupChatId: chatId }
      ;(['sourceThreadId', 'kitchenThreadId'] as const).forEach(f => { if (!form[f]) delete form[f] })
      if (!form.deliveryPerson) delete form.deliveryPerson
      next[key] = form
      await okoApi.saveConfig(next)
      const fromServer = await okoApi.config()
      if ((fromServer[key]?.active !== false) !== active) await okoApi.setActive(key, active)
      await reload()
      if (formKey) { notify('ok', 'Тема сохранена'); setView({ name: 'group', chatId }) }
      else setView({ name: 'done', chatId, key })
    } catch (e) { notify('error', errText(e)) } finally { setSaving(false) }
  }

  return (
    <>
      <button onClick={() => setView({ name: 'group', chatId })} className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white w-fit">
        <ArrowLeft className="w-4 h-4" /> Назад
      </button>

      <div className={`${cardCls} p-4 flex items-center gap-4`}>
        <Thumb url={formPhoto(draft)} alt={draft.label || 'Т'} size="w-24 h-16 sm:w-28 sm:h-[72px]" />
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold text-white truncate">{draft.label || 'Новая тема'}</div>
          <div className="text-xs text-gray-500 truncate">{groupTitle(data, chatId)}</div>
        </div>
        <div className="flex items-center gap-2">
          <Toggle on={active} onChange={setActiveState} label="Тема активна" />
          <span className="text-xs text-gray-400 hidden sm:inline">{active ? 'Активна' : 'Выключена'}</span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Название темы" hint="Клиент видит его в шапке формы, повара — в заказе">
          <input className={inputCls} value={draft.label} maxLength={60} onChange={e => patch({ label: e.target.value })} placeholder="Например: Облако" />
        </Field>
        <Field label="Тема в Telegram-группе" hint="Сюда закрепляется кнопка «Заполнить заказ» и приходит подтверждение клиенту">
          <select className={inputCls} value={String(draft.sourceThreadId || '')} onChange={e => patch({ sourceThreadId: e.target.value })}>
            <option value="">Без темы (общий чат)</option>
            {sourceTopics.map(([id, name]) => (
              <option key={id} value={id} disabled={usedThreads.has(id)}>{name}{usedThreads.has(id) ? ` — занята «${usedThreads.get(id)}»` : ''}</option>
            ))}
            {draft.sourceThreadId && !sourceTopics.some(([id]) => id === String(draft.sourceThreadId)) && (
              <option value={String(draft.sourceThreadId)}>Тема #{draft.sourceThreadId}</option>
            )}
          </select>
        </Field>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Куда приходят заказы — группа">
            <select className={inputCls} value={String(draft.kitchenGroupChatId || '')} onChange={e => patch({ kitchenGroupChatId: e.target.value, kitchenThreadId: '' })}>
              <option value="">— выберите —</option>
              {Object.entries(data.known).filter(([, c]) => c.type !== 'private').map(([id, c]) => <option key={id} value={id}>{c.title || id}</option>)}
              {draft.kitchenGroupChatId && !data.known[String(draft.kitchenGroupChatId)] && <option value={String(draft.kitchenGroupChatId)}>ID {draft.kitchenGroupChatId}</option>}
            </select>
          </Field>
          <Field label="Тема">
            <select className={inputCls} value={String(draft.kitchenThreadId || '')} onChange={e => patch({ kitchenThreadId: e.target.value })} disabled={!draft.kitchenGroupChatId}>
              <option value="">Без темы (общий чат)</option>
              {Object.entries(kitchenChat?.topics || {}).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              {draft.kitchenThreadId && !kitchenChat?.topics?.[String(draft.kitchenThreadId)] && <option value={String(draft.kitchenThreadId)}>Тема #{draft.kitchenThreadId}</option>}
            </select>
          </Field>
        </div>
        <Field label="Категория позиций">
          <select className={inputCls} value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">Все категории</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>

      <Section title="Позиции" subtitle={`Выбрано: ${draft.items.length}. Отметьте, что клиент может заказать в этой теме`}
        action={<button className={primaryBtn} onClick={() => setAddingItem(true)} aria-label="Добавить позицию"><Plus className="w-4 h-4" /> Позиция</button>}>
        {addingItem && (
          <AddItemForm categories={categories} defaultCategory={category} existing={new Set(catalog.map(i => i.name))} notify={notify}
            onCancel={() => setAddingItem(false)}
            onAdd={item => { setExtraCatalog(c => [...c, item]); patch({ items: [...draft.items, item] }); setAddingItem(false) }} />
        )}
        <div className="relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input className={`${inputCls} pl-10`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по позициям…" />
        </div>
        <div className={`${cardCls} divide-y divide-white/6`}>
          {visible.length === 0 && <div className="p-4 text-sm text-gray-500">Ничего не найдено</div>}
          {visible.map(item => {
            const on = selected.has(item.name)
            const current = on ? draft.items.find(i => i.name === item.name)! : item
            return (
              <div key={item.name} className="flex items-center gap-3 px-3.5 py-2.5">
                <button type="button" onClick={() => toggleItem(item)} aria-label={on ? `Убрать «${item.name}»` : `Отметить «${item.name}»`}
                  className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${on ? 'bg-green-500 border-green-500' : 'border-white/25'}`}>
                  {on && <Check className="w-3.5 h-3.5 text-[#04140a]" strokeWidth={3} />}
                </button>
                <Thumb url={current.photoUrl} alt={item.name} size="w-10 h-10"
                  onClick={on ? async () => { try { const url = await pickImage('item', 640); if (url) setItemField(item.name, { photoUrl: url }) } catch (e) { notify('error', errText(e)) } } : undefined} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm truncate ${on ? 'text-white' : 'text-gray-400'}`}>{item.name}</div>
                  <div className="text-[11px] text-gray-600">{current.category || 'без категории'}</div>
                </div>
                {on ? (
                  <select value={itemUnit(current)} onChange={e => setItemField(item.name, { unit: e.target.value === DEFAULT_UNIT ? undefined : e.target.value })}
                    className="bg-transparent text-sm text-gray-300 border border-white/10 rounded-lg px-2 py-1" aria-label="Единица">
                    {Array.from(new Set([...UNITS, itemUnit(current)])).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                ) : <span className="text-xs text-gray-600">{itemUnit(item)}</span>}
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Пользователи" subtitle="Повара ОКО принимают заказ по своей категории, доставщик отмечает отправку"
        action={<button className={primaryBtn} onClick={() => setAddingUser(true)} aria-label="Добавить пользователя"><Plus className="w-4 h-4" /> Пользователь</button>}>
        {addingUser && (
          <AddUserForm known={data.known} categories={draftCats} hasDelivery={!!draft.deliveryPerson} notify={notify}
            onCancel={() => setAddingUser(false)}
            onAdd={(u, role) => {
              if (role === 'delivery') patch({ deliveryPerson: u })
              else patch({ cookMentions: [...(draft.cookMentions || []), { ...u, category: role === '*' ? null : role }] })
              setAddingUser(false)
            }} />
        )}
        <div className={`${cardCls} divide-y divide-white/6`}>
          {users === 0 && <div className="p-4 text-sm text-gray-500">Не назначено — тогда «Принято» в группе может нажать любой.</div>}
          {(draft.cookMentions || []).map((c, i) => {
            const missing = c.category && !draftCats.includes(c.category)
            return (
              <div key={`c${i}`} className="flex items-center gap-3 px-3.5 py-2.5">
                <div className="w-10 h-10 rounded-full bg-white/8 flex items-center justify-center text-sm text-gray-300 flex-shrink-0">{firstChar(c.label)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-white truncate">{c.label}</div>
                  <div className="text-[11px] text-gray-600 truncate">{c.username ? `@${c.username}` : c.userId ? `ID ${c.userId}` : ''}</div>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full ${missing ? 'bg-amber-500/15 text-amber-300' : 'bg-sky-500/15 text-sky-300'}`} title={missing ? 'В теме нет позиций этой категории' : ''}>
                  Повар · {c.category || 'все категории'}
                </span>
                <Menu items={[{ label: 'Убрать', danger: true, onClick: () => patch({ cookMentions: (draft.cookMentions || []).filter((_, j) => j !== i) }) }]} />
              </div>
            )
          })}
          {draft.deliveryPerson && (
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="w-10 h-10 rounded-full bg-white/8 flex items-center justify-center text-sm text-gray-300 flex-shrink-0">{firstChar(draft.deliveryPerson.label)}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-white truncate">{draft.deliveryPerson.label}</div>
                <div className="text-[11px] text-gray-600 truncate">{draft.deliveryPerson.username ? `@${draft.deliveryPerson.username}` : draft.deliveryPerson.userId ? `ID ${draft.deliveryPerson.userId}` : ''}</div>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300">Доставка</span>
              <Menu items={[{ label: 'Убрать', danger: true, onClick: () => patch({ deliveryPerson: null }) }]} />
            </div>
          )}
        </div>
      </Section>

      <button className={`${primaryBtn} w-full py-3.5 text-base`} disabled={saving} onClick={save}>{saving ? 'Сохраняю…' : formKey ? 'Сохранить тему' : 'Создать тему'}</button>
    </>
  )
}

function AddItemForm({ categories, defaultCategory, existing, onAdd, onCancel, notify }: {
  categories: string[]; defaultCategory: string; existing: Set<string>
  onAdd: (i: Item) => void; onCancel: () => void; notify: ScreenProps['notify']
}) {
  const [name, setName] = useState('')
  const [cat, setCat] = useState(defaultCategory)
  const [unit, setUnit] = useState(DEFAULT_UNIT)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const add = () => {
    const n = name.trim()
    if (!n) return notify('error', 'Введите название позиции')
    if (existing.has(n)) return notify('error', 'Такая позиция уже есть в списке — отметьте её галочкой')
    const item: Item = { name: n }
    if (cat.trim()) item.category = cat.trim()
    if (unit !== DEFAULT_UNIT) item.unit = unit
    if (photoUrl) item.photoUrl = photoUrl
    onAdd(item)
  }
  return (
    <div className={`${cardCls} p-4 flex flex-col gap-3 border-green-500/30`}>
      <div className="flex items-center gap-3">
        <Thumb url={photoUrl} alt={name || '+'} size="w-12 h-12" onClick={async () => { try { const u = await pickImage('item', 640); if (u) setPhotoUrl(u) } catch (e) { notify('error', errText(e)) } }} />
        <input className={inputCls} value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="Название, например «Эклер»" autoFocus />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className={inputCls} value={cat} maxLength={60} onChange={e => setCat(e.target.value)} placeholder="Категория" list="oko-cats" />
        <datalist id="oko-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
        <select className={inputCls} value={unit} onChange={e => setUnit(e.target.value)}>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select>
      </div>
      <div className="flex gap-2 justify-end">
        <button className={ghostBtn} onClick={onCancel}><X className="w-4 h-4" /> Отмена</button>
        <button className={primaryBtn} onClick={add}><Plus className="w-4 h-4" /> Добавить</button>
      </div>
    </div>
  )
}

function AddUserForm({ known, categories, hasDelivery, onAdd, onCancel, notify }: {
  known: Known; categories: string[]; hasDelivery: boolean
  onAdd: (u: Person, role: string) => void; onCancel: () => void; notify: ScreenProps['notify']
}) {
  const people = useMemo(() => {
    const map = new Map<string, { label: string; username?: string | null }>()
    Object.values(known).forEach(c => Object.entries(c.people || {}).forEach(([id, p]) => {
      if (!map.has(id)) map.set(id, { label: personName(p, id), username: p.username })
    }))
    return Array.from(map.entries())
  }, [known])
  const [pick, setPick] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualHandle, setManualHandle] = useState('')
  const [role, setRole] = useState(categories[0] || '*')
  const add = () => {
    let user: Person | null = null
    if (pick) {
      const p = people.find(([id]) => id === pick)
      if (p) user = p[1].username ? { label: p[1].label, username: p[1].username } : { label: p[1].label, userId: Number(pick) }
    } else {
      const handle = manualHandle.trim().replace(/^@/, '')
      if (!handle) return notify('error', 'Выберите человека из списка или впишите @username / ID')
      if (/^\d+$/.test(handle)) {
        if (!manualName.trim()) return notify('error', 'Для ID укажите имя')
        user = { label: manualName.trim(), userId: Number(handle) }
      } else if (/^[A-Za-z0-9_]{4,32}$/.test(handle)) {
        user = { label: manualName.trim() || handle, username: handle }
      } else return notify('error', 'Некорректный @username')
    }
    if (!user) return
    if (role === 'delivery' && hasDelivery && !confirm('Доставщик уже назначен. Заменить?')) return
    onAdd(user, role)
  }
  return (
    <div className={`${cardCls} p-4 flex flex-col gap-3 border-green-500/30`}>
      <div className="flex items-center gap-2 text-sm text-white"><Users className="w-4 h-4 text-green-400" /> Новый пользователь</div>
      <select className={inputCls} value={pick} onChange={e => setPick(e.target.value)}>
        <option value="">— из тех, кто писал в группах с ботом —</option>
        {people.map(([id, p]) => <option key={id} value={id}>{p.label}{p.username ? ` (@${p.username})` : ''}</option>)}
      </select>
      {!pick && (
        <div className="grid grid-cols-2 gap-3">
          <input className={inputCls} value={manualHandle} onChange={e => setManualHandle(e.target.value)} placeholder="@username или ID" />
          <input className={inputCls} value={manualName} maxLength={40} onChange={e => setManualName(e.target.value)} placeholder="Имя" />
        </div>
      )}
      <Field label="Роль">
        <select className={inputCls} value={role} onChange={e => setRole(e.target.value)}>
          {categories.map(c => <option key={c} value={c}>Повар — принимает «{c}»</option>)}
          <option value="*">Повар — все категории</option>
          <option value="delivery">Доставка — отмечает отправку</option>
        </select>
      </Field>
      <div className="flex gap-2 justify-end">
        <button className={ghostBtn} onClick={onCancel}><X className="w-4 h-4" /> Отмена</button>
        <button className={primaryBtn} onClick={add}><Plus className="w-4 h-4" /> Добавить</button>
      </div>
    </div>
  )
}

// Раздел «Заказы» (Этап 4): история и статусы по всем формам.
const STATUS_META: Record<OrderStatus, { label: string; cls: string }> = {
  new: { label: '🕐 Новый', cls: 'bg-white/8 text-gray-300' },
  cooking: { label: '👨‍🍳 Готовится', cls: 'bg-amber-500/15 text-amber-300' },
  shipping: { label: '🚚 Отправляется', cls: 'bg-sky-500/15 text-sky-300' },
  delivered: { label: '✅ Доставлено', cls: 'bg-green-500/15 text-green-400' },
}
const STEP_KEYS: [OrderStatus, string][] = [['new', 'Новый'], ['cooking', 'Готовится'], ['shipping', 'Отправляется'], ['delivered', 'Доставлено']]
function stamp(ms: number) {
  return new Date(ms).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function OrdersScreen({ data, notify }: ScreenProps) {
  const [venue, setVenue] = useState('')
  const [status, setStatus] = useState<'' | OrderStatus>('')
  const [orders, setOrders] = useState<OrderView[] | null>(null)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try { setOrders((await okoApi.orders(venue || undefined)).orders) } catch (e) { notify('error', errText(e)) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [venue])
  const visible = (orders || []).filter(o => !status || o.status === status)
  const counts = (orders || []).reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc }, {} as Record<string, number>)

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Заказы</h1>
          <p className="text-sm text-gray-500 mt-1">Статусы меняются сами: «Принято» поваром, скан QR на чеке, фото чека от клиента</p>
        </div>
        <button className={ghostBtn} disabled={loading} onClick={load} aria-label="Обновить"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <select className={inputCls} value={venue} onChange={e => setVenue(e.target.value)} aria-label="Форма">
          <option value="">Все формы</option>
          {Object.entries(data.config).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
        <select className={inputCls} value={status} onChange={e => setStatus(e.target.value as any)} aria-label="Статус">
          <option value="">Все статусы</option>
          {STEP_KEYS.map(([k]) => <option key={k} value={k}>{STATUS_META[k].label}{counts[k] ? ` (${counts[k]})` : ''}</option>)}
        </select>
      </div>
      {orders === null ? <div className="text-sm text-gray-500">Загрузка…</div> : visible.length === 0 ? (
        <div className={`${cardCls} p-6 text-sm text-gray-400 text-center`}>Заказов нет</div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(o => {
            const byStatus = Object.fromEntries(o.timeline.map(e => [e.status, e]))
            return (
              <div key={o.id} className={`${cardCls} p-4 flex flex-col gap-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">{o.venueLabel}{o.date ? ` · на ${o.date}` : ''}</div>
                    <div className="text-xs text-gray-500">Отправлен {o.createdAt ? stamp(o.createdAt) : '—'}{o.name ? ` · ${o.name}` : ''}</div>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${STATUS_META[o.status].cls}`}>{STATUS_META[o.status].label}</span>
                </div>
                {o.items ? (
                  <ul className="text-sm text-gray-300 flex flex-col gap-0.5">
                    {o.items.map(i => <li key={i.name} className="flex justify-between gap-3"><span className="truncate">{i.name}</span><span className="text-gray-500 whitespace-nowrap">{i.qty} {i.unit}</span></li>)}
                  </ul>
                ) : <div className="text-xs text-gray-500 whitespace-pre-line line-clamp-4">{o.summary}</div>}
                {o.comment && <div className="text-xs text-gray-400">💬 {o.comment}</div>}
                <div className="grid grid-cols-4 gap-2">
                  {STEP_KEYS.map(([k, label]) => {
                    const e = byStatus[k]
                    return (
                      <div key={k} className={`border-t-[3px] pt-1.5 text-[11px] leading-tight ${e ? 'border-green-500 text-gray-200' : 'border-white/10 text-gray-600'}`}>
                        <div className="font-semibold">{label}</div>
                        <div>{e ? stamp(e.at) : '—'}</div>
                        {k === 'shipping' && e?.via === 'qr' && <div className="text-gray-500">по QR</div>}
                        {e?.trackUrl && <a href={e.trackUrl} target="_blank" rel="noopener noreferrer" className="text-green-400 underline">трек</a>}
                        {k === 'delivered' && e && o.receiptPhoto && <div className="text-gray-500">фото чека в группе</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

// Шаг 4 — готово
function DoneScreen({ data, reload, setView, notify, chatId, formKey }: ScreenProps & { chatId: string; formKey: string }) {
  const form = data.config[formKey]
  const g = data.groups[chatId]
  const [pinning, setPinning] = useState(false)
  if (!form) return null
  const groupActive = g ? g.active !== false : true
  const users = (form.cookMentions || []).length + (form.deliveryPerson ? 1 : 0)
  const checks = [
    { ok: true, text: 'Telegram-группа подключена' },
    { ok: true, text: `Создана тема «${form.label}»` },
    { ok: form.items.length > 0, text: `Добавлены позиции (${form.items.length})` },
    { ok: users > 0, text: `Добавлены пользователи (${users})` },
    { ok: groupActive && form.active !== false, text: groupActive ? 'Группа активна' : 'Группа выключена' },
    { ok: !!form.pinned, text: form.pinned ? 'Кнопка «Заполнить заказ» закреплена' : 'Кнопка ещё не закреплена в теме' },
  ]
  const pin = async () => {
    setPinning(true)
    try { await okoApi.pin(formKey); await reload(); notify('ok', 'Кнопка отправлена и закреплена') } catch (e) { notify('error', errText(e)) } finally { setPinning(false) }
  }
  return (
    <div className="flex flex-col items-center text-center gap-5 py-4">
      <div className="w-24 h-24 rounded-full bg-green-500 flex items-center justify-center shadow-[0_0_60px_rgba(34,197,94,0.35)]">
        <Check className="w-12 h-12 text-[#04140a]" strokeWidth={3} />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-white">Группа {groupTitle(data, chatId)} настроена!</h1>
        <p className="text-sm text-gray-400 mt-2 max-w-md">Клиент нажимает кнопку в своей теме и отправляет заказ, а повара ОКО получают его в Telegram и на принтере.</p>
      </div>
      <div className={`${cardCls} p-5 w-full max-w-md text-left`}>
        <div className="text-sm font-semibold text-white mb-3">Что настроено:</div>
        <ul className="flex flex-col gap-2.5">
          {checks.map(c => (
            <li key={c.text} className="flex items-center gap-3 text-sm">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${c.ok ? 'bg-green-500' : 'bg-white/10'}`}>
                {c.ok ? <Check className="w-3 h-3 text-[#04140a]" strokeWidth={3} /> : <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />}
              </span>
              <span className={c.ok ? 'text-gray-200' : 'text-gray-500'}>{c.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2.5 w-full max-w-md">
        {!form.pinned && (
          <button className={`${primaryBtn} py-3`} disabled={pinning} onClick={pin}>
            <Send className="w-4 h-4" /> {pinning ? 'Отправляю…' : 'Закрепить кнопку в теме клиента'}
          </button>
        )}
        <button className={`${form.pinned ? primaryBtn : ghostBtn} py-3`} onClick={() => setView({ name: 'group', chatId })}>Перейти к группе</button>
        <button className={`${ghostBtn} py-3`} onClick={() => setView({ name: 'connect' })}>Подключить ещё одну группу</button>
      </div>
      <button className="text-xs text-gray-500 hover:text-gray-300" onClick={() => setView({ name: 'groups' })}>Все группы</button>
    </div>
  )
}
