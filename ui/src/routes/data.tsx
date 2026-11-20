import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { LegacyPage } from '../../legacy-app';

const searchSchema = z.object({
  q: z.string().optional(),
});

export const Route = createFileRoute('/data')({
  validateSearch: (search) => searchSchema.parse(search),
  component: () => <LegacyPage name="data" />,
});
