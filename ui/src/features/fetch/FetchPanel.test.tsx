import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { FetchPanel } from './components/FetchPanel';
import { server } from '../../test/server';

it('submits one entry per line and reports each returned result', async () => {
  let submitted: unknown;
  server.use(
    http.post('http://127.0.0.1/api/fetch', async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({
        id: 17,
        done: false,
        items: [{
          input: 'abc123',
          site: 'Wallhaven',
          id: 'abc123',
          state: 'queued',
          location: null,
          message: null,
        }],
      }, { status: 202 });
    }),
    http.get('http://127.0.0.1/api/fetch/17', () => HttpResponse.json({
      id: 17,
      done: true,
      items: [
        {
          input: 'abc123',
          site: 'Wallhaven',
          id: 'abc123',
          state: 'sorted',
          location: 'Chisa/Chisa 1.png',
          message: 'sorted into Chisa/Chisa 1.png',
        },
        {
          input: 'https://danbooru.donmai.us/posts/123456',
          site: 'Danbooru',
          id: '123456',
          state: 'inbox',
          location: 'danbooru-123456.png',
          message: 'left in the Inbox (no match)',
        },
      ],
    })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FetchPanel />
    </QueryClientProvider>,
  );

  fireEvent.change(screen.getByRole('textbox', { name: 'Post IDs or links' }), {
    target: { value: 'abc123\nhttps://danbooru.donmai.us/posts/123456' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));

  await waitFor(() => expect(submitted).toEqual({
    items: [
      { site: 'Wallhaven', input: 'abc123' },
      { site: 'Wallhaven', input: 'https://danbooru.donmai.us/posts/123456' },
    ],
  }));
  expect(await screen.findByText('sorted into Chisa/Chisa 1.png')).toBeTruthy();
  expect(screen.getByText('left in the Inbox (no match)')).toBeTruthy();
  client.clear();
});

it('allows bare IDs from yande.re and Safebooru', async () => {
  let submitted: unknown;
  server.use(
    http.post('http://127.0.0.1/api/fetch', async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({
        id: 18,
        done: false,
        items: [],
      }, { status: 202 });
    }),
    http.get('http://127.0.0.1/api/fetch/18', () => HttpResponse.json({
      id: 18,
      done: true,
      items: [{
        input: '7132423',
        site: 'Safebooru',
        id: '7132423',
        state: 'inbox',
        location: 'safebooru-7132423.png',
        message: 'left in the Inbox (no match)',
      }],
    })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FetchPanel />
    </QueryClientProvider>,
  );

  fireEvent.change(screen.getByRole('combobox', { name: 'Site for bare IDs' }), {
    target: { value: 'Safebooru' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Post IDs or links' }), {
    target: { value: '7132423' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));

  await waitFor(() => expect(submitted).toEqual({
    items: [{ site: 'Safebooru', input: '7132423' }],
  }));
  expect(await screen.findByText('left in the Inbox (no match)')).toBeTruthy();
  client.clear();
});

it('offers a tag for a new Danbooru character and sorts the fetched image into it', async () => {
  let assignRequest: unknown;
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
      danbooru_rating: 'g',
      wallhaven_purity: 'sfw',
    },
    setup_complete: true,
  };
  server.use(
    http.post('http://127.0.0.1/api/fetch', () => HttpResponse.json({
      id: 41,
      done: false,
      items: [],
    }, { status: 202 })),
    http.get('http://127.0.0.1/api/fetch/41', () => HttpResponse.json({
      id: 41,
      done: true,
      items: [{
        input: '12593346',
        site: 'Danbooru',
        id: '12593346',
        state: 'sorted',
        location: 'Wuthering-Waves/Wuthering Waves 4.png',
        message: 'sorted into Wuthering-Waves/Wuthering Waves 4.png',
        character_suggestions: [
          { keyword: 'chisa', series: 'wuthering waves' },
          { keyword: 'lucielle', series: 'wuthering waves' },
        ],
      }],
    })),
    http.get('http://127.0.0.1/api/tags', () => HttpResponse.json([
      {
        index: 0,
        keywords: ['wuthering waves'],
        dest: 'Wuthering-Waves',
        prefix: null,
        match: 'word',
        strict_words: [],
        generic: false,
        effective_prefix: 'Wuthering Waves',
      },
      {
        index: 1,
        keywords: ['chisa'],
        dest: 'Wuthering-Waves/Chisa',
        prefix: null,
        match: 'word',
        strict_words: [],
        generic: false,
        effective_prefix: 'Chisa',
      },
    ])),
    http.get('http://127.0.0.1/api/folders', () => HttpResponse.json([{ path: 'Wuthering-Waves' }])),
    http.get('http://127.0.0.1/api/status', () => HttpResponse.json(status)),
    http.post('http://127.0.0.1/api/assign', async ({ request }) => {
      assignRequest = await request.json();
      return HttpResponse.json({
        batch: 9,
        done: [{
          id: 5,
          kind: 'move',
          from: 'Wuthering-Waves/Wuthering Waves 4.png',
          to: 'Wuthering-Waves/Lucielle/Lucielle 1.png',
        }],
        error: null,
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FetchPanel />
    </QueryClientProvider>,
  );

  fireEvent.change(screen.getByRole('textbox', { name: 'Post IDs or links' }), {
    target: { value: '12593346' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch' }));

  expect(await screen.findByRole('button', { name: 'Create tag' })).toBeTruthy();
  expect(screen.getByText('lucielle').textContent).toBe('lucielle');
  expect(screen.queryByText('New character found: chisa')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create tag' }));
  const folder = await screen.findByRole('textbox', { name: 'Folder' });
  expect((folder as HTMLInputElement).value).toBe('Wuthering-Waves/Lucielle');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(assignRequest).toEqual({
    paths: ['Wuthering-Waves/Wuthering Waves 4.png'],
    folder: 'Wuthering-Waves/Lucielle',
    tag: {
      keywords: ['lucielle'],
      dest: 'Wuthering-Waves/Lucielle',
      prefix: null,
      match: 'word',
      strict_words: [],
      generic: false,
    },
  }));
  expect(await screen.findByText('sorted into Wuthering-Waves/Wuthering Waves 4.png')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create tag' })).toBeNull();
  client.clear();
});
