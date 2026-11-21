import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const server = setupServer(
  http.get('http://127.0.0.1/api/status', () => HttpResponse.json({ status: 'ready' })),
  http.get('http://127.0.0.1/api/secrets', () => HttpResponse.json({
    wallhaven_saved: false,
    danbooru_saved: false,
  })),
);
