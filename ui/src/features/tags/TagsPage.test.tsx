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
  counts: { library_images: 1, inbox: 0, duplicates: 0, records: 1 },
  settings: {
    gap_mode: 'keep',
    image_extensions: ['png'],
    duplicates_folder: 'Duplicates',
    generic_max_words: 4,
  },
  setup_complete: true,
};

function renderTags() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/tags'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('tests a filename and saves a tag', async () => {
  let saveRequest: unknown;
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json([{ path: 'Nature' }, { path: 'Duplicates' }])),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([])),
    http.post('http://127.0.0.1/api/tags/test', async ({ request }) => {
      const body = await request.json() as { filename: string };
      return HttpResponse.json({
        words: body.filename.replace(/\.[^.]+$/, '').split(/[^a-z0-9]+/),
        rule: 'nature',
        dest: 'Nature',
        matched: ['nature'],
        ignored: null,
        new_name: null,
      });
    }),
    http.post('http://127.0.0.1/api/tags', async ({ request }) => {
      saveRequest = await request.json();
      return HttpResponse.json([]);
    }),
  );
  const { client } = renderTags();

  expect(await screen.findByRole('heading', { name: 'Tags' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Filename to test' }), {
    target: { value: 'nature-one.png' },
  });
  expect(await screen.findByText('Nature')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Folder' }), {
    target: { value: 'Nature' },
  });
  const keyword = screen.getByRole('textbox', { name: 'keyword, then Enter' });
  fireEvent.change(keyword, { target: { value: 'nature' } });
  fireEvent.keyDown(keyword, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(saveRequest).toEqual({
    keywords: ['nature'],
    dest: 'Nature',
    prefix: null,
    match: 'word',
    strict_words: [],
    generic: false,
  }));
  client.clear();
});

it('shows a recoverable error when tags cannot be loaded', async () => {
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json([{ path: 'Nature' }])),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json({ error: 'Tags unavailable' }, { status: 500 })),
  );
  const { client } = renderTags();

  expect((await screen.findByRole('alert')).textContent).toContain('Tags unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  client.clear();
});
