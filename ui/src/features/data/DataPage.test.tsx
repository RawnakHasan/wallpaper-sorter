import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { server } from '../../test/server';

const unknownRecord = {
  hash: 'unknown-hash',
  path: '/wallpapers/quiet.png',
  folder: 'Nature',
  name: 'quiet.png',
  original_name: 'download.png',
  sources: [{ site: 'Unknown', id: '' }],
  added: 1_700_000_000,
  width: 800,
  height: 600,
  note: '',
};

function renderData() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/data'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('filters unknown-source records and saves a manually selected source', async () => {
  const saves: unknown[] = [];
  server.use(
    http.get('http://127.0.0.1/api/data', ({ request }) => {
      const url = new URL(request.url);
      return HttpResponse.json({
        total: 1,
        offset: Number(url.searchParams.get('offset') ?? 0),
        items: [unknownRecord],
      });
    }),
    http.put('http://127.0.0.1/api/origins', async ({ request }) => {
      saves.push(await request.json());
      return HttpResponse.json({ ok: true });
    }),
  );
  const { client } = renderData();

  expect(await screen.findByRole('heading', { name: 'Data' }, { timeout: 5000 })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Unknown source (1)' }));
  fireEvent.click(await screen.findByRole('row', { name: /quiet\.png/ }, { timeout: 5000 }));

  const sites = await screen.findAllByRole('combobox', { name: 'Site' }, { timeout: 5000 });
  fireEvent.change(sites[1], { target: { value: 'Wallhaven' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Id on the site' }), { target: { value: 'wallhaven-123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save source' }));

  await waitFor(() => expect(saves).toEqual([{
    hash: 'unknown-hash',
    site: 'Wallhaven',
    id: 'wallhaven-123',
  }]));
  await waitFor(() => expect(screen.getByText('Source saved')).toBeTruthy());
  client.clear();
});

it('selects unknown records and saves one source with individual optional IDs', async () => {
  const secondRecord = {
    ...unknownRecord,
    hash: 'unknown-hash-2',
    path: '/wallpapers/second.png',
    name: 'second.png',
  };
  const saves: unknown[] = [];
  server.use(
    http.get('http://127.0.0.1/api/data', ({ request }) => {
      const url = new URL(request.url);
      const unknown = url.searchParams.get('unknown') === '1';
      return HttpResponse.json({
        total: unknown ? 2 : 0,
        offset: Number(url.searchParams.get('offset') ?? 0),
        items: unknown ? [unknownRecord, secondRecord] : [],
      });
    }),
    http.put('http://127.0.0.1/api/origins', async ({ request }) => {
      saves.push(await request.json());
      return HttpResponse.json({ ok: true });
    }),
  );
  const { client } = renderData();

  expect(await screen.findByRole('heading', { name: 'Data' }, { timeout: 5000 })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Unknown source (2)' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all unknown records' }, { timeout: 5000 }));
  fireEvent.click(await screen.findByRole('button', { name: 'Set sources (2)' }, { timeout: 5000 }));

  const sheet = await screen.findByRole('dialog', { name: 'Set sources for 2 records' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Batch source' }), { target: { value: 'Zerochan' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'ID for quiet.png' }), { target: { value: '12345' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save sources' }));

  await waitFor(() => expect(saves).toEqual([
    { hash: 'unknown-hash', site: 'Zerochan', id: '12345' },
    { hash: 'unknown-hash-2', site: 'Zerochan', id: '' },
  ]));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set sources for 2 records' })).toBeNull());
  client.clear();
});

it('shows a recoverable error when data records cannot be loaded', async () => {
  server.use(
    http.get('http://127.0.0.1/api/data', () => HttpResponse.json({ error: 'Data unavailable' }, { status: 500 })),
  );
  const { client } = renderData();

  expect((await screen.findByRole('alert')).textContent).toContain('Data unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  client.clear();
});
