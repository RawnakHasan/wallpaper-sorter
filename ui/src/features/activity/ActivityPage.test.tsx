import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { router } from '../../router';
import { server } from '../../test/server';

it('groups activity batches and sends an undo-all mutation', async () => {
  const events = [
    { id: 11, batch: 5, time: 1_700_000_000, kind: 'assign', from: '/inbox/a.jpg', to: '/wallpapers/a.jpg', note: 'Assigned', undone: false, undoable: true },
    { id: 10, batch: 5, time: 1_700_000_000, kind: 'rename', from: '/wallpapers/a.jpg', to: '/wallpapers/b.jpg', note: 'Renamed', undone: false, undoable: true },
  ];
  const undoRequest = vi.fn();
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json({
      version: '1.0.0',
      library: '/wallpapers',
      config_file: '/config.json',
      activity_last_id: 11,
      intake: [],
      counts: { library_images: 2, inbox: 0, duplicates: 0, records: 2 },
      settings: { gap_mode: 'keep', image_extensions: ['jpg'], duplicates_folder: 'Duplicates', generic_max_words: 4 },
      setup_complete: true,
    })),
    http.get('http://127.0.0.1/api/activity', () => HttpResponse.json(events)),
    http.post('http://127.0.0.1/api/undo', async ({ request }) => {
      undoRequest(await request.json());
      return HttpResponse.json({ undone: events.map((event) => ({ id: event.id, from: event.from, to: event.to })) });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await router.navigate({ to: '/activity' });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'Activity' })).toBeTruthy();
  expect(screen.getByText('2 actions')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Undo all' }));

  await waitFor(() => expect(screen.getByText('Undone')).toBeTruthy());
  expect(undoRequest).toHaveBeenCalledWith({ batch: 5 });
  client.clear();
});
