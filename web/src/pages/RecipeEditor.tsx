import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, X } from 'lucide-react'
import { api, upload } from '../lib/api'
import { fmt, parseNum } from '../lib/format'
import type { Category, Recipe, RecipeKind, RecipeListItem } from '../lib/types'
import { ErrorBox, PageLoader, errText, toast } from '../components/ui'

const UNITS = ['кг', 'г', 'л', 'мл', 'шт']

type Row = { key: number; name: string; brutto: string; netto: string; loss: string; unit: string; linked: number | null }
let rowKey = 1
const emptyRow = (unit = 'кг'): Row => ({ key: rowKey++, name: '', brutto: '', netto: '', loss: '', unit, linked: null })

interface Form {
  name: string; kind: RecipeKind; category_id: string
  yield_weight: string; yield_unit: string; yield_count: string
  calories: string; protein: string; fat: string; carbs: string
  cooking: string; note: string
}
const s = (v: number | null | undefined) => (v == null ? '' : fmt(v, 4))

function fromRecipe(r: Recipe): { form: Form; rows: Row[] } {
  return {
    form: {
      name: r.name, kind: r.kind, category_id: r.category_id ? String(r.category_id) : '',
      yield_weight: s(r.yield_weight), yield_unit: r.yield_unit || 'кг', yield_count: s(r.yield_count),
      calories: s(r.calories), protein: s(r.protein), fat: s(r.fat), carbs: s(r.carbs),
      cooking: r.cooking, note: r.note,
    },
    rows: r.ingredients.map(i => ({
      key: rowKey++, name: i.name, brutto: s(i.brutto), netto: s(i.netto), loss: s(i.loss_percent),
      unit: i.unit || '', linked: i.linked_recipe_id,
    })),
  }
}

const EMPTY_FORM: Form = {
  name: '', kind: 'dish', category_id: '', yield_weight: '', yield_unit: 'кг', yield_count: '',
  calories: '', protein: '', fat: '', carbs: '', cooking: '', note: '',
}

// То же правило, что на сервере (services/recipes.js completeIngredient): из двух
// известных величин досчитываем третью, заданные не трогаем.
function complete(r: Row): Row {
  const b = parseNum(r.brutto), n = parseNum(r.netto), l = parseNum(r.loss)
  const ok = (x: number | null): x is number => x !== null && !Number.isNaN(x)
  if (ok(b) && ok(n) && r.loss.trim() === '' && b > 0) return { ...r, loss: fmt((1 - n / b) * 100, 2) }
  if (ok(b) && ok(l) && r.netto.trim() === '') return { ...r, netto: fmt(b * (1 - l / 100), 4) }
  if (ok(n) && ok(l) && r.brutto.trim() === '' && l < 100) return { ...r, brutto: fmt(n / (1 - l / 100), 4) }
  return r
}

const bad = (v: string) => Number.isNaN(parseNum(v))

export function RecipeEditorPage() {
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const { data: recipe, isLoading, error } = useQuery({
    queryKey: ['recipe', editId], queryFn: () => api<Recipe>('/recipes/' + editId), enabled: !!editId,
  })
  if (editId && isLoading) return <PageLoader />
  if (editId && (error || !recipe)) return <div className="p-6"><ErrorBox error={error} /></div>
  return <Editor key={editId ?? 'new'} recipe={recipe ?? null} />
}

