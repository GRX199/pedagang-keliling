// src/lib/auth.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { syncCurrentProfile } from './profiles'
import { supabase } from './supabase'
import { createAuthSessionController, INITIAL_AUTH_STATE } from './auth-session'

const AuthContext = createContext({
  user: null,
  role: null,
  accountStatus: 'active',
  authError: '',
  loading: true,
  refreshAuth: async () => {},
})

export function AuthProvider({ children }){
  const [{ user, role, accountStatus, authError, loading }, setAuthState] = useState(INITIAL_AUTH_STATE)
  const controllerRef = useRef(null)

  const determineAuthMeta = useCallback(async (uid) => {
    if (!uid) {
      return { role: null, accountStatus: 'active' }
    }

    try {
      let profile = null

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role, account_status')
          .eq('id', uid)
          .maybeSingle()

        if (error) throw error
        profile = data || null
      } catch (profileError) {
        const message = String(profileError?.message || '').toLowerCase()
        if (message.includes('account_status')) {
          const { data, error } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', uid)
            .maybeSingle()

          if (error) throw error
          profile = data || null
        } else {
          throw profileError
        }
      }

      if (profile?.role === 'admin') {
        return {
          role: 'admin',
          accountStatus: profile.account_status || 'active',
        }
      }

      const { data, error } = await supabase
        .from('vendors')
        .select('id')
        .eq('id', uid)
        .maybeSingle()

      if (error) throw error
      return {
        role: data?.id ? 'vendor' : (profile?.role === 'vendor' ? 'vendor' : 'customer'),
        accountStatus: profile?.account_status || 'active',
      }
    } catch (error) {
      console.error('determineAuthMeta', error)
      throw new Error('Gagal memverifikasi role dan status akun. Periksa koneksi lalu coba lagi.', { cause: error })
    }
  }, [])

  const refreshAuth = useCallback(() => (
    controllerRef.current?.refresh(() => supabase.auth.getSession())
  ), [])

  useEffect(() => {
    const controller = createAuthSessionController({
      resolveMeta: determineAuthMeta,
      syncProfile: syncCurrentProfile,
      onChange: setAuthState,
    })
    controllerRef.current = controller
    // INITIAL_SESSION is emitted by Supabase; a second getSession here races login/logout.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      controller.handleSession(event, session)
    })

    return () => {
      controller.dispose()
      listener.subscription.unsubscribe()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [determineAuthMeta])

  const value = useMemo(() => ({
    user,
    role,
    accountStatus,
    authError,
    loading,
    refreshAuth,
  }), [accountStatus, authError, loading, refreshAuth, role, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
