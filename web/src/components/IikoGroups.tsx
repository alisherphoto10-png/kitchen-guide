// Папки номенклатуры iiko деревом с галочками: из каких импортировать техкарты.
// Схема — как в KitchenDesk (PART-13): у каждой папки своя галочка, импорт
// берёт карту, если её товар лежит прямо в отмеченной папке. Галочка у
// родителя отмечает/снимает всю ветку. Ещё не выбирали — отмечено всё.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, FolderTree } from 'lucide-react'
import { api } from '../lib/api'
import { plural } from '../lib/format'
import type { IikoConnection, IikoGroup } from '../lib/types'
import { ErrorBox, Spinner, errText, toast } from './ui'

const allIds = (nodes: IikoGroup[]): string[] => nodes.flatMap(n => [n.id, ...allIds(n.children)])

export function IikoGroups({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['iiko-groups'],
    queryFn: () => api<{ tree: IikoGroup[]; selected: string[] | null }>('/iiko/groups'),
    staleTime: 0, gcTime: 0,
  })
  const [checked, setChecked] = useState<Set<string> | null>(null)
  const ids = useMemo(() => (data ? allIds(data.tree) : []), [data])
  // До первой правки — сохранённый выбор, а если его нет, всё дерево.
  const sel = checked ?? new Set(data?.selected ?? ids)

  const save = useMutation({
    mutationFn: () => api<IikoConnection>('/iiko/groups', { method: 'PUT', body: { group_ids: ids.filter(id => sel.has(id)) } }),
    onSuccess: c => { qc.setQueryData(['iiko'], c); toast('Папки сохранены — следующий импорт возьмёт только их'); onDone() },
    onError: e => toast(errText(e), 'error'),
  })

  if (isLoading) return <div className="flex justify-center py-8"><Spinner /></div>
  if (error || !data) return <div className="grid gap-3"><ErrorBox error={error} /><button className="btn-ghost justify-self-start" onClick={onDone}>Назад</button></div>

  const toggle = (node: IikoGroup, on: boolean) => {
    const next = new Set(sel)
    for (const id of [node.id, ...allIds(node.children)]) on ? next.add(id) : next.delete(id)
    setChecked(next)
  }
  const cards = (n: number) => `${n} ${plural(n, 'карта', 'карты', 'карт')}`
  const picked = ids.filter(id => sel.has(id)).length

  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-2">Отметьте папки iiko, из которых брать техкарты — например, кухню без бара. Карта импортируется, если блюдо лежит прямо в отмеченной папке. Уже импортированные карты это не удаляет.</p>
      {!data.tree.length ? (
        <p className="text-sm muted">В iiko нет ни папок, ни техкарт.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <span className="muted">Отмечено {picked} из {ids.length}</span>
            <span className="flex gap-1">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setChecked(new Set(ids))}>Все</button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setChecked(new Set())}>Снять все</button>
            </span>
          </div>
          <ul className="rounded-xl border border-line py-1 max-h-[50dvh] overflow-y-auto" role="tree">
            {data.tree.map(n => <Node key={n.id} node={n} sel={sel} onToggle={toggle} depth={0} cards={cards} />)}
          </ul>
        </>
      )}
      {picked === 0 && ids.length > 0 && <p className="text-[13px] text-warn">Ничего не отмечено — импорт не возьмёт ни одной карты.</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={onDone}>Отмена</button>
        <button type="button" className="btn-primary" disabled={save.isPending || !data.tree.length} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </div>
  )
}

function Node({ node, sel, onToggle, depth, cards }: {
  node: IikoGroup; sel: Set<string>; onToggle: (n: IikoGroup, on: boolean) => void; depth: number; cards: (n: number) => string
}) {
  const [open, setOpen] = useState(depth === 0)
  const branch = [node.id, ...allIds(node.children)]
  const on = branch.filter(id => sel.has(id)).length
  const all = on === branch.length
  const some = on > 0 && !all
  return (
    <li role="treeitem" aria-expanded={node.children.length ? open : undefined}>
      <div className="flex items-center gap-1.5 pr-3 py-1 hover:bg-paper" style={{ paddingLeft: 8 + depth * 18 }}>
        {node.children.length ? (
          <button type="button" className="h-6 w-6 flex items-center justify-center text-ink-muted" onClick={() => setOpen(o => !o)} aria-label={open ? 'Свернуть' : 'Развернуть'}>
            <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : <span className="w-6" />}
        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#B4471F]" checked={all}
            ref={el => { if (el) el.indeterminate = some }} onChange={() => onToggle(node, !all)} />
          <span className={`truncate ${node.total ? '' : 'text-ink-muted'}`}>{node.name}</span>
          <span className="ml-auto text-xs muted whitespace-nowrap">
            {node.children.length && node.total !== node.count ? `${cards(node.count)} · в ветке ${node.total}` : cards(node.count)}
          </span>
        </label>
      </div>
      {open && node.children.length > 0 && (
        <ul role="group">{node.children.map(c => <Node key={c.id} node={c} sel={sel} onToggle={onToggle} depth={depth + 1} cards={cards} />)}</ul>
      )}
    </li>
  )
}

export function GroupsSummary({ conn, onEdit, disabled }: { conn: IikoConnection; onEdit: () => void; disabled?: boolean }) {
  const n = conn.group_ids?.length
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px]">
      <FolderTree className="h-4 w-4 text-ink-muted flex-shrink-0" />
      <span className="flex-1">Папки iiko: <b>{conn.group_ids === null ? 'все' : n ? `выбрано ${n}` : 'ничего не выбрано'}</b></span>
      <button className="btn-outline btn-sm" disabled={disabled} onClick={onEdit}>Выбрать</button>
    </div>
  )
}
