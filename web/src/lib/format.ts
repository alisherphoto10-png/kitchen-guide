// Числа в ТТК — по-русски: запятая, до 3 знаков, без хвостовых нулей.
export function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return ''
  const p = 10 ** digits
  return String(Math.round(n * p) / p).replace('.', ',')
}

// "0,140" / "0.14" / " 1 200 " → число; пусто → null; мусор → NaN.
export function parseNum(s: string | number | null | undefined): number | null {
  if (s == null) return null
  if (typeof s === 'number') return s
  const t = s.replace(/\s/g, '').replace(',', '.')
  if (t === '') return null
  return /^-?\d*\.?\d+$/.test(t) ? parseFloat(t) : NaN
}

export function yieldLabel(r: { yield_weight: number | null; yield_unit: string | null; yield_count: number | null }): string {
  const parts: string[] = []
  if (r.yield_weight != null) parts.push(`${fmt(r.yield_weight)} ${r.yield_unit || 'кг'}`)
  if (r.yield_count != null) parts.push(`${fmt(r.yield_count)} порц.`)
  return parts.join(' · ')
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function relDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days <= 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`
  return d.toLocaleDateString('ru-RU')
}
