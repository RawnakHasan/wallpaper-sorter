import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { server } from '../../test/server';
import { useSelectionStore } from '../../stores/selection';

const status = {
  version: '1.0.0',
  library: '/wallpapers',
  config_file: '/config.toml',
  activity_last_id: 0,
  intake: [],
  counts: { library_images: 0, inbox: 2, duplicates: 0, records: 0 },
  settings: { gap_mode: 'keep', image_extensions: ['png'], duplicates_folder: 'Duplicates', generic_max_words: 4 },
  setup_complete: true,
};

const items = [
  { path: 'library/quiet.png', name: 'quiet.png', reason: 'no_match', matched: [], intake: 'library', size: 120, modified: 1, origin: null },
  { path: 'library/clash.png', name: 'clash.png', reason: 'conflict', matched: ['fox', 'art'], intake: 'library', size: 240, modified: 2, origin: null },
];

function renderInbox() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/inbox'] }),
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

it('filters inbox items and assigns the selected file to its chosen folder', async () => {
  const assignments: unknown[] = [];
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/inbox', () => HttpResponse.json(items)),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json([
      { path: 'Quiet', name: 'Quiet', prefix: 'Quiet', count: 0, next_number: 1, gaps: [] },
    ])),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([])),
    http.post('http://127.0.0.1/api/assign', async ({ request }) => {
      assignments.push(await request.json());
      return HttpResponse.json({ batch: 7, done: [], error: null });
    }),
  );
  const { client } = renderInbox();

  expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by reason' }), { target: { value: 'no_match' } });
  expect(screen.getByRole('listitem', { name: 'quiet.png' })).toBeTruthy();
  expect(screen.queryByRole('listitem', { name: 'clash.png' })).toBeNull();
  fireEvent.click(screen.getByRole('listitem', { name: 'quiet.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign to folder…' }));

  fireEvent.change(await screen.findByRole('textbox', { name: 'Folder' }), { target: { value: 'Quiet' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign' }));

  await waitFor(() => expect(assignments).toEqual([{
    paths: ['library/quiet.png'],
    folder: 'Quiet',
  }]));
  await waitFor(() => {
    expect(client.isMutating()).toBe(0);
    expect(client.isFetching()).toBe(0);
  });
  client.clear();
});

it('shows a recoverable error when the inbox cannot be loaded', async () => {
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/inbox', () => HttpResponse.json({ error: 'Inbox unavailable' }, { status: 500 })),
  );
  const { client } = renderInbox();

  expect((await screen.findByRole('alert')).textContent).toContain('Inbox unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  client.clear();
});
