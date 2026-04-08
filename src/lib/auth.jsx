// src/lib/auth.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext({
  user: null,
  role: null,
  loading: true,
  refreshAuth: async () => {},
})

export function AuthProvider({ children }){
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [loading, setLoading] = useState(true)

  const determineRole = useCallback(async (uid) => {
    if (!uid) return null

    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('id')
        .eq('id', uid)
        .maybeSingle()

      if (error) throw error
      return data?.id ? 'vendor' : 'customer'
    } catch (error) {
      console.error('determineRole', error)
      return 'customer'
    }
  }, [])

  const syncAuthState = useCallback(async (sessionUser) => {
    setUser(sessionUser)
    if (!sessionUser) {
      setRole(null)
      setLoading(false)
      return
    }

    const nextRole = await determineRole(sessionUser.id)
    setRole(nextRole)
    setLoading(false)
  }, [determineRole])

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
    loading,
    refreshAuth,
  }), [loading, refreshAuth, role, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
