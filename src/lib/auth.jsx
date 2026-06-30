// src/lib/auth.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { syncCurrentProfile } from './profiles'
import { supabase } from './supabase'

const AuthContext = createContext({
  user: null,
  role: null,
  accountStatus: 'active',
  authError: '',
  loading: true,
  refreshAuth: async () => {},
})

export function AuthProvider({ children }){
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [accountStatus, setAccountStatus] = useState('active')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(true)
  const syncRequestIdRef = useRef(0)

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

  const syncAuthState = useCallback(async (sessionUser) => {
    const requestId = syncRequestIdRef.current + 1
    syncRequestIdRef.current = requestId
    setLoading(true)
    setUser(sessionUser)
    if (!sessionUser) {
      setRole(null)
      setAccountStatus('active')
      setAuthError('')
      if (syncRequestIdRef.current === requestId) setLoading(false)
      return
    }

    setRole(null)
    setAccountStatus('active')
    setAuthError('')

    try {
      const { role: nextRole, accountStatus: nextAccountStatus } = await determineAuthMeta(sessionUser.id)
      if (syncRequestIdRef.current !== requestId) return
      setRole(nextRole)
      setAccountStatus(nextAccountStatus || 'active')
      setAuthError('')
      await syncCurrentProfile(sessionUser, nextRole)
    } catch (error) {
      if (syncRequestIdRef.current !== requestId) return
      setRole(null)
      setAuthError(error.message || 'Gagal memverifikasi akses akun.')
    } finally {
      if (syncRequestIdRef.current === requestId) setLoading(false)
    }
  }, [determineAuthMeta])

  const refreshAuth = useCallback(async () => {
    setLoading(true)
    try {
      const response = await supabase.auth.getSession()
      await syncAuthState(response?.data?.session?.user ?? null)
    } catch (error) {
      console.error('refreshAuth', error)
      setLoading(false)
    }
  }, [syncAuthState])

  useEffect(() => {
    let mounted = true

    async function init(){
      try {
        const response = await supabase.auth.getSession()
        if (!mounted) return
        await syncAuthState(response?.data?.session?.user ?? null)
      } catch (error) {
        console.error('auth.init err', error)
        if (mounted) setLoading(false)
      }
    }

    init()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      syncAuthState(session?.user ?? null)
    })

    return () => {
      mounted = false
      try {
        listener.subscription.unsubscribe()
      } catch (error) {
        console.error('unsubscribeAuthListener', error)
      }
    }
  }, [syncAuthState])

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
