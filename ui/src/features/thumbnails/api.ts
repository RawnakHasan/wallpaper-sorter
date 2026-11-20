import { z } from 'zod';
import { sendJson } from '../../lib/api-client';

const emptyRequestSchema = z.object({}).strict();
const thumbnailRefreshResponseSchema = z.object({ refreshed: z.boolean() }).passthrough();

export function refreshThumbnail(hash: string) {
  return sendJson(
    'POST',
    `/api/thumb/${hash}/refresh`,
    {},
    emptyRequestSchema,
    thumbnailRefreshResponseSchema,
  );
}
