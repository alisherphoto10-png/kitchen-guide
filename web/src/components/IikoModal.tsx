// Подключение заведения к iiko и импорт ТТК (модуль «Интеграция с iiko»).
// Учётные данные — свои у заведения, вводит владелец; пароль наружу не отдаётся.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Lock, RefreshCw, Download, Trash2, CheckCircle2, AlertTriangle, Pencil } from 'lucide-react'
import { api } from '../lib/api'
import { relDate, plural } from '../lib/format'
import { MODULE_LOCKED_TEXT, useModule } from '../lib/modules'
import type { IikoConnection, IikoImportResult } from '../lib/types'
import { Modal, Spinner, errText, toast, useConfirm } from './ui'

export function IikoModal({ onClose }: { onClose: () => void }) {
  const enabled = useModule('iiko')
  return (
    <Modal title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-brand" />Подключение к iiko</span>} onClose={onClose}>
      {enabled ? <IikoPanel /> : (
        <div className="grid gap-3 text-sm text-ink-2">
          <p>Техкарты и полуфабрикаты подтягиваются прямо из вашей iiko — без выгрузки в Excel. Повторный импорт обновляет карты, а не создаёт копии.</p>
          <p className="flex items-start gap-2 rounded-xl bg-paper-2 px-3 py-2.5 text-[13px]"><Lock className="h-4 w-4 flex-shrink-0 mt-0.5 text-ink-muted" />{MODULE_LOCKED_TEXT}.</p>
        </div>
      )}
    </Modal>
  )
}

function IikoPanel() {
  const qc = useQueryClient()
  const key = ['iiko']
  const { data: conn, isLoading } = useQuery({ queryKey: key, queryFn: () => api<IikoConnection | null>('/iiko') })
  const [editing, setEditing] = useState(false)
  const [lastResult, setLastResult] = useState<IikoImportResult | null>(null)
  const [confirm, confirmNode] = useConfirm()
  const onError = (e: unknown) => { toast(errText(e), 'error'); qc.invalidateQueries({ queryKey: key }) }

  const test = useMutation({
    mutationFn: () => api<IikoConnection>('/iiko/test', { method: 'POST' }),
    onSuccess: c => { qc.setQueryData(key, c); toast('iiko отвечает, вход выполнен') }, onError,
  })
  const run = useMutation({
    mutationFn: () => api<IikoImportResult>('/iiko/import', { method: 'POST' }),
    onSuccess: r => {
      setLastResult(r)
      toast(`Импорт завершён: новых ${r.created}, обновлено ${r.updated}`)
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe'] })
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: () => api('/iiko', { method: 'DELETE' }),
    onSuccess: () => { qc.setQueryData(key, null); toast('Подключение удалено') }, onError,
  })
  const busy = test.isPending || run.isPending || remove.isPending

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>
  if (!conn || editing) return <ConnectionForm conn={conn ?? null} onDone={() => setEditing(false)} />

  const result = lastResult ?? conn.last_import_result
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-line px-3 py-2.5 text-[13px] grid gap-0.5">
        <p><span className="muted">Сервер: </span><span className="font-mono break-all">{conn.base_url}</span></p>
        <p><span className="muted">Логин: </span><span className="font-semibold">{conn.login}</span> <span className="muted">· пароль сохранён</span></p>
        <p className="muted">Проверено {relDate(conn.last_test_ok_at)}{conn.last_import_at && <> · последний импорт {relDate(conn.last_import_at)}</>}</p>
      </div>

      {conn.last_error
        ? <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-[13px] text-warn"><AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />{conn.last_error}</p>
        : <p className="flex items-center gap-1.5 text-[13px] text-ok"><CheckCircle2 className="h-4 w-4" />Подключение работает.</p>}

      <div className="grid gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => run.mutate()}>
          <Download className="h-4 w-4" />{run.isPending ? 'Импортируем из iiko…' : 'Импортировать ТТК из iiko'}
        </button>
        <p className="text-xs muted">Берётся актуальная версия каждой техкарты. Полуфабрикаты iiko становятся полуфабрикатами здесь и сами связываются с блюдами. Состав и выход таких карт меняются только повторным импортом; фото, категорию, технологию и примечание можно править как обычно.</p>
      </div>

      {result && <ImportSummary r={result} />}

      <div className="flex flex-wrap gap-2 pt-1">
        <button className="btn-outline btn-sm" disabled={busy} onClick={() => test.mutate()}><RefreshCw className="h-3.5 w-3.5" />{test.isPending ? 'Проверяем…' : 'Проверить'}</button>
        <button className="btn-outline btn-sm" disabled={busy} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" />Изменить</button>
        <button className="btn-danger btn-sm ml-auto" disabled={busy} onClick={async () => {
          if (await confirm({ title: 'Удалить подключение к iiko?', text: 'Логин и пароль iiko будут стёрты. Уже импортированные карты останутся как есть.', ok: 'Удалить', danger: true })) remove.mutate()
        }}><Trash2 className="h-3.5 w-3.5" />Удалить</button>
      </div>
      {confirmNode}
    </div>
  )
}

