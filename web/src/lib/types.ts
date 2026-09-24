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
}

export interface Tenant {
  id: number
  name: string
  slug: string
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
}
