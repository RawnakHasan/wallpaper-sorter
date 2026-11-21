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
