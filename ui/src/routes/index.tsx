import { createFileRoute } from '@tanstack/react-router';
import { OverviewPage } from '../../legacy-app';

export const Route = createFileRoute('/')({
  component: OverviewPage,
});
