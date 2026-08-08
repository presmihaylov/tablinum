import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './client';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // 4xx answers are final; only transient failures are worth repeating.
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: 0 },
    },
  });
}

export const queryClient = createQueryClient();
