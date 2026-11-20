import { z } from 'zod';
import { sendJson, getJson } from '../../lib/api-client';
import { settingsSchema, statusSchema } from './schemas';

export const statusQueryKey = ['status'] as const;

export const settingsUpdateSchema = z.object({
  gap_mode: z.enum(['keep', 'lowest', 'last', 'renumber']).optional(),
  setup_complete: z.boolean().optional(),
}).strict();

export function getStatus() {
  return getJson('/api/status', statusSchema);
}

export function updateSettings(body: z.infer<typeof settingsUpdateSchema>) {
  return sendJson('PUT', '/api/settings', body, settingsUpdateSchema, settingsSchema);
}
