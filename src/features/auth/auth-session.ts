import type { Session, User } from '@supabase/supabase-js'
import type { Role, AccountStatus } from '../../types/domain.types'
import { errorMessage } from '../../shared/lib/utils'
import { reportError } from '../../shared/lib/error-reporting'

export type AuthMeta = { role: Role; accountStatus: AccountStatus }
export type AuthState = {
  user: User | null
  role: Role | null
  accountStatus: AccountStatus
  authError: string
  loading: boolean
}
export const INITIAL_AUTH_STATE: AuthState = {
  user: null,
  role: null,
  accountStatus: 'active',
  authError: '',
  loading: true,
}

export function createAuthSessionController({
  resolveMeta,
  syncProfile,
  onChange,
}: {
  resolveMeta: (id: string) => Promise<AuthMeta>
  syncProfile: (user: User, role: Role) => Promise<{ id: string } | null>
  onChange: (state: AuthState) => void
}) {
  let state = INITIAL_AUTH_STATE
  let revision = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let profileUserNeedsSync: string | null = null

  function publish(patch: Partial<AuthState>) {
    if (disposed) return
    state = { ...state, ...patch }
    onChange(state)
  }

  function handleSession(event: string, session: Session | null, { force = false } = {}) {
    if (disposed) return
    const user = session?.user ?? null
    const sameUser = Boolean(user?.id && user.id === state.user?.id)
    const verified = sameUser && Boolean(state.role) && !state.authError
    // A token change must not remount protected pages or restart realtime subscriptions.
    if (event === 'TOKEN_REFRESHED' && verified && !force) return

    const requestId = ++revision
    clearTimeout(timer)
    if (!user) {
      profileUserNeedsSync = null
      publish({ ...INITIAL_AUTH_STATE, loading: false })
      return
    }

    const background = verified && !force
    const updateProfile = !sameUser || event === 'USER_UPDATED'
    if (updateProfile) profileUserNeedsSync = user.id
    publish({
      user: sameUser && !updateProfile ? state.user : user,
      role: sameUser ? state.role : null,
      accountStatus: sameUser ? state.accountStatus : 'active',
      authError: '',
      loading: !background,
    })

    // Supabase auth callbacks run inside its session lock. Query only after they return.
    timer = setTimeout(async () => {
      try {
        const meta = await resolveMeta(user.id)
        if (disposed || requestId !== revision) return
        if (meta.accountStatus !== 'active') {
          profileUserNeedsSync = null
          publish({ ...meta, authError: '', loading: false })
          return
        }
        if (profileUserNeedsSync === user.id) {
          const profile = await syncProfile(user, meta.role)
          if (disposed || requestId !== revision) return
          if (!profile || profile.id !== user.id) throw new Error('Profil akun belum siap. Periksa koneksi lalu coba masuk kembali.')
          profileUserNeedsSync = null
        }
        publish({ ...meta, authError: '', loading: false })
      } catch (error) {
        if (disposed || requestId !== revision) return
        void reportError(error, 'auth')
        if (!background) {
          publish({
            role: null,
            authError: errorMessage(error, 'Gagal memverifikasi akses akun.'),
            loading: false,
          })
        }
      }
    }, 0)
  }

  async function refresh(
    getSession: () => Promise<{ data: { session: Session | null }; error: Error | null }>
  ) {
    const requestId = revision
    try {
      const response = await getSession()
      if (disposed || requestId !== revision) return
      if (response.error) throw response.error
      handleSession('REFRESH', response.data?.session, { force: true })
    } catch (error) {
      if (disposed || requestId !== revision) return
      publish({ authError: errorMessage(error, 'Gagal memuat sesi login.'), loading: false })
    }
  }

  return {
    handleSession,
    refresh,
    dispose() {
      disposed = true
      revision += 1
      clearTimeout(timer)
    },
  }
}
