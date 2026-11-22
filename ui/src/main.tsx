import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import '@fontsource-variable/google-sans-flex';
import '@fontsource-variable/geist-mono';
import { queryClient } from './lib/query-client';
import { router } from './router';
import '../app.css';
import '../prototype.css';

const app = createRoot(document.getElementById('app')!);
app.render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) app.unmount();
}, { once: true });
