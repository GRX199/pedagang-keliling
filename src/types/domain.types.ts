import type { Tables } from './database.types'

export type Role = 'customer' | 'vendor' | 'admin'
export type AccountStatus = 'active' | 'suspended' | 'blocked'
export type Mobility = 'walking' | 'pushcart' | 'bicycle' | 'motor_vehicle'
export type PickupStatus =
  'pending' | 'accepted' | 'ready' | 'completed' | 'rejected' | 'cancelled'
export type PaymentMethod = 'cod' | 'qris' | 'bank_transfer' | 'ewallet'
export type PaymentStatus =
  'unpaid' | 'pending_confirmation' | 'paid' | 'failed' | 'refunded'
export type PickupMethod = 'self_pickup' | 'customer_courier'
export type OrderProgressAction = {
  value: string
  label: string
  tone: 'primary' | 'success' | 'danger'
  disabled?: boolean
  disabledReason?: string
}
export type Coordinates = { lat: number; lng: number; accuracy?: number }
export type Order = Tables<'orders'>
export type Vendor = Tables<'vendors'>
export type Product = Tables<'products'>
export type Message = Tables<'messages'>
export type Review = Tables<'reviews'>
export type VendorMapItem = Vendor & {
  map_category: string | null
  map_search_text: string
  account_status: string
  review_average: number
  review_count: number
}
export type MapFilters = {
  query: string
  category: string
  mobility: Mobility | 'all'
  radius: number
  rating: 'all' | '4' | '4.5'
  withinRadius: boolean
  promo: boolean
  favorites: boolean
}
