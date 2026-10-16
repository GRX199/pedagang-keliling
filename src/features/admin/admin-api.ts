import { supabase } from '../../shared/lib/supabase'
import type { AccountStatus } from '../../types/domain.types'

export type AdminVendorAction =
  | { kind: 'verification'; id: string; expected: boolean; value: boolean }
  | { kind: 'account'; id: string; expected: string; value: AccountStatus }

export async function updateAdminVendor(
  actor: string,
  action: AdminVendorAction,
) {
  if (!actor || !action.id) throw new Error('Sesi admin tidak tersedia.')
  const result =
    action.kind === 'verification'
      ? await supabase
          .from('vendors')
          .update({ is_verified: action.value })
          .eq('id', action.id)
          .eq('is_verified', action.expected)
          .select('id')
          .single()
      : await supabase
          .from('profiles')
          .update({ account_status: action.value })
          .eq('id', action.id)
          .eq('account_status', action.expected)
          .select('id')
          .single()
  if (result.error?.code === 'PGRST116')
    throw new Error('Data pedagang sudah berubah. Muat ulang lalu coba lagi.')
  if (result.error) throw result.error
  const actionType =
    action.kind === 'account'
      ? `account_${action.value}`
      : action.value
        ? 'verify_vendor'
        : 'remove_vendor_verification'
  // The existing schema uses a separate audit table, not an atomic moderation RPC.
  try {
    const audit = await supabase.from('admin_actions').insert({
      admin_id: actor,
      target_user_id: action.id,
      entity_type: 'vendor',
      entity_id: action.id,
      action_type: actionType,
      note: `Admin memperbarui ${action.kind} menjadi ${action.value}.`,
    })
    return { auditRecorded: !audit.error }
  } catch {
    return { auditRecorded: false }
  }
}
