import { createRootRoute } from '@tanstack/react-router';
import { AppShell } from '../components/AppShell';

export const Route = createRootRoute({
  component: AppShell,
  notFoundComponent: () => (
    <div className="stub">
      <h1>That page does not exist</h1>
      <p className="sub">Unknown hash routes stay out of the app.</p>
    </div>
  ),
});
