import { createFileRoute } from '@tanstack/react-router';
import { ActivityPage } from '../../legacy-app';

export const Route = createFileRoute('/activity')({
  component: ActivityPage,
});
