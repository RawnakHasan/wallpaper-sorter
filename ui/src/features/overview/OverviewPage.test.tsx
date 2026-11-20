import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { router } from '../../router';
import { server } from '../../test/server';

it('loads overview data and invalidates queries after undo', async () => {
  const activity = {
    id: 11,
    batch: 5,
    time: 1_700_000_000,
    kind: 'assign',
    from: '/inbox/a.jpg',
    to: '/wallpapers/Nature/a.jpg',
    note: 'Assigned from Inbox',
    undone: false,
    undoable: true,
  };
  const undoRequest = vi.fn();
  let activityRequests = 0;
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json({
      version: '1.0.0',
      library: '/wallpapers',
      config_file: '/config.json',
      activity_last_id: 11,
      intake: [],
      counts: { library_images: 4, inbox: 2, duplicates: 0, records: 4 },
      settings: { gap_mode: 'keep', image_extensions: ['jpg'], duplicates_folder: 'Duplicates', generic_max_words: 4 },
      setup_complete: true,
    })),
    http.get('http://127.0.0.1/api/activity', () => {
      activityRequests += 1;
      return HttpResponse.json([activity]);
    }),
    http.post('http://127.0.0.1/api/undo', async ({ request }) => {
      undoRequest(await request.json());
      return HttpResponse.json({ undone: [{ id: 11, from: activity.to, to: activity.from }] });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
  expect(screen.getByText('4 images in /wallpapers')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

  await waitFor(() => expect(screen.getByText('Undone')).toBeTruthy());
  expect(undoRequest).toHaveBeenCalledWith({ id: 11 });
  expect(activityRequests).toBeGreaterThan(1);
  client.clear();
});
