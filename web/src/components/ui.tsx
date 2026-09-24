import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, CheckCircle2, AlertCircle } from 'lucide-react'

// ── уведомления ──────────────────────────────────────────────────────

type Toast = { id: number; text: string; kind: 'ok' | 'error' }
let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())

export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, kind }]
  emit()
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emit() }, kind === 'error' ? 5000 : 2600)
}

export function Toaster() {
  const list = useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => toasts)
  return createPortal(
    <div className="fixed z-[100] left-1/2 -translate-x-1/2 bottom-24 lg:bottom-6 flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,420px)]">
      {list.map(t => (
        <div key={t.id} role="status"
          className={`pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-pop w-full
            ${t.kind === 'error' ? 'bg-bad text-white' : 'bg-ink text-paper'}`}>
          {t.kind === 'error' ? <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> : <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Что-то пошло не так')

// ── модалка ──────────────────────────────────────────────────────────

export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-ink/40 backdrop-blur-[2px] sm:p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true"
        className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'} max-h-[92dvh] flex flex-col bg-paper-card rounded-t-2xl sm:rounded-2xl shadow-pop`}>
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
          <h2 className="text-base font-bold">{title}</h2>
          <button onClick={onClose} className="btn-icon btn-ghost -mr-2 h-9 w-9" aria-label="Закрыть"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex flex-wrap justify-end gap-2 safe-bottom">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

// Подтверждение действия: const confirm = useConfirm(); if (await confirm({...})) ...
type ConfirmOpts = { title: string; text?: ReactNode; ok?: string; danger?: boolean }
export function useConfirm(): [(o: ConfirmOpts) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const ask = (o: ConfirmOpts) => new Promise<boolean>(resolve => setState({ ...o, resolve }))
  const close = (v: boolean) => { state?.resolve(v); setState(null) }
  const node = state && (
    <Modal title={state.title} onClose={() => close(false)}
      footer={<>
        <button className="btn-ghost" onClick={() => close(false)}>Отмена</button>
        <button className={state.danger ? 'btn bg-bad text-white hover:bg-bad/90' : 'btn-primary'} onClick={() => close(true)} autoFocus>
          {state.ok || 'Да'}
        </button>
      </>}>
      {state.text && <div className="text-sm text-ink-2">{state.text}</div>}
    </Modal>
  )
  return [ask, node]
}

// ── мелочи ───────────────────────────────────────────────────────────

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`h-5 w-5 animate-spin text-ink-muted ${className}`} />
}

export function PageLoader() {
  return <div className="flex justify-center py-16"><Spinner /></div>
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center py-14 px-6">
      {icon && <div className="mb-3 text-ink-faint">{icon}</div>}
      <p className="font-bold">{title}</p>
      {text && <p className="text-sm muted mt-1 max-w-sm">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="rounded-xl bg-bad-soft text-bad px-4 py-3 text-sm">{errText(error)}</div>
}

// Пароль показывается один раз — после закрытия его больше не увидеть.
export function SecretReveal({ label, login, password }: { label: string; login?: string; password: string }) {
  const [copied, setCopied] = useState(false)
  const text = login ? `Логин: ${login}\nПароль: ${password}` : password
  return (
    <div className="rounded-xl border border-warn/30 bg-warn-soft p-4">
      <p className="text-[13px] font-semibold text-warn mb-2">{label}</p>
      <pre className="font-mono text-[15px] leading-relaxed whitespace-pre-wrap select-all">{text}</pre>
      <button className="btn-outline btn-sm mt-3" onClick={() => {
        navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      }}>{copied ? 'Скопировано' : 'Скопировать'}</button>
    </div>
  )
}
