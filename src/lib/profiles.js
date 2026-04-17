import { supabase } from './supabase'
import { getDisplayName } from './vendor'

function normalizeRole(value) {
  if (value === 'admin') return 'admin'
  return value === 'vendor' ? 'vendor' : 'customer'
}

export function buildProfilePayload(user, role = 'customer') {
  if (!user?.id) return null

  return {
    id: user.id,
    display_name: getDisplayName(user.user_metadata?.full_name || user.email, 'Pengguna'),
    avatar_url: user.user_metadata?.avatar_url || null,
    role: normalizeRole(role),
  }
}

export async function syncCurrentProfile(user, role = 'customer') {
  const payload = buildProfilePayload(user, role)
  if (!payload) return null

  try {
    const { data, error } = await supabase
      .from('profiles')
      .upsert(payload)
      .select()
      .maybeSingle()

    if (error) throw error
    return data || payload
  } catch (error) {
    console.warn('syncCurrentProfile', error)
    return null
  }
}

export async function loadIdentityMap(ids = []) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return {}

  const identityMap = {}

  try {
    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, photo_url')
      .in('id', uniqueIds)

    if (error) throw error

    for (const vendor of data || []) {
      identityMap[vendor.id] = {
        id: vendor.id,
        name: getDisplayName(vendor.name, 'Pedagang'),
        photo_url: vendor.photo_url || null,
        role: 'vendor',
      }
    }
  } catch (error) {
    console.warn('loadIdentityMap.vendors', error)
  }

  const missingIds = uniqueIds.filter((id) => !identityMap[id])
  if (missingIds.length === 0) return identityMap

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, role')
      .in('id', missingIds)

    if (error) throw error

    for (const profile of data || []) {
      identityMap[profile.id] = {
        id: profile.id,
        name: getDisplayName(profile.display_name, 'Pengguna'),
        photo_url: profile.avatar_url || null,
        role: normalizeRole(profile.role),
      }
    }
  } catch (error) {
    console.warn('loadIdentityMap.profiles', error)
  }

  return identityMap
}
