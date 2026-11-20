import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { server } from '../../test/server';
import { useSelectionStore } from '../../stores/selection';

const folders = [
  { path: 'Nature', name: 'Nature', prefix: 'Nature', count: 1, next_number: 2, gaps: [] },
  { path: 'Archive', name: 'Archive', prefix: 'Archive', count: 0, next_number: 1, gaps: [] },
];

const status = {
  version: '1.0.0',
  library: '/wallpapers',
  config_file: '/config.toml',
  activity_last_id: 0,
  intake: [],
  counts: { library_images: 1, inbox: 0, duplicates: 0, records: 1 },
  settings: { gap_mode: 'keep', image_extensions: ['png'], duplicates_folder: 'Duplicates', generic_max_words: 4 },
  setup_complete: true,
};

function renderLibrary() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/library?folder=Nature'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

afterEach(() => {
  useSelectionStore.getState().clear();
});

it('renders library images and moves a selection using the chosen destination', async () => {
  const assignments: unknown[] = [];
  let folderRequests = 0;
  server.use(
    http.get('http://127.0.0.1/api/folders', () => {
      folderRequests += 1;
      return HttpResponse.json(folders);
    }),
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/images', () => HttpResponse.json([
      { path: 'Nature/Nature 1.png', name: 'Nature 1.png', number: 1, size: 120, hash: null, origin: null },
    ])),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([])),
    http.post('http://127.0.0.1/api/assign', async ({ request }) => {
      assignments.push(await request.json());
      return HttpResponse.json({ batch: 7, done: [], error: null });
    }),
  );
  const { client } = renderLibrary();

  expect(await screen.findByRole('heading', { name: 'Nature' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('listitem', { name: 'Nature 1.png' }));
  expect(screen.getByText('1 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Move to folder…' }));

  const picker = await screen.findByRole('textbox', { name: 'Folder' });
  fireEvent.change(picker, { target: { value: 'Archive' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move' }));

  await waitFor(() => expect(assignments).toEqual([{
    paths: ['Nature/Nature 1.png'],
    folder: 'Archive',
  }]));
  await waitFor(() => expect(folderRequests).toBeGreaterThan(1));
  await waitFor(() => {
    expect(client.isMutating()).toBe(0);
    expect(client.isFetching()).toBe(0);
  });
  client.clear();
});

it('renders a recoverable error when the folder list cannot be loaded', async () => {
  server.use(
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json({ error: 'Folder service unavailable' }, { status: 500 })),
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
  );
  const { client } = renderLibrary();

  expect((await screen.findByRole('alert')).textContent).toContain('Folder service unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  client.clear();
});
