import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  expect(await screen.findByRole('heading', { name: 'Nature' }, { timeout: 5000 })).toBeTruthy();
  fireEvent.click(await screen.findByRole('listitem', { name: 'Nature 1.png' }, { timeout: 5000 }));
  expect(screen.getByText('1 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Move to folder…' }));

  const picker = await screen.findByRole('textbox', { name: 'Folder' }, { timeout: 5000 });
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

it('renders library site tags as separate tag chips in image details', async () => {
  const taggedImage = {
    path: 'Nature/Nature 1.png',
    name: 'Nature 1.png',
    number: 1,
    size: 120,
    hash: 'image-hash',
    origin: {
      hash: 'image-hash',
      path: 'Nature/Nature 1.png',
      original_name: 'wallhaven-abc123.png',
      sources: [{
        site: 'Wallhaven',
        id: 'abc123',
        url: 'https://wallhaven.cc/w/abc123',
        page: null,
        artist: null,
        artist_id: null,
      }],
      added: 1_700_000_000,
      note: '',
      width: 800,
      height: 600,
      tags: ['anime girls', 'black dress'],
      rating: 'sfw',
    },
  };
  server.use(
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json(folders)),
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/images', () => HttpResponse.json([taggedImage])),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([])),
  );
  const { client } = renderLibrary();

  fireEvent.click(await screen.findByRole('button', { name: 'Details of Nature 1.png' }));

  expect((await screen.findByText('anime girls')).className).toContain('tagchip');
  expect(screen.getByText('black dress').className).toContain('tagchip');
  expect(screen.queryByText('anime girls, black dress')).toBeNull();
  client.clear();
});

it('opens full-resolution Library images from the grid and navigates the current folder', async () => {
  const images = [
    { path: 'Nature/Nature 1.png', name: 'Nature 1.png', number: 1, size: 120, hash: 'image-hash-1', origin: null },
    { path: 'Nature/Nature 2.png', name: 'Nature 2.png', number: 2, size: 240, hash: 'image-hash-2', origin: null },
  ];
  const archiveImage = {
    path: 'Archive/Archive 1.png',
    name: 'Archive 1.png',
    number: 1,
    size: 300,
    hash: 'archive-hash',
    origin: null,
  };
  const galleryFolders = [
    { path: 'Nature', name: 'Nature', prefix: 'Nature', count: 2, next_number: 3, gaps: [] },
    { path: 'Archive', name: 'Archive', prefix: 'Archive', count: 1, next_number: 2, gaps: [] },
  ];
  server.use(
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json(galleryFolders)),
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/images', ({ request }) => {
      const folder = new URL(request.url).searchParams.get('folder');
      return HttpResponse.json(folder === 'Nature' ? images : folder === 'Archive' ? [archiveImage] : []);
    }),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([])),
  );
  const { client } = renderLibrary();

  fireEvent.click(await screen.findByRole('button', { name: 'View Nature 1.png full screen' }));
  const viewer = await screen.findByRole('dialog', { name: 'Full-screen image Nature 1.png' });
  const image = within(viewer).getByRole('img', { name: 'Nature 1.png' });
  const previous = screen.getByRole('button', { name: 'Previous image' });
  const next = screen.getByRole('button', { name: 'Next image' });
  const close = screen.getByRole('button', { name: 'Close viewer' });

  expect(image.getAttribute('src')).toBe('/api/image/image-hash-1');
  expect(previous.hasAttribute('disabled')).toBe(true);
  await waitFor(() => expect(next.hasAttribute('disabled')).toBe(false));
  for (const button of [previous, next, close]) {
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).toBeTruthy();
  }

  fireEvent.click(next);
  expect(await screen.findByRole('dialog', { name: 'Full-screen image Nature 2.png' })).toBeTruthy();
  expect(within(viewer).getByRole('img', { name: 'Nature 2.png' }).getAttribute('src'))
    .toBe('/api/image/image-hash-2');
  expect(next.hasAttribute('disabled')).toBe(false);
  expect(previous.hasAttribute('disabled')).toBe(false);
  fireEvent.click(next);
  expect(await screen.findByRole('dialog', { name: 'Full-screen image Archive 1.png' })).toBeTruthy();
  expect(within(viewer).getByRole('img', { name: 'Archive 1.png' }).getAttribute('src'))
    .toBe('/api/image/archive-hash');
  expect(next.hasAttribute('disabled')).toBe(true);
  fireEvent.click(previous);
  expect(await screen.findByRole('dialog', { name: 'Full-screen image Nature 2.png' })).toBeTruthy();
  fireEvent.click(previous);
  expect(await screen.findByRole('dialog', { name: 'Full-screen image Nature 1.png' })).toBeTruthy();
  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /Full-screen image/ })).toBeNull());
  expect(viewer.isConnected).toBe(false);
  client.clear();
});

it('opens the full-screen viewer from the image details sidebar', async () => {
  const image = {
    path: 'Nature/Nature 1.png',
    name: 'Nature 1.png',
    number: 1,
    size: 120,
    hash: 'image-hash',
    origin: null,
  };
  server.use(
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json(folders)),
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/images', ({ request }) => {
      const folder = new URL(request.url).searchParams.get('folder');
      return HttpResponse.json(folder === 'Nature' ? [image] : []);
    }),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([])),
  );
  const { client } = renderLibrary();

  fireEvent.click(await screen.findByRole('button', { name: 'Details of Nature 1.png' }));
  expect(await screen.findByRole('dialog', { name: 'Nature 1.png' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View full screen' }));

  expect(await screen.findByRole('dialog', { name: 'Full-screen image Nature 1.png' })).toBeTruthy();
  const viewer = screen.getByRole('dialog', { name: 'Full-screen image Nature 1.png' });
  expect(within(viewer).getByRole('img', { name: 'Nature 1.png' }).getAttribute('src'))
    .toBe('/api/image/image-hash');
  fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: /Full-screen image/ })).toBeNull());
  expect(screen.getByRole('dialog', { name: 'Nature 1.png' })).toBeTruthy();
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
