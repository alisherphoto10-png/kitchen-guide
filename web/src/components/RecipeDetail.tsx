import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, MoreHorizontal, FileText, FileSpreadsheet, Archive, ArchiveRestore, Trash2, Calculator, RotateCcw, Lock } from 'lucide-react'
import { api, download } from '../lib/api'
import { useSession } from '../lib/session'
import { fmt, yieldLabel } from '../lib/format'
import { INITIAL_CALC, coefficient, isActive, scaleValue, nettoSum, ingredientBase, type CalcMode, type CalcState } from '../lib/calc'
import type { Recipe } from '../lib/types'
import { MODULE_LOCKED_TEXT, useModule } from '../lib/modules'
import { ErrorBox, PageLoader, errText, toast, useConfirm } from './ui'

export function RecipeDetail({ id, onBack }: { id: number; onBack?: () => void }) {
  const { can } = useSession()
  const { data: recipe, isLoading, error } = useQuery({ queryKey: ['recipe', id], queryFn: () => api<Recipe>('/recipes/' + id) })
  // Пересчёт от прошлой карты на новую не переносится: родитель монтирует
  // компонент с key={id}, и состояние калькулятора создаётся заново.
  const [calc, setCalc] = useState<CalcState>(INITIAL_CALC)
  const recalcOn = useModule('recalc')

  if (isLoading) return <PageLoader />
  if (error || !recipe) return <div className="p-6"><BackLink onBack={onBack} /><ErrorBox error={error} /></div>

  // Модуль «Пересчёт» выключен — коэффициента нет, карта всегда в исходных количествах.
  const k = recalcOn ? coefficient(recipe, calc) : null
  const active = isActive(k)
  const sum = nettoSum(recipe)

  return (
    <article className="max-w-4xl mx-auto px-4 lg:px-8 pt-4 lg:pt-6 pb-10">
      <div className="flex items-center justify-between gap-2 mb-4">
        <BackLink onBack={onBack} />
        {can('owner') && <Actions recipe={recipe} k={active ? k : null} />}
      </div>

      <header className="flex gap-4 items-start mb-5">
        {recipe.photo && (
          <a href={recipe.photo} target="_blank" rel="noreferrer" className="flex-shrink-0">
            <img src={recipe.photo} alt="" className="h-24 w-24 sm:h-32 sm:w-32 rounded-2xl object-cover bg-paper-2" />
          </a>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className={`tag ${recipe.kind === 'semi' ? 'bg-warn-soft text-warn' : 'bg-paper-2 text-ink-2'}`}>{recipe.kind === 'semi' ? 'Полуфабрикат' : 'Блюдо'}</span>
            {recipe.category_name && <span className="tag bg-paper-2 text-ink-2">{recipe.category_name}</span>}
            {recipe.status === 'archived' && <span className="tag bg-ink text-paper">В архиве</span>}
          </div>
          <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight leading-tight">{recipe.name}</h1>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div>
              <dt className="inline muted">Выход: </dt>
              <dd className="inline font-semibold">
                {yieldLabel(active ? { ...recipe, yield_weight: scaleValue(recipe.yield_weight, k), yield_count: scaleValue(recipe.yield_count, k) } : recipe) || '—'}
              </dd>
              {recipe.yield_weight == null && sum && <span className="muted"> (сумма нетто ≈ {fmt(scaleValue(sum.v, k))} {sum.unit})</span>}
            </div>
          </dl>
        </div>
      </header>

      {recalcOn
        ? <CalcPanel recipe={recipe} state={calc} onChange={p => setCalc(s => ({ ...s, ...p }))} k={k} />
        : <CalcLocked />}

      <section className="mt-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-ink-muted mb-2">Состав</h2>
        <IngredientsTable recipe={recipe} k={k} />
      </section>

      {recipe.used_in.length > 0 && (
        <section className="mt-4 rounded-xl bg-warn-soft/60 px-4 py-3 text-sm">
          <span className="text-warn font-semibold">Входит в состав: </span>
          {recipe.used_in.map((u, i) => (
            <span key={u.id}>{i > 0 && ', '}<Link to={`/recipes/${u.id}`} className="underline underline-offset-2">{u.name}</Link></span>
          ))}
        </section>
      )}

      <Kbju recipe={recipe} k={k} />

      <section className="mt-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-ink-muted mb-2">Технология приготовления</h2>
        {recipe.cooking.trim()
          ? <div className="card p-4 sm:p-5 whitespace-pre-line leading-relaxed text-[15px]">{recipe.cooking.trim()}</div>
          : <p className="text-sm muted">Не заполнена.</p>}
      </section>

      {recipe.note.trim() && (
        <section className="mt-6">
          <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-ink-muted mb-2">Примечание</h2>
          <div className="card p-4 whitespace-pre-line text-sm text-ink-2">{recipe.note.trim()}</div>
        </section>
      )}
    </article>
  )
}

function BackLink({ onBack }: { onBack?: () => void }) {
  if (!onBack) return <span />
  return <button onClick={onBack} className="btn-ghost btn-sm -ml-2"><ArrowLeft className="h-4 w-4" />Все ТТК</button>
}

// ── калькулятор ──────────────────────────────────────────────────────

function CalcPanel({ recipe, state, onChange, k }: { recipe: Recipe; state: CalcState; onChange: (p: Partial<CalcState>) => void; k: number | null }) {
  const active = isActive(k)
  const modes: { id: CalcMode; label: string; disabled?: string }[] = [
    { id: 'multiplier', label: '× Множитель' },
    { id: 'portions', label: 'Порции', disabled: recipe.yield_count == null ? 'В карте не указан выход в порциях' : undefined },
    { id: 'weight', label: 'Выход', disabled: recipe.yield_weight == null ? 'В карте не указан выход по весу' : undefined },
    { id: 'ingredient', label: 'От продукта', disabled: !recipe.ingredients.some(i => ingredientBase(i)) ? 'В составе нет количеств' : undefined },
  ]
  const countable = recipe.ingredients.map((i, idx) => ({ i, idx })).filter(({ i }) => ingredientBase(i))
  const selIdx = state.ingredientIdx >= 0 ? state.ingredientIdx : countable[0]?.idx ?? -1

  useEffect(() => {
    if (state.mode === 'ingredient' && state.ingredientIdx < 0 && selIdx >= 0) onChange({ ingredientIdx: selIdx })
  }, [state.mode]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className={`rounded-2xl border p-3 sm:p-4 transition-colors ${active ? 'border-brand/40 bg-brand-soft/50' : 'border-line bg-paper-2/50'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="h-4 w-4 text-brand" />
        <h2 className="text-sm font-bold flex-1">Пересчёт</h2>
        {active && (
          <button className="btn-ghost btn-sm" onClick={() => onChange(INITIAL_CALC)}><RotateCcw className="h-3.5 w-3.5" />Сбросить</button>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mb-3">
        {modes.map(m => (
          <button key={m.id} disabled={!!m.disabled} title={m.disabled}
            onClick={() => onChange({ mode: m.id })}
            className={`chip ${state.mode === m.id ? 'chip-active' : ''} disabled:opacity-40`}>{m.label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {state.mode === 'multiplier' && (
          <NumField label="Во сколько раз" value={state.multiplier} onChange={v => onChange({ multiplier: v })} placeholder="напр. 2,5" />
        )}
        {state.mode === 'portions' && (
          <NumField label={`Нужно порций (в карте ${fmt(recipe.yield_count)})`} value={state.portions} onChange={v => onChange({ portions: v })} placeholder="напр. 40" />
        )}
        {state.mode === 'weight' && (
          <>
            <NumField label={`Нужный выход (в карте ${fmt(recipe.yield_weight)} ${recipe.yield_unit || 'кг'})`} value={state.weight} onChange={v => onChange({ weight: v })} placeholder="напр. 5" />
            <select className="input w-24" value={state.weightUnit} onChange={e => onChange({ weightUnit: e.target.value })}>
              {(['л', 'мл'].includes(recipe.yield_unit || '') ? ['л', 'мл'] : ['кг', 'г']).map(u => <option key={u}>{u}</option>)}
            </select>
          </>
        )}
        {state.mode === 'ingredient' && (
          <>
            <label className="flex-1 min-w-[180px]">
              <span className="field-label">Продукт</span>
              <select className="input" value={selIdx} onChange={e => onChange({ ingredientIdx: Number(e.target.value) })}>
                {countable.map(({ i, idx }) => <option key={idx} value={idx}>{i.name} — {fmt(ingredientBase(i))} {i.unit || ''}</option>)}
              </select>
            </label>
            <NumField label={`Есть в наличии${recipe.ingredients[selIdx]?.unit ? ', ' + recipe.ingredients[selIdx].unit : ''}`}
              value={state.have} onChange={v => onChange({ have: v })} placeholder="сколько есть" />
          </>
        )}
      </div>
      {active && <p className="mt-3 text-[13px] text-brand-ink font-semibold">Состав и выход пересчитаны ×{fmt(k)} — выгрузка тоже пойдёт с пересчётом.</p>}
      {state.mode === 'ingredient' && !active && <p className="mt-2 text-xs muted">Считается по брутто: сколько продукта у вас есть — на столько и пересчитаем всю карту.</p>}
    </section>
  )
}

// Модуль «Пересчёт» не подключён: те же режимы на виду, но недоступны — с объяснением.
function CalcLocked() {
  return (
    <section className="rounded-2xl border border-dashed border-line-strong bg-paper-2/40 p-3 sm:p-4" aria-disabled="true">
      <div className="flex items-center gap-2 mb-3">
        <Calculator className="h-4 w-4 text-ink-faint" />
        <h2 className="text-sm font-bold flex-1 text-ink-muted">Пересчёт</h2>
        <span className="tag bg-paper-2 text-ink-muted gap-1"><Lock className="h-3 w-3" />расширенный тариф</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-3 opacity-50 pointer-events-none select-none" aria-hidden>
        {['× Множитель', 'Порции', 'Выход', 'От продукта'].map(l => <span key={l} className="chip">{l}</span>)}
      </div>
      <p className="flex items-start gap-2 text-[13px] text-ink-2">
        <Lock className="h-4 w-4 flex-shrink-0 mt-0.5 text-ink-muted" />
        <span>Пересчёт на нужное количество порций, выход или от остатка продукта. {MODULE_LOCKED_TEXT}.</span>
      </p>
    </section>
  )
}

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="w-full sm:w-auto sm:min-w-[200px]">
      <span className="field-label">{label}</span>
      <input className="input-num" inputMode="decimal" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

// ── состав ───────────────────────────────────────────────────────────

function IngredientsTable({ recipe, k }: { recipe: Recipe; k: number | null }) {
  if (!recipe.ingredients.length) return <p className="text-sm muted">Состав не заполнен.</p>
  const active = isActive(k)
  const cell = (v: number | null, unit: string | null) => v == null ? <span className="text-ink-faint">—</span> : (
    <>
      <span className={active ? 'text-brand-ink font-semibold' : ''}>{fmt(scaleValue(v, k))}</span>
      {unit && <span className="text-ink-muted text-[12px]"> {unit}</span>}
      {active && <span className="block text-[11px] text-ink-faint font-normal">было {fmt(v)}</span>}
    </>
  )
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-ink-muted bg-paper-2/60">
            <th className="font-semibold px-3 sm:px-4 py-2">Продукт</th>
            <th className="font-semibold px-2 py-2 text-right w-[92px]">Брутто</th>
            <th className="font-semibold px-2 py-2 text-right w-[92px]">Нетто</th>
            <th className="font-semibold px-3 py-2 text-right w-[72px] hidden sm:table-cell">Потери</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {recipe.ingredients.map((i, n) => (
            <tr key={i.id ?? n} className="align-top">
              <td className="px-3 sm:px-4 py-2.5">
                {i.linked_recipe_id ? (
                  <Link to={`/recipes/${i.linked_recipe_id}`} className="font-medium underline decoration-warn/50 underline-offset-2 hover:decoration-warn">
                    {i.name}
                  </Link>
                ) : <span className="font-medium">{i.name}</span>}
                {i.linked_recipe_id && <span className="tag bg-warn-soft text-warn ml-1.5 align-middle">п/ф</span>}
                {!!i.loss_percent && <span className="sm:hidden block text-[12px] muted">потери {fmt(i.loss_percent, 2)}%</span>}
              </td>
              <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{cell(i.brutto, i.unit)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums whitespace-nowrap">{cell(i.netto, i.unit)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums hidden sm:table-cell text-ink-2">{i.loss_percent != null ? fmt(i.loss_percent, 2) + '%' : <span className="text-ink-faint">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Kbju({ recipe, k }: { recipe: Recipe; k: number | null }) {
  const items = ([
    ['Калории', recipe.calories, 'ккал'], ['Белки', recipe.protein, 'г'], ['Жиры', recipe.fat, 'г'], ['Углеводы', recipe.carbs, 'г'],
  ] as const).filter(([, v]) => v != null)
  if (!items.length) return null
  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold uppercase tracking-[0.06em] text-ink-muted mb-2">КБЖУ на выход</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {items.map(([l, v, u]) => (
          <div key={l} className="card px-3 py-2.5">
            <p className="text-[12px] muted">{l}</p>
            <p className="text-lg font-extrabold tabular-nums">{fmt(scaleValue(v, k), 1)} <span className="text-xs font-semibold text-ink-muted">{u}</span></p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── действия ─────────────────────────────────────────────────────────

function Actions({ recipe, k }: { recipe: Recipe; k: number | null }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [confirm, confirmNode] = useConfirm()
  const suffix = k ? `?k=${k}` : ''

  const exportFile = async (ext: 'pdf' | 'xlsx') => {
    setOpen(false)
    setBusy(true)
    try { await download(`/recipes/${recipe.id}/export.${ext}${suffix}`, `ttk.${ext}`) }
    catch (e) { toast(errText(e), 'error') }
    finally { setBusy(false) }
  }

  const statusMut = useMutation({
    mutationFn: (to: 'archive' | 'restore') => api(`/recipes/${recipe.id}/${to}`, { method: 'POST' }),
    onSuccess: (_, to) => {
      toast(to === 'archive' ? 'Карта перенесена в архив' : 'Карта снова действует')
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['recipe', recipe.id] })
    },
    onError: e => toast(errText(e), 'error'),
  })
  const deleteMut = useMutation({
    mutationFn: () => api(`/recipes/${recipe.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Карта удалена')
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.removeQueries({ queryKey: ['recipe', recipe.id] })
      navigate('/recipes')
    },
    onError: e => toast(errText(e), 'error'),
  })

  const item = 'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm text-left hover:bg-paper'
  return (
    <div className="flex items-center gap-1.5">
      <Link to={`/recipes/${recipe.id}/edit`} className="btn-outline btn-sm"><Pencil className="h-3.5 w-3.5" />Изменить</Link>
      <div className="relative">
        <button className="btn-outline btn-sm w-8 px-0" onClick={() => setOpen(v => !v)} disabled={busy} aria-label="Ещё"><MoreHorizontal className="h-4 w-4" /></button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-10 z-50 w-60 card shadow-pop py-1 overflow-hidden">
              <button className={item} onClick={() => exportFile('pdf')}><FileText className="h-4 w-4 text-ink-muted" />Скачать PDF{k ? ` ×${fmt(k)}` : ''}</button>
              <button className={item} onClick={() => exportFile('xlsx')}><FileSpreadsheet className="h-4 w-4 text-ink-muted" />Скачать Excel{k ? ` ×${fmt(k)}` : ''}</button>
              <div className="border-t border-line my-1" />
              {recipe.status === 'active'
                ? <button className={item} onClick={() => { setOpen(false); statusMut.mutate('archive') }}><Archive className="h-4 w-4 text-ink-muted" />В архив</button>
                : <button className={item} onClick={() => { setOpen(false); statusMut.mutate('restore') }}><ArchiveRestore className="h-4 w-4 text-ink-muted" />Вернуть из архива</button>}
              <button className={`${item} text-bad hover:bg-bad-soft`} onClick={async () => {
                setOpen(false)
                const ok = await confirm({
                  title: 'Удалить карту навсегда?', danger: true, ok: 'Удалить',
                  text: recipe.used_in.length
                    ? <>Этот полуфабрикат входит в {recipe.used_in.length} карт(ы) — там он останется строкой без ссылки. Если карта просто больше не нужна, лучше отправить её в архив.</>
                    : 'Вернуть её будет нельзя. Если карта просто больше не нужна, лучше отправить её в архив.',
                })
                if (ok) deleteMut.mutate()
              }}><Trash2 className="h-4 w-4" />Удалить</button>
            </div>
          </>
        )}
      </div>
      {confirmNode}
    </div>
  )
}

