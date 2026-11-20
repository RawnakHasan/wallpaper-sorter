import { createFileRoute } from '@tanstack/react-router';
import { ResortPage } from '../features/resort/ResortPage';

export const Route = createFileRoute('/resort')({
  component: ResortPage,
});
