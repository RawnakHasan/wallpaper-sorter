import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { server } from '../../test/server';

afterEach(() => {
  localStorage.removeItem('ws-git-preferences');
});

it('shows Git status and commits selected changes', async () => {
  let commitRequest: unknown;
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json({
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
    })),
    http.get('http://127.0.0.1/api/git/status', () => HttpResponse.json({
      repository: '/wallpapers',
      branch: 'main',
      remote: 'origin',
      up_to_date: true,
      commits_to_push: 0,
      changes: [
        { path: 'Skies/sky-014.png', status: 'Added', from: null },
        { path: 'Inbox/peak.jpg', status: 'Renamed', from: 'Inbox/peak-old.jpg' },
      ],
    })),
    http.get('http://127.0.0.1/api/git/log', () => HttpResponse.json({
      items: [
        { hash: 'a3f9c21', message: 'Sort 12 images', date: 1_700_000_000, local: true },
      ],
    })),
    http.post('http://127.0.0.1/api/git/commit', async ({ request }) => {
      commitRequest = await request.json();
      return HttpResponse.json({
        hash: 'b7e2c11',
        message: 'Add sky wallpaper',
        changed: 1,
      });
    }),
  );

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/git'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByText('main')).toBeTruthy();
  expect(screen.getByText('Added')).toBeTruthy();
  expect(screen.getByText(/Inbox\/peak-old\.jpg → Inbox\/peak\.jpg/)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Skies/sky-014.png' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
    target: { value: 'Add sky wallpaper' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Commit' }));

  await waitFor(() => expect(commitRequest).toEqual({
    repository: '/wallpapers',
    paths: ['Skies/sky-014.png'],
    message: 'Add sky wallpaper',
  }));
  expect(await screen.findByText(/Committed b7e2c11/)).toBeTruthy();
  client.clear();
});
