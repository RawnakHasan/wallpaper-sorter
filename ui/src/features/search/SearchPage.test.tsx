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
          tags: ['anime girls', 'beach'],
          preview: `/api/search/preview/${'a'.repeat(64)}`,
        }],
      });
    }),
  );
  const { client } = renderSearch();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Tags or search terms' }), {
    target: { value: 'anime girls' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('anime girls')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Wallhaven post abc123' }).getAttribute('src'))
    .toBe(`/api/search/preview/${'a'.repeat(64)}`);
  expect(screen.getByRole('link', { name: 'Open post' }).getAttribute('href'))
    .toBe('https://wallhaven.cc/w/abc123');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(pages).toEqual(['1', '2']));
  client.clear();
});