function Editor({ recipe }: { recipe: Recipe | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const init = useMemo(() => (recipe ? fromRecipe(recipe) : { form: EMPTY_FORM, rows: [emptyRow(), emptyRow(), emptyRow()] }), [recipe])
  const [form, setForm] = useState<Form>(init.form)
  const [rows, setRows] = useState<Row[]>(init.rows.length ? init.rows : [emptyRow()])
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photo, setPhoto] = useState<string | null>(recipe?.photo || null)
  const [dirty, setDirty] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') })
  const { data: semis = [] } = useQuery({ queryKey: ['recipes', 'semis'], queryFn: () => api<RecipeListItem[]>('/recipes?kind=semi') })
  const semiByName = useMemo(() => new Map(semis.filter(x => x.id !== recipe?.id).map(x => [x.name.toLowerCase(), x])), [semis, recipe])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const set = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setDirty(true) }
  const setRow = (key: number, patch: Partial<Row>) => {
    setRows(rs => rs.map(r => {
      if (r.key !== key) return r
      const next = { ...r, ...patch }
      // Название совпало с полуфабрикатом — связываем; изменили — связь снимаем.
      if (patch.name !== undefined) {
        const semi = semiByName.get(patch.name.trim().toLowerCase())
        next.linked = semi ? semi.id : null
      }
      return next
    }))
    setDirty(true)
  }
  const move = (idx: number, dir: -1 | 1) => { setDirty(true); setRows(rs => {
    const j = idx + dir
    if (j < 0 || j >= rs.length) return rs
    const copy = [...rs];[copy[idx], copy[j]] = [copy[j], copy[idx]]
    return copy
  }) }

  const numFields: (keyof Form)[] = ['yield_weight', 'yield_count', 'calories', 'protein', 'fat', 'carbs']
  const invalid = !form.name.trim() || numFields.some(f => bad(form[f])) || rows.some(r => bad(r.brutto) || bad(r.netto) || bad(r.loss))

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(), kind: form.kind, category_id: form.category_id || null,
        yield_weight: parseNum(form.yield_weight), yield_unit: form.yield_weight.trim() ? form.yield_unit : null,
        yield_count: parseNum(form.yield_count),
        calories: parseNum(form.calories), protein: parseNum(form.protein), fat: parseNum(form.fat), carbs: parseNum(form.carbs),
        cooking: form.cooking, note: form.note,
        ingredients: rows.map(complete).filter(r => r.name.trim()).map(r => ({
          name: r.name.trim(), brutto: parseNum(r.brutto), netto: parseNum(r.netto), loss_percent: parseNum(r.loss),
          unit: r.unit || null, linked_recipe_id: r.linked,
        })),
      }
      const saved = recipe
        ? await api<Recipe>('/recipes/' + recipe.id, { method: 'PUT', body })
        : await api<Recipe>('/recipes', { method: 'POST', body })
      if (photoFile) {
        try { await upload('/recipes/' + saved.id + '/photo', 'photo', photoFile) }
        catch (e) { toast('Карта сохранена, но фото не загрузилось: ' + errText(e), 'error') }
      } else if (recipe?.photo && !photo) {
        await api('/recipes/' + saved.id + '/photo', { method: 'DELETE' })
      }
      return saved
    },
    onSuccess: saved => {
      setDirty(false)
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe', saved.id] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      toast(recipe ? 'Изменения сохранены' : 'Карта создана')
      navigate('/recipes/' + saved.id, { replace: true })
    },
    onError: e => toast(errText(e), 'error'),
  })

  const pickPhoto = (f: File | undefined) => {
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('Нужна картинка JPG, PNG или WebP', 'error'); return }
    if (f.size > 8 * 1024 * 1024) { toast('Файл больше 8 МБ', 'error'); return }
    setPhotoFile(f)
    setPhoto(URL.createObjectURL(f))
    setDirty(true)
  }

  const numInput = (key: keyof Form, placeholder = '') => (
    <input className={`input-num ${bad(form[key]) ? '!border-bad' : ''}`} inputMode="decimal" placeholder={placeholder}
      value={form[key]} onChange={e => set({ [key]: e.target.value } as Partial<Form>)} />
  )

  return (
    <form className="max-w-4xl mx-auto px-4 lg:px-8 pt-4 lg:pt-6 pb-28 lg:pb-12" onSubmit={e => { e.preventDefault(); if (!invalid) save.mutate() }}>
      <Link to={recipe ? `/recipes/${recipe.id}` : '/recipes'} className="btn-ghost btn-sm -ml-2 mb-3"><ArrowLeft className="h-4 w-4" />{recipe ? 'К карте' : 'Все ТТК'}</Link>
      <h1 className="h-page mb-5">{recipe ? 'Редактирование ТТК' : 'Новая ТТК'}</h1>

      {/* основное */}
      <section className="card p-4 sm:p-5 grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-4">
          <label>
            <span className="field-label">Название *</span>
            <input className="input text-base font-semibold" value={form.name} onChange={e => set({ name: e.target.value })} autoFocus={!recipe} maxLength={300} />
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <span className="field-label">Тип</span>
              <div className="inline-flex rounded-xl bg-paper-2 p-0.5 text-[13px] font-semibold w-full">
                {([['dish', 'Блюдо'], ['semi', 'Полуфабрикат']] as const).map(([v, l]) => (
                  <button type="button" key={v} onClick={() => set({ kind: v })}
                    className={`flex-1 h-9 rounded-[10px] transition-colors ${form.kind === v ? 'bg-paper-card shadow-card text-ink' : 'text-ink-muted'}`}>{l}</button>
                ))}
              </div>
            </div>
            <label>
              <span className="field-label">Категория</span>
              <select className="input" value={form.category_id} onChange={e => set({ category_id: e.target.value })}>
                <option value="">Без категории</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          {form.kind === 'semi' && <p className="text-[13px] text-warn -mt-1">Полуфабрикат можно указывать в составе других карт — строка с тем же названием свяжется с ним сама.</p>}
        </div>

        <div className="sm:w-40">
          <span className="field-label">Фото</span>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
          {photo ? (
            <div className="relative">
              <img src={photo} alt="" className="h-40 w-full sm:w-40 rounded-xl object-cover bg-paper-2" />
              <button type="button" onClick={() => { setPhoto(null); setPhotoFile(null); setDirty(true) }}
                className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-ink/70 text-paper flex items-center justify-center" aria-label="Убрать фото"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="h-40 w-full sm:w-40 rounded-xl border-2 border-dashed border-line-strong flex flex-col items-center justify-center gap-1 text-ink-muted hover:border-brand hover:text-brand transition-colors">
              <ImagePlus className="h-6 w-6" /><span className="text-xs font-semibold">Добавить</span>
            </button>
          )}
        </div>
      </section>

      {/* выход */}
      <section className="card p-4 sm:p-5 mt-4">
        <h2 className="font-bold mb-3">Выход</h2>
        <div className="grid grid-cols-2 sm:grid-cols-[180px_100px_180px] gap-3 items-end">
          <label><span className="field-label">По весу / объёму</span>{numInput('yield_weight', '—')}</label>
          <label><span className="field-label">Ед.</span>
            <select className="input" value={form.yield_unit} onChange={e => set({ yield_unit: e.target.value })}>
              {['кг', 'г', 'л', 'мл'].map(u => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label className="col-span-2 sm:col-span-1"><span className="field-label">Порций</span>{numInput('yield_count', '—')}</label>
        </div>
        <p className="text-xs muted mt-2">Нужен для калькулятора: «пересчитать на 40 порций» или «на 5 кг».</p>
      </section>

      {/* состав */}
      <section className="card mt-4 overflow-hidden">
        <div className="px-4 sm:px-5 pt-4 pb-2 flex items-baseline justify-between gap-2">
          <h2 className="font-bold">Состав</h2>
          <p className="text-xs muted">Заполните две из трёх величин — третья посчитается сама</p>
        </div>
        <datalist id="semis">{[...semiByName.values()].map(x => <option key={x.id} value={x.name} />)}</datalist>

        <div className="hidden sm:grid grid-cols-[1fr_88px_88px_76px_72px_84px] gap-2 px-5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          <span>Продукт</span><span className="text-right">Брутто</span><span className="text-right">Нетто</span><span className="text-right">Потери %</span><span>Ед.</span><span />
        </div>
        <ul className="divide-y divide-line sm:divide-y-0">
          {rows.map((r, idx) => (
            <li key={r.key} className="px-4 sm:px-5 py-3 sm:py-1.5 grid grid-cols-4 sm:grid-cols-[1fr_88px_88px_76px_72px_84px] gap-2 items-center">
              <div className="col-span-4 sm:col-span-1 relative">
                <input className="input pr-12" list="semis" placeholder={`Продукт ${idx + 1}`} value={r.name}
                  onChange={e => setRow(r.key, { name: e.target.value })} />
                {r.linked && <span className="tag bg-warn-soft text-warn absolute right-2 top-1/2 -translate-y-1/2" title="Связано с картой полуфабриката">п/ф</span>}
              </div>
              {(['brutto', 'netto', 'loss'] as const).map(f => (
                <label key={f}>
                  <span className="sm:hidden text-[11px] font-semibold text-ink-muted">{{ brutto: 'Брутто', netto: 'Нетто', loss: 'Потери %' }[f]}</span>
                  <input className={`input-num ${bad(r[f]) ? '!border-bad' : ''}`} inputMode="decimal" value={r[f]}
                    onChange={e => setRow(r.key, { [f]: e.target.value })}
                    onBlur={() => setRows(rs => rs.map(x => x.key === r.key ? complete(x) : x))} />
                </label>
              ))}
              <label>
                <span className="sm:hidden text-[11px] font-semibold text-ink-muted">Ед.</span>
                <select className="input px-2" value={r.unit} onChange={e => setRow(r.key, { unit: e.target.value })}>
                  <option value="">—</option>
                  {UNITS.map(u => <option key={u}>{u}</option>)}
                </select>
              </label>
              <div className="col-span-4 sm:col-span-1 flex justify-end gap-0.5 -mt-1 sm:mt-0">
                <button type="button" className="btn-ghost btn-sm w-7 px-0" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Выше"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" className="btn-ghost btn-sm w-7 px-0" onClick={() => move(idx, 1)} disabled={idx === rows.length - 1} aria-label="Ниже"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" className="btn-danger btn-sm w-7 px-0" onClick={() => { setRows(rs => rs.length > 1 ? rs.filter(x => x.key !== r.key) : [emptyRow()]); setDirty(true) }} aria-label="Удалить строку"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
        <div className="px-4 sm:px-5 py-3 border-t border-line">
          <button type="button" className="btn-ghost btn-sm" onClick={() => setRows(rs => [...rs, emptyRow(rs[rs.length - 1]?.unit || 'кг')])}><Plus className="h-4 w-4" />Строка</button>
        </div>
      </section>

      {/* технология */}
      <section className="card p-4 sm:p-5 mt-4 grid gap-4">
        <label>
          <span className="field-label">Технология приготовления</span>
          <textarea className="input min-h-[160px]" value={form.cooking} onChange={e => set({ cooking: e.target.value })} />
        </label>
        <label>
          <span className="field-label">Примечание (подача, хранение, аллергены)</span>
          <textarea className="input min-h-[80px]" value={form.note} onChange={e => set({ note: e.target.value })} />
        </label>
      </section>

      {/* КБЖУ */}
      <section className="card p-4 sm:p-5 mt-4">
        <h2 className="font-bold mb-3">КБЖУ на весь выход</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label><span className="field-label">Калории, ккал</span>{numInput('calories')}</label>
          <label><span className="field-label">Белки, г</span>{numInput('protein')}</label>
          <label><span className="field-label">Жиры, г</span>{numInput('fat')}</label>
          <label><span className="field-label">Углеводы, г</span>{numInput('carbs')}</label>
        </div>
      </section>

      <div className="fixed lg:static bottom-[64px] inset-x-0 z-20 lg:mt-6 px-4 lg:px-0 py-3 lg:py-0 bg-paper/95 lg:bg-transparent border-t border-line lg:border-0 flex justify-end gap-2">
        <Link to={recipe ? `/recipes/${recipe.id}` : '/recipes'} className="btn-ghost">Отмена</Link>
        <button className="btn-primary min-w-[140px]" disabled={invalid || save.isPending}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </form>
  )
}
