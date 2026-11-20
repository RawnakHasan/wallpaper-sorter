import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { server } from './server';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';

function StatusProbe() {
  const { data } = useQuery({
    queryKey: ['status'],
    queryFn: async () => {
      const response = await fetch('http://127.0.0.1/api/status');
      return response.json() as Promise<{ status: string }>;
    },
  });
  return <span>{data?.status ?? 'loading'}</span>;
}

it('provides cached server data through the Query provider', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server.use(http.get('http://127.0.0.1/api/status', () => HttpResponse.json({ status: 'Watching' })));

  render(
    <QueryClientProvider client={client}>
      <StatusProbe />
    </QueryClientProvider>,
  );

  expect(await screen.findByText('Watching')).toBeTruthy();
  client.clear();
});
