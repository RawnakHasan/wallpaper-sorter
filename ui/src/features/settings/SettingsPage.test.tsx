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

it('saves an ordered wallpaper script argument list with the wallpaper path token', async () => {
  const updates: unknown[] = [];
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.put('http://127.0.0.1/api/settings', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      updates.push(body);
      return HttpResponse.json({ ...settings, ...body });
    }),
  );
  const { client } = renderSettings();

  fireEvent.change(await screen.findByRole('textbox', { name: 'Bash script location' }), {
    target: { value: '~/bin/apply-wallpaper.sh' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add text argument' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Argument 1' }), {
    target: { value: '--image' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add wallpaper path' }));
  expect(screen.getByRole('region', { name: 'Wallpaper command preview' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Save wallpaper script' }));
  await waitFor(() => expect(updates).toEqual([{
    wallpaper_apply_script: '~/bin/apply-wallpaper.sh',
    wallpaper_apply_args: ['--image', '{wallpaper_path}'],
  }]));
  client.clear();
});

it('saves API credentials without reading them back and persists the rating safeguards', async () => {
  let secretUpdate: unknown;
  const settingUpdates: unknown[] = [];
  let wallhavenSaved = false;
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/secrets', () => HttpResponse.json({
      wallhaven_saved: wallhavenSaved,
      danbooru_saved: false,
      danbooru_username: null,
      danbooru_user_id: null,
    })),
    http.put('http://127.0.0.1/api/settings', async ({ request }) => {
      settingUpdates.push(await request.json());
      return HttpResponse.json({
        ...settings,
        danbooru_rating: 'g',
        wallhaven_purity: 'sketchy',
      });
    }),
    http.put('http://127.0.0.1/api/secrets', async ({ request }) => {
      secretUpdate = await request.json();
      wallhavenSaved = true;
      return HttpResponse.json({
        wallhaven_saved: true,
        danbooru_saved: false,
        danbooru_username: null,
        danbooru_user_id: null,
      });
    }),
  );
  const { client } = renderSettings();

  fireEvent.change(await screen.findByRole('combobox', { name: 'Maximum Wallhaven purity' }), {
    target: { value: 'sketchy' },
  });
  await waitFor(() => expect(settingUpdates).toEqual([{ wallhaven_purity: 'sketchy' }]));
  fireEvent.change(screen.getByRole('combobox', { name: 'Maximum Safebooru rating' }), {
    target: { value: 'safe' },
  });
  await waitFor(() => expect(settingUpdates).toEqual([
    { wallhaven_purity: 'sketchy' },
    { safebooru_rating: 'safe' },
  ]));

  fireEvent.change(screen.getByLabelText('Wallhaven API key'), {
    target: { value: 'wallhaven-secret-value' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save API credentials' }));

  await waitFor(() => expect(secretUpdate).toEqual({
    wallhaven_api_key: 'wallhaven-secret-value',
  }));
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Wallhaven API key' }));
  fireEvent.change(screen.getByLabelText('Wallhaven API key'), {
    target: { value: 'replacement-key' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save API credentials' }));
  await waitFor(() => expect(secretUpdate).toEqual({
    wallhaven_api_key: 'replacement-key',
  }));
  expect(await screen.findByRole('button', { name: 'Remove Wallhaven key' })).toBeTruthy();
  client.clear();
});

it('saves Zerochan identity, Konachan rating, and the unrated-site warning preference', async () => {
  const updates: unknown[] = [];
  const currentSettings = {
    ...settings,
    konachan_rating: 's',
    zerochan_username_saved: false,
    zerochan_username: '',
    warn_before_unrated_sites: true,
  };
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json({
      ...status,
      settings: currentSettings,
    })),
    http.get('http://127.0.0.1/api/secrets', () => HttpResponse.json({
      wallhaven_saved: false,
      danbooru_saved: false,
      danbooru_username: null,
      danbooru_user_id: null,
    })),
    http.put('http://127.0.0.1/api/settings', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>;
      updates.push(body);
      if (typeof body.zerochan_username === 'string') {
        currentSettings.zerochan_username = body.zerochan_username;
        currentSettings.zerochan_username_saved = Boolean(body.zerochan_username);
      }
      if (typeof body.konachan_rating === 'string') currentSettings.konachan_rating = body.konachan_rating;
      if (typeof body.warn_before_unrated_sites === 'boolean') currentSettings.warn_before_unrated_sites = body.warn_before_unrated_sites;
      return HttpResponse.json(currentSettings);
    }),
  );
  const { client } = renderSettings();

  const zerochanName = await screen.findByRole('textbox', { name: 'Zerochan username' });
  fireEvent.change(zerochanName, { target: { value: 'sample-user' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Zerochan username' }));
  await waitFor(() => expect(updates[0]).toEqual({ zerochan_username: 'sample-user' }));
  expect(await screen.findByText('sample-user')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Zerochan username' }));
  const editName = screen.getByRole('textbox', { name: 'Zerochan username' }) as HTMLInputElement;
  expect(editName.value).toBe('sample-user');
  fireEvent.change(editName, { target: { value: 'updated-user' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Zerochan username' }));
  await waitFor(() => expect(updates[1]).toEqual({ zerochan_username: 'updated-user' }));

  fireEvent.change(screen.getByRole('combobox', { name: 'Maximum Konachan.net rating' }), {
    target: { value: 'q' },
  });
  await waitFor(() => expect(updates[2]).toEqual({ konachan_rating: 'q' }));

  const warning = screen.getByRole('checkbox', { name: /Warn before using unrated sites/ });
  expect((warning as HTMLInputElement).checked).toBe(true);
  fireEvent.click(warning);
  await waitFor(() => expect(updates[3]).toEqual({ warn_before_unrated_sites: false }));
  await waitFor(() => expect((screen.getByRole('checkbox', { name: /Warn before using unrated sites/ }) as HTMLInputElement).checked).toBe(false));
  fireEvent.click(screen.getByRole('checkbox', { name: /Warn before using unrated sites/ }));
  await waitFor(() => expect(updates[4]).toEqual({ warn_before_unrated_sites: true }));
  client.clear();
});

it('shows editable Danbooru identity while keeping its API key write-only', async () => {
  let update: unknown;
  server.use(
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.get('http://127.0.0.1/api/secrets', () => HttpResponse.json({
      wallhaven_saved: false,
      danbooru_saved: true,
      danbooru_username: 'alice',
      danbooru_user_id: '123',
    })),
    http.put('http://127.0.0.1/api/secrets', async ({ request }) => {
      update = await request.json();
      return HttpResponse.json({
        wallhaven_saved: false,
        danbooru_saved: true,
        danbooru_username: 'alice',
        danbooru_user_id: '456',
      });
    }),
  );
  const { client } = renderSettings();

  expect(await screen.findByText(/Username: alice · User ID: 123 · API key: Saved/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Danbooru credentials' }));
  expect((screen.getByLabelText('Danbooru username') as HTMLInputElement).value).toBe('alice');
  expect((screen.getByLabelText('Danbooru numeric user ID (required for Danbooru API requests)') as HTMLInputElement).value).toBe('123');
  expect((screen.getByLabelText('Danbooru API key') as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Danbooru numeric user ID (required for Danbooru API requests)'), {
    target: { value: '456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save API credentials' }));
  await waitFor(() => expect(update).toEqual({
    danbooru_username: 'alice',
    danbooru_user_id: '456',
  }));
  client.clear();
});
