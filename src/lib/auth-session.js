export const INITIAL_AUTH_STATE = {
  user: null,
  role: null,
  accountStatus: 'active',
  authError: '',
  loading: true,
}

export function createAuthSessionController({ resolveMeta, syncProfile, onChange }) {
  let state = INITIAL_AUTH_STATE
  let revision = 0
  let timer = null
  let disposed = false
  let profileUserNeedsSync = null

  function publish(patch) {
    if (disposed) return
    state = { ...state, ...patch }
    onChange(state)
  }

  function handleSession(event, session, { force = false } = {}) {
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
        publish({ ...meta, authError: '', loading: false })
        if (profileUserNeedsSync === user.id) {
          profileUserNeedsSync = null
          await syncProfile(user, meta.role)
        }
      } catch (error) {
        if (disposed || requestId !== revision) return
        console.error('syncAuthSession', error)
        if (!background) {
          publish({ role: null, authError: error.message || 'Gagal memverifikasi akses akun.', loading: false })
        }
      }
    }, 0)
  }

  async function refresh(getSession) {
    const requestId = revision
    try {
      const response = await getSession()
      if (disposed || requestId !== revision) return
      if (response.error) throw response.error
      handleSession('REFRESH', response.data?.session, { force: true })
    } catch (error) {
      if (disposed || requestId !== revision) return
      publish({ authError: error.message || 'Gagal memuat sesi login.', loading: false })
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
