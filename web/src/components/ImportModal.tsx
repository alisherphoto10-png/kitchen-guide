// Импорт каталога ТТК из выгрузки iiko (.xlsx/.xls/.csv). Разбор файла — на
// клиенте (эвристика перенесена из KitchenDesk TtkImportModal: название блюда
// строкой без номера, таблица состава после шапки «Наименование продукта»,
// выход — строкой после «Вес готового блюда»), на сервер уходят готовые ТТК.
import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp, Check } from 'lucide-react'
import { api } from '../lib/api'
import { fmt, plural } from '../lib/format'
import type { Category } from '../lib/types'
import { Modal, errText, toast } from './ui'

interface ParsedIngredient { name: string; unit: string; brutto: number | null; netto: number | null }
interface ParsedRecipe { key: number; name: string; ingredients: ParsedIngredient[]; yield_weight: number | null; yield_unit: 'кг' | 'г' | null }

const c = (v: unknown) => String(v ?? '').trim()
const num = (v: unknown) => { const n = parseFloat(c(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null }

async function readSheet(file: File): Promise<unknown[][]> {
  const XLSX = await import('xlsx')
  let wb
  if (/\.csv$/i.test(file.name)) {
    const text = await file.text()
    const delim = (text.match(/;/g) || []).length >= (text.match(/,/g) || []).length ? ';' : ','
    wb = XLSX.read(text, { type: 'string', FS: delim })
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  }
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
}

export function parseIikoSheet(rows: unknown[][]): ParsedRecipe[] {
  const isSeq = (v: unknown) => /^\d+$/.test(c(v))
  const isService = (first: string) => !first || isSeq(first) ||
    /^(технологическая\s+карта|название\s+на\s+чеке|область\s+применения|хранение|срок|органолептические|требования|вес\s+готового|итого|№|наименование\s+продукта|ед\.?\s*изм|нетто|брутто)/i.test(first) ||
    /^\d{2}[.-]\d{2}[.-]\d{4}/.test(first)

  let nameCol = 1, unitCol = -1, bruttoCol = -1, nettoCol = -1
  const out: ParsedRecipe[] = []
  let cur: ParsedRecipe | null = null
  let inTable = false, nextIsYield = false

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    const empty = row.every(v => c(v) === '')
    const first = empty ? '' : (c(row[0]) || c(row[1]))

    if (nextIsYield && !empty) {
      nextIsYield = false
      const n = row.map(num).find(x => x !== null && x > 0)
      // iiko пишет выход то в кг (0,35), то в граммах (350).
      if (cur && n != null) { cur.yield_weight = n; cur.yield_unit = n < 10 ? 'кг' : 'г' }
      continue
    }
    if (empty) continue

    if (row.some(v => /наименование\s+продукта/i.test(c(v)))) {
      bruttoCol = nettoCol = unitCol = -1
      row.forEach((v, j) => {
        const lc = c(v).toLowerCase()
        if (/наименование\s+продукта/.test(lc)) nameCol = j
        if (/^ед\.?\s*изм\.?$/.test(lc)) unitCol = j
        // Предпочитаем колонки «в ед. изм.» — так количество совпадает с единицей.
        if (/брутто/.test(lc) && (bruttoCol < 0 || /ед/.test(lc))) bruttoCol = j
        if (/нетто/.test(lc) && (nettoCol < 0 || /ед/.test(lc))) nettoCol = j
      })
      inTable = true
      continue
    }
    if (/вес.{0,20}готового.{0,20}блюда/i.test(first)) { nextIsYield = true; inTable = false; continue }
    if (/^итого/i.test(first)) { inTable = false; continue }

    if (inTable && isSeq(row[0])) {
      const name = c(row[nameCol])
      if (cur && name) {
        cur.ingredients.push({
          name, unit: unitCol >= 0 ? c(row[unitCol]) : '',
          brutto: bruttoCol >= 0 ? num(row[bruttoCol]) : null,
          netto: nettoCol >= 0 ? num(row[nettoCol]) : null,
        })
      }
      continue
    }
    if (isService(first)) continue

    if (cur) out.push(cur)
    cur = { key: i, name: first, ingredients: [], yield_weight: null, yield_unit: null }
    inTable = false
    nextIsYield = false
  }
  if (cur) out.push(cur)
  return out
}

export function ImportModal({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [items, setItems] = useState<ParsedRecipe[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [categoryId, setCategoryId] = useState('')
  const [parsing, setParsing] = useState(false)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setFileName(f.name)
    setParsing(true)
    try {
      const parsed = parseIikoSheet(await readSheet(f))
      if (!parsed.length) { toast('В файле не нашлось ТТК — нужен формат выгрузки технологических карт из iiko', 'error'); return }
      setItems(parsed)
      setSelected(new Set(parsed.map(p => p.key)))
    } catch (e) {
      toast('Не удалось прочитать файл: ' + errText(e), 'error')
    } finally {
      setParsing(false)
    }
  }

  const chosen = (items || []).filter(it => selected.has(it.key))
  const run = useMutation({
    mutationFn: () => api<{ created: number }>('/recipes/import', {
      method: 'POST',
      body: {
        category_id: categoryId || null,
        items: chosen.map(it => ({
          name: it.name, yield_weight: it.yield_weight, yield_unit: it.yield_unit,
          ingredients: it.ingredients.map(g => ({ name: g.name, unit: g.unit || null, brutto: g.brutto, netto: g.netto })),
        })),
      },
    }),
    onSuccess: r => {
      toast(`Импортировано: ${r.created} ${plural(r.created, 'карта', 'карты', 'карт')}`)
      qc.invalidateQueries({ queryKey: ['recipes'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      onClose()
    },
    onError: e => toast(errText(e), 'error'),
  })

  const toggle = (key: number) => setSelected(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n })

  return (
    <Modal title="Импорт ТТК из iiko" onClose={onClose} wide
      footer={items ? <>
        <button className="btn-ghost" onClick={() => { setItems(null); setFileName('') }}>Другой файл</button>
        <button className="btn-primary" disabled={!chosen.length || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? 'Импортируем…' : `Импортировать ${chosen.length}`}
        </button>
      </> : <button className="btn-ghost" onClick={onClose}>Отмена</button>}>
      {!items ? (
        <div>
          <p className="text-sm text-ink-2 mb-4">Загрузите выгрузку технологических карт из iiko (.xlsx, .xls или .csv). Название, состав брутто/нетто и выход распознаются автоматически — перед сохранением вы увидите, что получилось.</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={parsing}
            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]) }}
            className="w-full rounded-2xl border-2 border-dashed border-line-strong py-12 flex flex-col items-center gap-2 text-ink-muted hover:border-brand hover:text-brand transition-colors">
            <FileUp className="h-7 w-7" />
            <span className="text-sm font-semibold">{parsing ? 'Читаем файл…' : fileName || 'Выбрать файл или перетащить сюда'}</span>
          </button>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <p className="text-sm flex-1 min-w-[200px]">
              <b>{fileName}</b>: найдено {items.length} {plural(items.length, 'карта', 'карты', 'карт')}
              <button className="ml-2 text-brand font-semibold text-[13px]" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map(i => i.key)))}>
                {selected.size === items.length ? 'снять все' : 'выбрать все'}
              </button>
            </p>
            <label className="w-56">
              <span className="field-label">Категория для всех</span>
              <select className="input h-9" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">Без категории</option>
                {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
            </label>
          </div>
          <ul className="grid gap-1.5">
            {items.map(it => {
              const noQty = it.ingredients.filter(g => g.brutto == null && g.netto == null).length
              const on = selected.has(it.key)
              return (
                <li key={it.key}>
                  <button onClick={() => toggle(it.key)}
                    className={`w-full text-left flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${on ? 'border-brand/50 bg-brand-soft/40' : 'border-line'}`}>
                    <span className={`mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center flex-shrink-0 ${on ? 'bg-brand border-brand text-white' : 'border-line-strong'}`}>
                      {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold block truncate">{it.name}</span>
                      <span className="text-xs muted block truncate">
                        {it.ingredients.length} {plural(it.ingredients.length, 'продукт', 'продукта', 'продуктов')}
                        {it.yield_weight != null && ` · выход ${fmt(it.yield_weight)} ${it.yield_unit}`}
                        {' · '}{it.ingredients.slice(0, 4).map(g => g.name).join(', ')}{it.ingredients.length > 4 ? '…' : ''}
                      </span>
                    </span>
                    {noQty > 0 && <span className="tag bg-warn-soft text-warn flex-shrink-0">{noQty} без кол-ва</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="text-xs muted mt-3">Полуфабрикаты из файла импортируются как обычные блюда. Отметьте такую карту типом «Полуфабрикат» — строки с тем же названием в других картах свяжутся с ней автоматически.</p>
        </div>
      )}
    </Modal>
  )
}
