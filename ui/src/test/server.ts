import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

export const server = setupServer(
  http.get('http://127.0.0.1/api/status', () => HttpResponse.json({ status: 'ready' })),
);
