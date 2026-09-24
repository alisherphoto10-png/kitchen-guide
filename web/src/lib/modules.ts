// Платные модули заведения (реестр — server/src/modules.js). Модуль выключен —
// функция остаётся на экране, но заблокирована с понятным объяснением.
import { useSession } from './session'

export const MODULE_LOCKED_TEXT = 'Доступно в расширенном тарифе — обратитесь к администратору'

export function useModule(key: string): boolean {
  const { me } = useSession()
  return !!me?.tenant?.modules?.[key]
}
