import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { server } from '../../test/server';

const settings = {
  gap_mode: 'keep',
  image_extensions: ['png'],
  duplicates_folder: 'Duplicates',
  generic_max_words: 4,
};

const status = {
  version: '1.0.0',
  library: '/wallpapers',
  config_file: '/config.toml',
  activity_last_id: 0,
  intake: [],
  counts: { library_images: 1, inbox: 0, duplicates: 1, records: 1 },
  settings,
  setup_complete: true,
};

const duplicate = {
  path: 'Duplicates/Copy.png',
  name: 'Copy.png',
  size: 1024,
  hash: null,
  duplicate_of: 'Nature/Original.png',
};

function renderDuplicates() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/duplicates'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('lists duplicates and restores one as a new image', async () => {
  let restoreRequest: unknown;
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/duplicates', () => HttpResponse.json([duplicate])),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json([{ path: 'Nature' }, { path: 'Duplicates' }])),
    http.post('http://127.0.0.1/api/duplicates/restore', async ({ request }) => {
      restoreRequest = await request.json();
      return HttpResponse.json({ batch: null, done: [] });
    }),
  );
  const { client } = renderDuplicates();

  expect(await screen.findByText('Copy.png')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Restore…' }));
  const folder = await screen.findByRole('textbox', { name: 'Folder' });
  fireEvent.change(folder, { target: { value: 'Nature' } });
  fireEvent.click(screen.getByRole('button', { name: 'Restore as new image' }));

  await waitFor(() => expect(restoreRequest).toEqual({ paths: ['Duplicates/Copy.png'], folder: 'Nature' }));
  expect(await screen.findByText('Restored 0 copies as new images')).toBeTruthy();
  client.clear();
});

it('shows a recoverable error when duplicate data cannot be loaded', async () => {
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/duplicates', () => HttpResponse.json({ error: 'Duplicates unavailable' }, { status: 500 })),
  );
  const { client } = renderDuplicates();

  expect((await screen.findByRole('alert')).textContent).toContain('Duplicates unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  client.clear();
});
