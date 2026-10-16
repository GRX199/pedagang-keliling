import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { queryErrorArea, reportError } from './error-reporting'
import { assertOnlineForWrite } from '../../lib/network'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => { void reportError(error, queryErrorArea(query.queryKey), 'query') } }),
    mutationCache: new MutationCache({ onMutate: assertOnlineForWrite, onError: (error, _variables, _context, mutation) => {
      void reportError(error, queryErrorArea(mutation.options.mutationKey || []), 'mutation')
    } }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (attempt, error) => {
          const code =
            error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
          return attempt < 1 && !['401', '403', '42501', 'PGRST301'].includes(code)
        },
      },
      // Never replay a transaction automatically after an uncertain network result.
      mutations: { retry: false, networkMode: 'always' },
    },
  })
}

export const queryClient = createQueryClient()
