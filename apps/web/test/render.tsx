import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from '../src/lib/theme';
import { ToastProvider } from '../src/lib/toast';
import { WorkspaceProvider } from '../src/lib/workspace';

/** Retries and background refetches make assertions flaky; both are off here. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

/** Shows the current route so navigation is assertable. */
export function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

export interface RenderAppOptions {
  route?: string;
  client?: QueryClient;
}

export function renderApp(ui: ReactNode, options: RenderAppOptions = {}): RenderResult {
  const client = options.client ?? testQueryClient();
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[options.route ?? '/']}>
            <WorkspaceProvider>
              <LocationProbe />
              {ui}
            </WorkspaceProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}
