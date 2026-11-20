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
  intake: [{
    index: 0,
    path: '/downloads',
    exists: true,
    recursive: true,
    remove_empty_folders: false,
    watching: true,
    error: null,
  }],
  counts: { library_images: 1, inbox: 0, duplicates: 0, records: 1 },
  settings,
  setup_complete: true,
};

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/settings'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('updates numbering settings and adds a watched intake folder', async () => {
  const settingsUpdates: unknown[] = [];
  const intakeUpdates: unknown[] = [];
  let gapMode = 'keep';
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json({
      ...status,
      settings: { ...settings, gap_mode: gapMode },
    })),
    http.put('http://127.0.0.1/api/settings', async ({ request }) => {
      const body = await request.json() as { gap_mode: string };
      settingsUpdates.push(body);
      gapMode = body.gap_mode;
      return HttpResponse.json({ ...settings, gap_mode: gapMode });
    }),
    http.post('http://127.0.0.1/api/intake', async ({ request }) => {
      intakeUpdates.push(await request.json());
      return HttpResponse.json({ intake: [] });
    }),
  );
  const { client } = renderSettings();

  expect(await screen.findByRole('heading', { name: 'Settings' }, { timeout: 5000 })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Gaps in the numbering' }), {
    target: { value: 'renumber' },
  });
  await waitFor(() => expect(settingsUpdates).toEqual([{ gap_mode: 'renumber' }]));

  fireEvent.click(screen.getByRole('button', { name: 'Add folder' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Intake folder path' }, { timeout: 5000 }), {
    target: { value: '/new-downloads' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(intakeUpdates).toEqual([{
    path: '/new-downloads',
    recursive: true,
    remove_empty_folders: false,
  }]));
  await waitFor(() => expect(screen.getByText('Intake folder added')).toBeTruthy());
  client.clear();
});

it('shows a recoverable error when settings cannot be loaded', async () => {
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json({ error: 'Settings unavailable' }, { status: 500 })),
  );
  const { client } = renderSettings();

  expect((await screen.findByRole('alert')).textContent).toContain('Settings unavailable');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  client.clear();
});
