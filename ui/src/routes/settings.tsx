import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '../../legacy-app';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});
