// Тонкий клиент к API. Токен и выбранное администратором платформы заведение
// лежат в localStorage — это только удобство браузера; права всегда решает сервер.

const TOKEN_KEY = 'zg_token'
const TENANT_KEY = 'zg_tenant'

function read(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* приватный режим */ }
}

export const session = {
  token: () => read(TOKEN_KEY),
  setToken: (t: string | null) => write(TOKEN_KEY, t),
  tenantOverride: () => { const v = read(TENANT_KEY); return v ? Number(v) : null },
  setTenantOverride: (id: number | null) => write(TENANT_KEY, id === null ? null : String(id)),
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function headers(extra?: HeadersInit): HeadersInit {
  const h: Record<string, string> = {}
  const t = session.token()
  if (t) h.Authorization = 'Bearer ' + t
  const tenant = session.tenantOverride()
  if (tenant) h['X-Tenant-Id'] = String(tenant)
  return { ...h, ...extra }
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn }

async function handle(res: Response) {
  if (res.status === 401 && session.token()) {
    session.setToken(null)
    onUnauthorized?.()
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(body?.error || `Ошибка ${res.status}`, res.status)
  }
  return res
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await handle(await fetch('/api' + path, {
    method: init.method || 'GET',
    headers: headers(init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  }))
  return res.json()
}

export async function upload<T>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData()
  form.append(field, file)
  const res = await handle(await fetch('/api' + path, { method: 'POST', headers: headers(), body: form }))
  return res.json()
}

// Скачивание файла с авторизацией: <a href> не умеет слать заголовок Bearer.
export async function download(path: string, fallbackName: string) {
  const res = await handle(await fetch('/api' + path, { headers: headers() }))
  const cd = res.headers.get('Content-Disposition') || ''
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd)
  const name = m ? decodeURIComponent(m[1]) : fallbackName
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
