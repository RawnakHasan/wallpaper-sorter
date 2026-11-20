import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { LegacyPage } from '../../legacy-app';

const searchSchema = z.object({
  folder: z.string().optional(),
});

export const Route = createFileRoute('/library')({
  validateSearch: (search) => searchSchema.parse(search),
  component: () => <LegacyPage name="library" />,
});
