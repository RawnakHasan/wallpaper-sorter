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

const sourcedItem = {
  path: 'library/sky.png',
  name: 'sky.png',
  reason: 'no_match',
  matched: [],
  intake: 'library',
  size: 300,
  modified: 3,
  origin: {
    hash: 'sky-hash',
    path: 'library/sky.png',
    original_name: 'sky.png',
    sources: [{
      site: 'Danbooru',
      id: '123',
      url: 'https://danbooru.donmai.us/posts/123',
      artist: 'Example Artist',
      artist_id: '456',
    }],
    added: 1,
    note: '',
    width: 1920,
    height: 1080,
    tags: ['Tag Artist (artist)', 'blue sky', 'clouds', 'grass'],
    rating: 's',
  },
};

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

  expect(await screen.findByRole('heading', { name: 'Inbox' }, { timeout: 5000 })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by reason' }), { target: { value: 'no_match' } });
  expect(screen.getByRole('listitem', { name: 'quiet.png' })).toBeTruthy();
  expect(screen.queryByRole('listitem', { name: 'clash.png' })).toBeNull();
  fireEvent.click(screen.getByRole('listitem', { name: 'quiet.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign to folder…' }));

  fireEvent.change(await screen.findByRole('textbox', { name: 'Folder' }, { timeout: 5000 }), { target: { value: 'Quiet' } });
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

it('shows conflict candidates and assigns the clicked destination', async () => {
  const assignments: unknown[] = [];
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/inbox', () => HttpResponse.json([{
      ...sourcedItem,
      candidates: [
        { folder: 'Nature', matched: ['beach'] },
        { folder: 'Anime', matched: ['anime girls'] },
      ],
    }])),
    http.post('http://127.0.0.1/api/assign', async ({ request }) => {
      assignments.push(await request.json());
      return HttpResponse.json({ batch: 7, done: [], error: null });
    }),
  );
  const { client } = renderInbox();

  fireEvent.click(await screen.findByRole('button', { name: 'Details of sky.png' }));
  expect(screen.getByRole('heading', { name: 'Possible destinations' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Nature \(from "beach"\)/ }));

  await waitFor(() => expect(assignments).toEqual([{
    paths: ['library/sky.png'],
    folder: 'Nature',
  }]));
  client.clear();
});

it('selects metadata phrases, confirms a new tag, and reports additional sorted images', async () => {
  const assignments: unknown[] = [];
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/inbox', () => HttpResponse.json([sourcedItem])),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json([
      { path: 'Nature', name: 'Nature', prefix: 'Nature', count: 0, next_number: 1, gaps: [] },
    ])),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([])),
    http.post('http://127.0.0.1/api/assign', async ({ request }) => {
      assignments.push(await request.json());
      return HttpResponse.json({
        batch: 7,
        done: [{ id: 1, kind: 'move', from: 'sky.png', to: '/wallpapers/Nature/Nature 1.png' }],
        error: null,
        additional_sorted: 2,
        additional_batch: 8,
        additional_error: null,
      });
    }),
  );
  const { client } = renderInbox();

  fireEvent.click(await screen.findByRole('button', { name: 'Details of sky.png' }));
  expect(screen.getByRole('heading', { name: 'Artist' })).toBeTruthy();
  expect(screen.getByText('Example Artist')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tag Artist' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Tag Artist (artist)' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Site tags' })).toBeTruthy();

  const skyTag = screen.getByRole('button', { name: 'blue sky' });
  const cloudTag = screen.getByRole('button', { name: 'clouds' });
  const grassTag = screen.getByRole('button', { name: 'grass' });
  fireEvent.click(grassTag);
  fireEvent.click(grassTag);
  expect(grassTag.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(skyTag);
  fireEvent.click(cloudTag);
  expect(skyTag.getAttribute('aria-pressed')).toBe('true');
  expect(cloudTag.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Assign with selected tags (2)…' }));

  expect(await screen.findByRole('dialog', { name: 'Assign to folder' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'blue sky' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.change(screen.getByRole('textbox', { name: 'Folder' }), { target: { value: 'Nature' } });
  const generic = screen.getByRole('checkbox', { name: 'Generic tag (default)' }) as HTMLInputElement;
  expect(generic.checked).toBe(true);
  fireEvent.click(generic);
  fireEvent.click(screen.getByRole('button', { name: 'Assign' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create tag & assign' }));

  await waitFor(() => expect(assignments).toEqual([{
    paths: ['library/sky.png'],
    folder: 'Nature',
    tag: {
      keywords: ['blue sky', 'clouds'],
      dest: 'Nature',
      generic: false,
    },
  }]));
  expect(await screen.findByText(/sorted 2 additional images using the new tag/)).toBeTruthy();
  await waitFor(() => expect(client.isMutating()).toBe(0));
  client.clear();
});

it('parses a pasted source link and looks up metadata without leaving the Inbox', async () => {
  const sourceUpdates: unknown[] = [];
  const lookups: unknown[] = [];
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/inbox', () => HttpResponse.json([sourcedItem])),
    http.put('http://127.0.0.1/api/origins', async ({ request }) => {
      sourceUpdates.push(await request.json());
      return HttpResponse.json({ ok: true });
    }),
    http.post('http://127.0.0.1/api/origins/lookup', async ({ request }) => {
      lookups.push(await request.json());
      return HttpResponse.json({ tags_updated: 3, sorted_to: null, batch: null });
    }),
  );
  const { client } = renderInbox();

  fireEvent.click(await screen.findByRole('button', { name: 'Details of sky.png' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Source ID or link' }), {
    target: { value: 'https://wallhaven.cc/w/abc123' },
  });
  expect((screen.getByRole('combobox', { name: 'Source site' }) as HTMLSelectElement).value).toBe('Wallhaven');
  expect((screen.getByRole('textbox', { name: 'Source ID or link' }) as HTMLInputElement).value).toBe('abc123');
  fireEvent.click(screen.getByRole('button', { name: 'Save source' }));
  await waitFor(() => expect(sourceUpdates).toEqual([{
    hash: 'sky-hash',
    site: 'Wallhaven',
    id: 'abc123',
  }]));

  fireEvent.click(screen.getByRole('button', { name: 'Look up tags' }));
  await waitFor(() => expect(lookups).toEqual([{
    hash: 'sky-hash',
    site: 'Wallhaven',
    id: 'abc123',
  }]));
  expect(await screen.findByText('Looked up 3 tags; image remains in the Inbox.')).toBeTruthy();
  client.clear();
});
