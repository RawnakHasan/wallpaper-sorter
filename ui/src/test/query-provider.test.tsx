import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { server } from './server';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { getStatus, statusQueryKey } from '../features/status/api';
import { sendJson } from '../lib/api-client';

function StatusProbe() {
  const { data } = useQuery({
    queryKey: statusQueryKey,
    queryFn: getStatus,
  });
  return <span>{data?.counts.inbox ?? 'loading'}</span>;
}

it('provides cached server data through the Query provider', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server.use(http.get('http://127.0.0.1/api/status', () => HttpResponse.json({
    version: '1.0.0',
    library: '/wallpapers',
    config_file: '/config.json',
    activity_last_id: 8,
    intake: [],
    counts: { library_images: 10, inbox: 3, duplicates: 0, records: 10 },
    settings: { gap_mode: 'keep', image_extensions: ['jpg'], duplicates_folder: 'Duplicates', generic_max_words: 4 },
    setup_complete: true,
    future_field: 'preserved',
  })));
  await expect(getStatus()).resolves.toMatchObject({ counts: { inbox: 3 } });

  render(
    <QueryClientProvider client={client}>
      <StatusProbe />
    </QueryClientProvider>,
  );

  expect(await screen.findByText('3')).toBeTruthy();
  expect(client.getQueryData<{ future_field?: string }>(statusQueryKey)?.future_field).toBe('preserved');
  client.clear();
});

it('rejects malformed status payloads instead of masking the API error', async () => {
  server.use(http.get('http://127.0.0.1/api/status', () => HttpResponse.json({ counts: {} })));

  await expect(getStatus()).rejects.toMatchObject({
    message: 'Invalid response from the sorter',
    status: 200,
  });
});

it('validates request bodies and response payloads at the API boundary', async () => {
  const requestSchema = z.object({ folder: z.string() });
  const responseSchema = z.object({ created: z.string() });
  server.use(http.post('http://127.0.0.1/api/folders', async ({ request }) => {
    const body = requestSchema.parse(await request.json());
    return HttpResponse.json({ created: body.folder });
  }));

  await expect(sendJson('POST', '/api/folders', { folder: 'Nature' }, requestSchema, responseSchema))
    .resolves.toEqual({ created: 'Nature' });
});
