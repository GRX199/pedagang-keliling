import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
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
      mutations: { retry: false },
    },
  })
}

export const queryClient = createQueryClient()
