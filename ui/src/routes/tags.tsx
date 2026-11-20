import { createFileRoute } from '@tanstack/react-router';
import { LegacyPage } from '../../legacy-app';

export const Route = createFileRoute('/tags')({
  component: () => <LegacyPage name="tags" />,
});
