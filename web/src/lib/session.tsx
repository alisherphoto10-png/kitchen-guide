import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, session, setUnauthorizedHandler } from './api'
import type { Me, Role, User } from './types'

interface SessionValue {
  me: Me | null
  loading: boolean
  login: (login: string, password: string) => Promise<void>
  // Вход из мини-аппа Telegram: initData + slug заведения из ссылки.
  loginTelegram: (initData: string, tenant: string) => Promise<void>
  logout: () => void
  // Администратор платформы: «войти» в заведение / выйти обратно в список.
  enterTenant: (id: number | null) => void
  can: (min: Role) => boolean
}

const Ctx = createContext<SessionValue | null>(null)
const RANK: Record<Role, number> = { viewer: 1, owner: 2 }

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [hasToken, setHasToken] = useState(() => !!session.token())

  const { data: me = null, isLoading } = useQuery({
    queryKey: ['me', hasToken],
    queryFn: () => api<Me>('/auth/me'),
    enabled: hasToken,
    staleTime: 60_000,
    retry: false,
  })

  const reset = useCallback(() => {
    session.setToken(null)
    session.setTenantOverride(null)
    setHasToken(false)
    qc.clear()
  }, [qc])

  useEffect(() => { setUnauthorizedHandler(reset) }, [reset])

  const value = useMemo<SessionValue>(() => ({
    me,
    loading: hasToken && isLoading,
    login: async (login, password) => {
      const res = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { login, password } })
      session.setToken(res.token)
      session.setTenantOverride(null)
      qc.clear()
      setHasToken(true)
    },
    loginTelegram: async (initData, tenant) => {
      const res = await api<{ token: string; user: User }>('/auth/telegram', { method: 'POST', body: { initData, tenant } })
      session.setToken(res.token)
      session.setTenantOverride(null)
      // Уже был вход (другой аккаунт в этом браузере) — сбросить кэш и перезапросить /me.
      if (hasToken) await qc.resetQueries()
      else { qc.clear(); setHasToken(true) }
    },
    logout: reset,
    enterTenant: id => {
      session.setTenantOverride(id)
      // Сбросить кэш целиком (данные другого заведения) и перезапросить активные — в т.ч. /me.
      qc.resetQueries()
    },
    can: min => !!me && RANK[me.role] >= RANK[min],
  }), [me, hasToken, isLoading, qc, reset])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession вне SessionProvider')
  return v
}
