// Калькулятор пересчёта ТТК. Всё сводится к одному коэффициенту k, на который
// умножаются брутто/нетто и выход (сервер делает то же самое в выгрузке по ?k=).
// Режимы — из KitchenDesk («множитель», «от количества ингредиента») плюс
// пересчёт на нужный выход: по порциям или по весу.
import type { Recipe } from './types'

export type CalcMode = 'multiplier' | 'portions' | 'weight' | 'ingredient'

export interface CalcState {
  mode: CalcMode
  multiplier: string
  portions: string
  weight: string
  weightUnit: string
  ingredientIdx: number
  have: string
}

export const INITIAL_CALC: CalcState = {
  mode: 'multiplier', multiplier: '', portions: '', weight: '', weightUnit: 'кг', ingredientIdx: -1, have: '',
}

const num = (s: string) => {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

// Вес/объём в базовой единице: кг для массы, л для объёма.
export function toBase(value: number, unit: string | null): { v: number; dim: 'mass' | 'volume' } | null {
  switch (unit || 'кг') {
    case 'кг': return { v: value, dim: 'mass' }
    case 'г': return { v: value / 1000, dim: 'mass' }
    case 'л': return { v: value, dim: 'volume' }
    case 'мл': return { v: value / 1000, dim: 'volume' }
    default: return null
  }
}

export function ingredientBase(i: Recipe['ingredients'][number]): number | null {
  return i.brutto ?? i.netto ?? null
}

// null — коэффициент ещё не определён (поле пустое / не хватает данных в ТТК).
export function coefficient(recipe: Recipe, s: CalcState): number | null {
  switch (s.mode) {
    case 'multiplier':
      return num(s.multiplier)
    case 'portions': {
      const target = num(s.portions)
      return target && recipe.yield_count ? target / recipe.yield_count : null
    }
    case 'weight': {
      const target = num(s.weight)
      if (!target || recipe.yield_weight == null) return null
      const a = toBase(target, s.weightUnit)
      const b = toBase(recipe.yield_weight, recipe.yield_unit)
      return a && b && a.dim === b.dim && b.v > 0 ? a.v / b.v : null
    }
    case 'ingredient': {
      const ing = recipe.ingredients[s.ingredientIdx]
      const have = num(s.have)
      const base = ing ? ingredientBase(ing) : null
      return have && base ? have / base : null
    }
  }
}

export function isActive(k: number | null): k is number {
  return k !== null && k > 0 && Math.abs(k - 1) > 1e-9
}

export function scaleValue(v: number | null, k: number | null): number | null {
  return v == null ? null : isActive(k) ? v * k : v
}

// Сумма нетто в кг/л — ориентир выхода, когда он не заполнен вручную.
export function nettoSum(recipe: Pick<Recipe, 'ingredients'>): { v: number; unit: 'кг' | 'л' } | null {
  let mass = 0, volume = 0, used = 0
  for (const i of recipe.ingredients) {
    const b = i.netto != null ? toBase(i.netto, i.unit) : null
    if (!b) continue
    used++
    if (b.dim === 'mass') mass += b.v; else volume += b.v
  }
  if (!used) return null
  // Смешанные кг и л складываем как 1 л ≈ 1 кг — для ориентира этого достаточно.
  return mass >= volume ? { v: mass + volume, unit: 'кг' } : { v: mass + volume, unit: 'л' }
}