function ConnectionForm({ conn, onDone }: { conn: IikoConnection | null; onDone: () => void }) {
  const qc = useQueryClient()
  const [baseUrl, setBaseUrl] = useState(conn?.base_url || '')
  const [login, setLogin] = useState(conn?.login || '')
  const [password, setPassword] = useState('')
  const save = useMutation({
    mutationFn: () => api<IikoConnection>('/iiko', { method: 'PUT', body: { base_url: baseUrl, login, password } }),
    onSuccess: c => { qc.setQueryData(['iiko'], c); toast('iiko подключена'); onDone() },
    onError: e => toast(errText(e), 'error'),
  })
  const ready = baseUrl.trim() && login.trim() && (password || conn)
  return (
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (ready) save.mutate() }}>
      {!conn && <p className="text-sm text-ink-2">Введите адрес вашего сервера iiko и данные пользователя iiko. Мы проверим вход и сохраним пароль в зашифрованном виде.</p>}
      <label>
        <span className="field-label">Адрес iiko</span>
        <input className="input font-mono text-[13px]" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://ваш-адрес.iiko.it/resto" autoComplete="off" spellCheck={false} autoFocus />
      </label>
      <label>
        <span className="field-label">Логин iiko</span>
        <input className="input" value={login} onChange={e => setLogin(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label>
        <span className="field-label">Пароль iiko</span>
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
          placeholder={conn ? 'не менять' : ''} autoComplete="new-password" />
      </label>
      <p className="text-xs muted">Лучше завести в iiko отдельного пользователя только для чтения техкарт и номенклатуры.</p>
      <div className="flex gap-2 justify-end">
        {conn && <button type="button" className="btn-ghost" onClick={onDone}>Отмена</button>}
        <button className="btn-primary" disabled={!ready || save.isPending}>{save.isPending ? 'Проверяем вход в iiko…' : conn ? 'Сохранить' : 'Подключить'}</button>
      </div>
    </form>
  )
}

function ImportSummary({ r }: { r: IikoImportResult }) {
  const list = (title: string, names: string[]) => names.length > 0 && (
    <details className="text-[13px]">
      <summary className="cursor-pointer font-semibold">{title} ({names.length})</summary>
      <ul className="mt-1 pl-4 list-disc text-ink-2 max-h-40 overflow-y-auto">{names.map((n, i) => <li key={i}>{n}</li>)}</ul>
    </details>
  )
  return (
    <div className="rounded-xl bg-paper-2/60 px-3 py-2.5 grid gap-1.5">
      <p className="text-[13px]">
        {r.total} {plural(r.total, 'карта', 'карты', 'карт')} в iiko: новых <b>{r.created}</b>, обновлено <b>{r.updated}</b>, без изменений {r.unchanged}
        {r.skipped > 0 && <>, пропущено {r.skipped}</>}.
        {r.linked > 0 && <> Связей с полуфабрикатами: {r.linked}.</>}
        {r.skipped_rows > 0 && <> Строк состава без продукта в номенклатуре: {r.skipped_rows}.</>}
      </p>
      {list('Новые', r.created_names)}
      {list('Обновлены', r.updated_names)}
      {list('Пропущены', r.skipped_names)}
    </div>
  )
}
