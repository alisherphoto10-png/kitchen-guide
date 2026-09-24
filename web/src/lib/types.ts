export type Role = 'owner' | 'editor' | 'viewer'

export interface User {
  id: number
  login: string
  name: string
  role: Role
  tenant_id: number | null
  is_platform_admin: boolean
  is_active: boolean
  last_login_at: string | null
  tg_linked?: boolean
  tg_username?: string | null
}

export interface Tenant {
  id: number
  name: string
  slug: string
  bot?: { username: string; is_active: boolean } | null
}

export interface Me {
  user: User
  role: Role
  tenant: Tenant | null
}

export interface Category {
  id: number
  name: string
  sort_order: number
  recipe_count: number
}

export type RecipeKind = 'dish' | 'semi'
export type YieldUnit = 'кг' | 'г' | 'л' | 'мл'

export interface RecipeListItem {
  id: number
  name: string
  kind: RecipeKind
  category_id: number | null
  category_name: string | null
  photo: string | null
  status: 'active' | 'archived'
  yield_weight: number | null
  yield_unit: YieldUnit | null
  yield_count: number | null
  ingredient_count: number
  updated_at: string
}

export interface Ingredient {
  id?: number
  name: string
  brutto: number | null
  netto: number | null
  loss_percent: number | null
  unit: string | null
  linked_recipe_id: number | null
  linked_recipe_name?: string | null
}

export interface Recipe extends RecipeListItem {
  cooking: string
  note: string
  calories: number | null
  protein: number | null
  fat: number | null
  carbs: number | null
  created_at: string
  ingredients: Ingredient[]
  used_in: { id: number; name: string }[]
}

export interface PlatformTenant extends Tenant {
  is_active: boolean
  created_at: string
  recipe_count: number
  user_count: number
  last_activity_at: string | null
  bot_username: string | null
  bot_active: boolean | null
  bot_error: string | null
}

export interface BotStatus {
  id: number
  tenant_id: number
  username: string
  token_last4: string
  is_active: boolean
  last_error: string | null
  last_update_at: string | null
  created_at: string
  updated_at: string
  bot_link: string
  mini_app_link: string | null
  telegram?: {
    webhook_ok?: boolean
    pending_update_count?: number
    last_error_message?: string | null
    last_error_date?: string | null
    error?: string
  }
}
