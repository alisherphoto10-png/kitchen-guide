// Ссылка на гид для владельцев («Как это работает» и «Частые вопросы»).
// Одна настройка платформы на сервере; пустая строка — гид скрыт везде.
import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export function useGuideUrl(): string {
  const { data } = useQuery({ queryKey: ['guide'], queryFn: () => api<{ url: string }>('/guide'), staleTime: 5 * 60_000 })
  return data?.url || ''
}

export const GUIDE_LABEL = 'Гид и частые вопросы'

