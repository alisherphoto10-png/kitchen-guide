import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ArrowDown, Pencil, Trash2, Plus, Check, X, Tags } from 'lucide-react'
import { api } from '../lib/api'
import { plural } from '../lib/format'
import type { Category } from '../lib/types'
import { Empty, ErrorBox, PageLoader, errText, toast, useConfirm } from '../components/ui'

export function CategoriesPage() {
  const qc = useQueryClient()
  const { data: cats, isLoading, error } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') })
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [confirm, confirmNode] = useConfirm()
  const refresh = () => { qc.invalidateQueries({ queryKey: ['categories'] }); qc.invalidateQueries({ queryKey: ['recipes'] }) }
  const onError = (e: unknown) => toast(errText(e), 'error')

  const create = useMutation({
    mutationFn: () => api('/categories', { method: 'POST', body: { name } }),
    onSuccess: () => { setName(''); refresh() }, onError,
  })
  const rename = useMutation({
    mutationFn: (c: { id: number; name: string }) => api('/categories/' + c.id, { method: 'PUT', body: { name: c.name } }),
    onSuccess: () => { setEditing(null); refresh() }, onError,
  })
  const remove = useMutation({
    mutationFn: (id: number) => api('/categories/' + id, { method: 'DELETE' }),
    onSuccess: () => { toast('Категория удалена'); refresh() }, onError,
  })
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api('/categories/order', { method: 'PUT', body: { ids } }),
    onMutate: ids => {
      qc.setQueryData<Category[]>(['categories'], old => old && ids.map(id => old.find(c => c.id === id)!))
    },
    onSettled: refresh, onError,
  })

  const move = (idx: number, dir: -1 | 1) => {
    if (!cats) return
    const ids = cats.map(c => c.id)
    const j = idx + dir;
    [ids[idx], ids[j]] = [ids[j], ids[idx]]
    reorder.mutate(ids)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 lg:px-8 pt-5 lg:pt-8">
      <h1 className="h-page">Категории</h1>
      <p className="text-sm muted mt-1 mb-5">Разделы меню для фильтра в списке ТТК. Порядок здесь — порядок кнопок-фильтров.</p>

      <form className="flex gap-2 mb-5" onSubmit={e => { e.preventDefault(); if (name.trim()) create.mutate() }}>
        <input className="input" placeholder="Новая категория, напр. «Горячее»" value={name} onChange={e => setName(e.target.value)} maxLength={100} />
        <button className="btn-primary" disabled={!name.trim() || create.isPending}><Plus className="h-4 w-4" />Добавить</button>
      </form>

      {isLoading ? <PageLoader /> : error ? <ErrorBox error={error} /> : !cats?.length ? (
        <Empty icon={<Tags className="h-8 w-8" />} title="Категорий пока нет" text="Например: Салаты, Горячее, Соусы, Заготовки." />
      ) : (
        <ul className="card divide-y divide-line">
          {cats.map((c, idx) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              {editing?.id === c.id ? (
                <form className="flex-1 flex gap-1.5" onSubmit={e => { e.preventDefault(); rename.mutate(editing) }}>
                  <input className="input h-9" autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} maxLength={100} />
                  <button className="btn-primary btn-sm h-9 w-9 px-0" aria-label="Сохранить"><Check className="h-4 w-4" /></button>
                  <button type="button" className="btn-ghost btn-sm h-9 w-9 px-0" onClick={() => setEditing(null)} aria-label="Отмена"><X className="h-4 w-4" /></button>
                </form>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs muted">{c.recipe_count} {plural(c.recipe_count, 'карта', 'карты', 'карт')}</p>
                  </div>
                  <button className="btn-ghost btn-sm w-8 px-0" disabled={idx === 0 || reorder.isPending} onClick={() => move(idx, -1)} aria-label="Выше"><ArrowUp className="h-4 w-4" /></button>
                  <button className="btn-ghost btn-sm w-8 px-0" disabled={idx === cats.length - 1 || reorder.isPending} onClick={() => move(idx, 1)} aria-label="Ниже"><ArrowDown className="h-4 w-4" /></button>
                  <button className="btn-ghost btn-sm w-8 px-0" onClick={() => setEditing({ id: c.id, name: c.name })} aria-label="Переименовать"><Pencil className="h-4 w-4" /></button>
                  <button className="btn-danger btn-sm w-8 px-0" aria-label="Удалить" onClick={async () => {
                    if (await confirm({
                      title: `Удалить «${c.name}»?`, danger: true, ok: 'Удалить',
                      text: c.recipe_count ? `${c.recipe_count} ${plural(c.recipe_count, 'карта останется', 'карты останутся', 'карт останутся')} без категории — сами карты не удалятся.` : undefined,
                    })) remove.mutate(c.id)
                  }}><Trash2 className="h-4 w-4" /></button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirmNode}
    </div>
  )
}
