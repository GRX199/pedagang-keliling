// src/lib/auth.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { syncCurrentProfile } from './profiles'
import { supabase } from './supabase'

const AuthContext = createContext({
  user: null,
  role: null,
  accountStatus: 'active',
  loading: true,
  refreshAuth: async () => {},
})

export function AuthProvider({ children }){
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [accountStatus, setAccountStatus] = useState('active')
  const [loading, setLoading] = useState(true)

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
      return {
        role: 'customer',
        accountStatus: 'active',
      }
    }
  }, [])

  const syncAuthState = useCallback(async (sessionUser) => {
    setUser(sessionUser)
    if (!sessionUser) {
      setRole(null)
      setAccountStatus('active')
      setLoading(false)
      return
    }

    const { role: nextRole, accountStatus: nextAccountStatus } = await determineAuthMeta(sessionUser.id)
    setRole(nextRole)
    setAccountStatus(nextAccountStatus || 'active')
    await syncCurrentProfile(sessionUser, nextRole)
    setLoading(false)
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
    loading,
    refreshAuth,
  }), [accountStatus, loading, refreshAuth, role, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
