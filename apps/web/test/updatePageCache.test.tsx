import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PageId, PagePath } from '@tablinum/shared';
import { useUpdatePage } from '../src/api/content';
import { qk } from '../src/api/keys';
import { page } from './fixtures';
import { installFetch, type MockServer } from './mockFetch';


let server: MockServer | null = null;

afterEach(() => {
  server?.restore();
  server = null;
});

describe('useUpdatePage cache', () => {
  it('drops the cache entry for the path a move left behind', async () => {
    const before = page({ path: 'eng/deploy', title: 'Deploy' });
    const after = { ...before, path: 'ops/deploy', space: 'ops' };
    server = installFetch({ [`PATCH /api/v1/pages/${before.id}`]: { page: after } });

    // Seeded entries have no observer, so the shared client's zero gcTime would evict them at once.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    client.setQueryData(qk.page(before.id as PageId), { page: before });
    client.setQueryData(qk.pageByPath(before.path as PagePath), { page: before });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdatePage(), { wrapper });

    result.current.mutate({ id: before.id as PageId, body: { path: after.path as PagePath } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(qk.pageByPath(after.path as PagePath))).toEqual({ page: after });
    expect(client.getQueryData(qk.pageByPath(before.path as PagePath))).toBeUndefined();
  });
});
