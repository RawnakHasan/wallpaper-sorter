import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import { server } from '../../test/server';

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/search'] }),
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

it('searches and browses paged results with daemon-served previews', async () => {
  const pages: string[] = [];
  let downloadRequest: unknown;
  const completedJob = {
    id: 3,
    done: true,
    items: [{
      input: 'abc123',
      site: 'Wallhaven',
      id: 'abc123',
      state: 'inbox',
      location: 'wallhaven-abc123.jpg',
      message: null,
      character_suggestions: [],
    }],
  };
  server.use(
    http.get('http://127.0.0.1/api/search', ({ request }) => {
      const url = new URL(request.url);
      pages.push(url.searchParams.get('page') ?? '');
      return HttpResponse.json({
        site: 'Wallhaven',
        page: Number(url.searchParams.get('page')),
        has_more: true,
        items: [{
          id: 'abc123',
          url: 'https://wallhaven.cc/w/abc123',
          rating: 'sfw',
          tags: [],
          preview: `/api/search/preview/${'a'.repeat(64)}`,
          image_url: 'https://w.wallhaven.cc/full/94/wallhaven-abc123.jpg',
        }],
      });
    }),
    http.get('http://127.0.0.1/api/search/details', () => HttpResponse.json({
      tags: ['anime girls', 'beach', 'sky'],
    })),
    http.post('http://127.0.0.1/api/fetch', async ({ request }) => {
      downloadRequest = await request.json();
      return HttpResponse.json({
        id: 3,
        done: false,
        items: [{
          input: 'abc123',
          site: 'Wallhaven',
          id: 'abc123',
          state: 'queued',
          location: null,
          message: null,
          character_suggestions: [],
        }],
      });
    }),
    http.get('http://127.0.0.1/api/fetch/3', () => HttpResponse.json(completedJob)),
  );
  const { client } = renderSearch();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Tags or search terms' }), {
    target: { value: 'anime girls' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('Open the image to load its tags')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Wallhaven post abc123' }).getAttribute('src'))
    .toBe(`/api/search/preview/${'a'.repeat(64)}`);
  expect(screen.getByRole('link', { name: 'Open post' }).getAttribute('href'))
    .toBe('https://wallhaven.cc/w/abc123');
  expect(screen.getByRole('option', { name: 'Konachan.net' })).toBeTruthy();
  expect(screen.getByRole('option', { name: /Zerochan.*not approved/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(pages).toEqual(['1', '2']));
  fireEvent.click(screen.getByRole('button', { name: 'View image and tags' }));
  expect(await screen.findByText('anime girls')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open full-size image' }).getAttribute('href'))
    .toBe('https://w.wallhaven.cc/full/94/wallhaven-abc123.jpg');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download' }));
  await waitFor(() => expect(downloadRequest).toEqual({
    items: [{ site: 'Wallhaven', input: 'abc123' }],
  }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Download' })).toBeTruthy());
  client.clear();
});

it('re-enables Download and reports an error when the job cannot be polled', async () => {
  let fetchJobRequests = 0;
  server.use(
    http.get('http://127.0.0.1/api/search', () => HttpResponse.json({
      site: 'Wallhaven',
      page: 1,
      has_more: false,
      items: [{
        id: 'abc123',
        url: 'https://wallhaven.cc/w/abc123',
        rating: 'sfw',
        tags: [],
        preview: `/api/search/preview/${'a'.repeat(64)}`,
        image_url: null,
      }],
    })),
    http.post('http://127.0.0.1/api/fetch', () => HttpResponse.json({
      id: 4,
      done: false,
      items: [{
        input: 'abc123',
        site: 'Wallhaven',
        id: 'abc123',
        state: 'queued',
        location: null,
        message: null,
        character_suggestions: [],
      }],
    })),
    http.get('http://127.0.0.1/api/fetch/4', () => {
      fetchJobRequests += 1;
      return HttpResponse.json({ error: 'Job lookup failed' }, { status: 500 });
    }),
  );
  const { client } = renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Search' }));
  const downloadButton = await screen.findByRole('button', { name: 'Download' });
  fireEvent.click(downloadButton);

  await waitFor(() => expect(fetchJobRequests).toBeGreaterThan(0));
  await waitFor(() => expect(downloadButton.hasAttribute('disabled')).toBe(false));
  client.clear();
});
