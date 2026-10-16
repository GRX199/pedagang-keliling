import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import type { AuthMeta, AuthState } from './auth-session'
import { syncCurrentProfile } from '../../lib/profiles'
import { reportError } from '../../shared/lib/error-reporting'
import { supabase } from '../../shared/lib/supabase'
import { createAuthSessionController, INITIAL_AUTH_STATE } from './auth-session'

type AuthContextValue = AuthState & { refreshAuth: () => Promise<void> }
const AuthContext = createContext<AuthContextValue>({
  user: null,
  role: null,
  accountStatus: 'active',
  authError: '',
  loading: true,
  refreshAuth: async () => {},
})

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [{ user, role, accountStatus, authError, loading }, setAuthState] =
    useState(INITIAL_AUTH_STATE)
  const controllerRef = useRef<ReturnType<typeof createAuthSessionController> | null>(null)
  const identityRef = useRef<string | null>(null)

  const determineAuthMeta = useCallback(
    async (uid: string): Promise<AuthMeta> =>
      queryClient.fetchQuery({
        queryKey: ['auth-meta', uid],
        staleTime: 0,
        queryFn: async () => {
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
              const message = String(
                profileError && typeof profileError === 'object' && 'message' in profileError
                  ? profileError.message
                  : ''
              ).toLowerCase()
              if (message.includes('account_status')) {
                const { data, error } = await supabase
                  .from('profiles')
                  .select('role')
                  .eq('id', uid)
                  .maybeSingle()

                if (error) throw error
                profile = data ? { ...data, account_status: 'active' } : null
              } else {
                throw profileError
              }
            }

            if (profile?.role === 'admin') {
              return {
                role: 'admin',
                accountStatus:
                  profile.account_status === 'blocked' || profile.account_status === 'suspended'
                    ? profile.account_status
                    : 'active',
              }
            }

            const { data, error } = await supabase
              .from('vendors')
              .select('id')
              .eq('id', uid)
              .maybeSingle()

            if (error) throw error
            return {
              role: data?.id ? 'vendor' : profile?.role === 'vendor' ? 'vendor' : 'customer',
              accountStatus:
                profile?.account_status === 'blocked' || profile?.account_status === 'suspended'
                  ? profile.account_status
                  : 'active',
            }
          } catch (error) {
            void reportError(error, 'auth')
            throw new Error(
              'Gagal memverifikasi role dan status akun. Periksa koneksi lalu coba lagi.',
              { cause: error }
            )
          }
        },
      }),
    [queryClient]
  )

  const refreshAuth = useCallback(async () => {
    await controllerRef.current?.refresh(() => supabase.auth.getSession())
  }, [])

  useEffect(() => {
    const controller = createAuthSessionController({
      resolveMeta: determineAuthMeta,
      syncProfile: syncCurrentProfile,
      onChange: (next) => {
        const identity = next.user?.id || null
        if (identity !== identityRef.current) {
          queryClient.clear()
          identityRef.current = identity
        }
        setAuthState(next)
      },
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
  }, [determineAuthMeta, queryClient])

  const value = useMemo(
    () => ({
      user,
      role,
      accountStatus,
      authError,
      loading,
      refreshAuth,
    }),
    [accountStatus, authError, loading, refreshAuth, role, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
