import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { Thumb } from './Thumb';

it('retries busy thumbnail responses and swaps in the fetched image', async () => {
  let requests = 0;
  server.use(http.get('http://127.0.0.1/api/thumb/hash', () => {
    requests += 1;
    return requests === 1
      ? new HttpResponse(null, { status: 503, headers: { 'Retry-After': '0' } })
      : new HttpResponse(new Blob([new Uint8Array([1, 2, 3])]), { headers: { 'Content-Type': 'image/png' } });
  }));
  const createObjectURL = vi.fn(() => 'blob:thumbnail');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

  const view = render(<Thumb hash="hash" alt="wallpaper.png" />);
  const image = screen.getByAltText('wallpaper.png');
  fireEvent.error(image);

  await waitFor(() => expect((image as HTMLImageElement).src).toBe('blob:thumbnail'));
  expect(requests).toBe(2);
  fireEvent.load(image);
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail');
  view.unmount();
});

it('shows the file extension when the thumbnail is unavailable', async () => {
  server.use(http.get('http://127.0.0.1/api/thumb/missing', () => new HttpResponse(null, { status: 415 })));
  render(<Thumb hash="missing" alt="wallpaper.webp" />);
  fireEvent.error(screen.getByAltText('wallpaper.webp'));

  expect(await screen.findByText('WEBP')).toBeTruthy();
});
