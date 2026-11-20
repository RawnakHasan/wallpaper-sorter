import { createFileRoute } from '@tanstack/react-router';
import { DuplicatesPage } from '../../legacy-app';

export const Route = createFileRoute('/duplicates')({
  component: DuplicatesPage,
});
