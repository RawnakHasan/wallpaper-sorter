import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { server } from '../../test/server';

const status = {
  version: '1.0.0',
  library: '/wallpapers',
  config_file: '/config.toml',
  activity_last_id: 0,
  intake: [],
  counts: { library_images: 2, inbox: 0, duplicates: 0, records: 2 },
  settings: {
    gap_mode: 'keep',
    image_extensions: ['png'],
    duplicates_folder: 'Duplicates',
    generic_max_words: 4,
  },
  setup_complete: true,
};

function renderResort() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/resort'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('scans and applies a re-sort preview', async () => {
  let applyRequest: unknown;
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json([{ path: 'Nature' }, { path: 'Duplicates' }])),
    http.get('http://127.0.0.1/api/resort', () => HttpResponse.json({
      items: [{ kind: 'move', from: 'Nature/old.png', to: 'Nature/new.png', rule: 'nature', matched: ['nature'] }],
      changes: 1,
    })),
    http.post('http://127.0.0.1/api/resort', async ({ request }) => {
      applyRequest = await request.json();
      return HttpResponse.json({ batch: 7, done: [{ id: 1, kind: 'move', from: 'Nature/old.png', to: 'Nature/new.png' }] });
    }),
  );
  const { client } = renderResort();

  expect(await screen.findByRole('heading', { name: 'Re-sort' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Scan and preview' }));
  expect(await screen.findByText('1 change ready')).toBeTruthy();
  expect(screen.getByText(/Nature\/old\.png → Nature\/new\.png/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }));
  await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Apply re-sort' }));
  await waitFor(() => expect(applyRequest).toEqual({}));
  client.clear();
});

it('shows a recoverable error when re-sort folders cannot be loaded', async () => {
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json({ error: 'Folders unavailable' }, { status: 500 })),
  );
  const { client } = renderResort();

  expect((await screen.findByRole('alert')).textContent).toContain('Folders unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  client.clear();
});
