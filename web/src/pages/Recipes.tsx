import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus, FileUp, BookOpen, Archive, Link2 } from 'lucide-react'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { yieldLabel, plural } from '../lib/format'
import type { Category, RecipeListItem } from '../lib/types'
import { Empty, ErrorBox, Spinner } from '../components/ui'
import { RecipeDetail } from '../components/RecipeDetail'
import { ImportModal } from '../components/ImportModal'
import { IikoModal } from '../components/IikoModal'
import { useIsDesktop } from '../hooks/useMedia'

type Kind = '' | 'dish' | 'semi'

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export function Thumb({ r, size = 'h-12 w-12' }: { r: Pick<RecipeListItem, 'name' | 'photo' | 'kind'>; size?: string }) {
  if (r.photo) return <img src={r.photo} alt="" loading="lazy" className={`${size} rounded-xl object-cover flex-shrink-0 bg-paper-2`} />
  const letter = r.name.replace(/^(п\/ф|пф)\s*/i, '').trim().charAt(0).toUpperCase() || '·'
  return (
    <div className={`${size} rounded-xl flex-shrink-0 flex items-center justify-center text-lg font-extrabold
      ${r.kind === 'semi' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand-ink'}`}>{letter}</div>
  )
}

export function RecipesPage() {
  const { id } = useParams()
  const selectedId = id ? Number(id) : null
  const navigate = useNavigate()
  const { can } = useSession()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') || '')
  const category = params.get('category') || ''
  const kind = (params.get('kind') || '') as Kind
  const archived = params.get('archived') === '1'
  const [importOpen, setImportOpen] = useState(false)
  const [iikoOpen, setIikoOpen] = useState(false)
  const isDesktop = useIsDesktop()
  const dq = useDebounced(q, 250)

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }
  useEffect(() => { setParam('q', dq) }, [dq]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') })
  const listQuery = new URLSearchParams({ q: dq, category, kind, status: archived ? 'archived' : 'active' }).toString()
  const { data: recipes, isLoading, error } = useQuery({
    queryKey: ['recipes', listQuery],
    queryFn: () => api<RecipeListItem[]>('/recipes?' + listQuery),
    placeholderData: prev => prev,
  })

  const hasFilters = !!(dq || category || kind)
  const search = params.toString() ? '?' + params.toString() : ''
  const groups = useMemo(() => recipes || [], [recipes])

  const list = (
    <div className="flex flex-col min-h-0">
      <div className="px-4 lg:px-6 pt-5 pb-3 space-y-3 bg-paper sticky top-14 lg:top-0 z-20">
        <div className="flex items-center justify-between gap-2">
          <h1 className="h-page">{archived ? 'Архив ТТК' : 'ТТК'}</h1>
          {can('owner') && !archived && (
            <div className="flex gap-1.5">
              <button className="btn-outline btn-icon h-9 w-9 lg:w-auto lg:px-3" onClick={() => setIikoOpen(true)} title="Подключение к iiko">
                <Link2 className="h-4 w-4" /><span className="hidden lg:inline">iiko</span>
              </button>
              <button className="btn-outline btn-icon h-9 w-9 lg:w-auto lg:px-3" onClick={() => setImportOpen(true)} title="Импорт из Excel">
                <FileUp className="h-4 w-4" /><span className="hidden lg:inline">Импорт</span>
              </button>
              <Link to="/recipes/new" className="btn-primary h-9"><Plus className="h-4 w-4" />ТТК</Link>
            </div>
          )}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
          <input className="input pl-9" placeholder="Название или ингредиент" value={q} onChange={e => setQ(e.target.value)} type="search" />
        </div>

        <div className="flex gap-1.5 overflow-x-auto scrollbar-none -mx-4 px-4 lg:mx-0 lg:px-0 lg:flex-wrap">
          <button className={`chip ${!category ? 'chip-active' : ''}`} onClick={() => setParam('category', '')}>Все</button>
          {categories.map(c => (
            <button key={c.id} className={`chip ${category === String(c.id) ? 'chip-active' : ''}`}
              onClick={() => setParam('category', category === String(c.id) ? '' : String(c.id))}>{c.name}</button>
          ))}
          {categories.length > 0 && (
            <button className={`chip ${category === 'none' ? 'chip-active' : ''}`} onClick={() => setParam('category', category === 'none' ? '' : 'none')}>Без категории</button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-xl bg-paper-2 p-0.5 text-[13px] font-semibold">
            {([['', 'Все'], ['dish', 'Блюда'], ['semi', 'Полуфабрикаты']] as const).map(([v, l]) => (
              <button key={v} onClick={() => setParam('kind', v)}
                className={`px-3 h-8 rounded-[10px] transition-colors ${kind === v ? 'bg-paper-card shadow-card text-ink' : 'text-ink-muted'}`}>{l}</button>
            ))}
          </div>
          {can('owner') && (
            <button className="btn-ghost btn-sm" onClick={() => setParam('archived', archived ? '' : '1')}>
              <Archive className="h-3.5 w-3.5" />{archived ? 'Действующие' : 'Архив'}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 lg:px-6 pb-6">
        {error ? <ErrorBox error={error} /> : isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !groups.length ? (
          hasFilters
            ? <Empty icon={<Search className="h-8 w-8" />} title="Ничего не нашлось" text="Попробуйте другой запрос или сбросьте фильтры." />
            : archived
              ? <Empty icon={<Archive className="h-8 w-8" />} title="Архив пуст" />
              : <Empty icon={<BookOpen className="h-8 w-8" />} title="Пока ни одной ТТК"
                  text={can('owner') ? 'Создайте первую карту вручную или загрузите выгрузку из Excel.' : 'Здесь появятся технологические карты заведения.'}
                  action={can('owner') && <Link to="/recipes/new" className="btn-primary"><Plus className="h-4 w-4" />Новая ТТК</Link>} />
        ) : (
          <>
            <p className="text-xs muted mb-2">{groups.length} {plural(groups.length, 'карта', 'карты', 'карт')}</p>
            <ul className="card divide-y divide-line overflow-hidden">
              {groups.map(r => (
                <li key={r.id}>
                  <Link to={`/recipes/${r.id}${search}`}
                    className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${selectedId === r.id ? 'bg-brand-soft/60' : 'hover:bg-paper'}`}>
                    <Thumb r={r} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[15px] leading-snug truncate">{r.name}</p>
                      <p className="text-[13px] muted truncate">
                        {[r.category_name, yieldLabel(r), r.ingredient_count ? `${r.ingredient_count} ${plural(r.ingredient_count, 'ингредиент', 'ингредиента', 'ингредиентов')}` : 'состав пуст']
                          .filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {r.iiko_managed_at && <span className="tag bg-paper-2 text-ink-2" title="Синхронизируется с iiko">iiko</span>}
                    {r.kind === 'semi' && <span className="tag bg-warn-soft text-warn">п/ф</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )

  return (
    <>
      {isDesktop ? (
        // Десктоп: список слева со своей прокруткой, карточка справа
        <div className="grid grid-cols-[minmax(360px,420px)_1fr]">
          <div className="border-r border-line sticky top-0 h-dvh overflow-y-auto">{list}</div>
          <div className="min-w-0">
            {selectedId
              ? <RecipeDetail key={selectedId} id={selectedId} />
              : <Empty icon={<BookOpen className="h-10 w-10" />} title="Выберите карту слева" text="Здесь откроется состав, технология и калькулятор пересчёта." />}
          </div>
        </div>
      ) : selectedId ? (
        <RecipeDetail key={selectedId} id={selectedId} onBack={() => navigate('/recipes' + search)} />
      ) : list}
      {importOpen && <ImportModal categories={categories} onClose={() => setImportOpen(false)} />}
      {iikoOpen && <IikoModal onClose={() => setIikoOpen(false)} />}
    </>
  )
}
