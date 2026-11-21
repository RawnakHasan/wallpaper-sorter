import { z } from 'zod';
import { sendJson, getJson } from '../../lib/api-client';
import { settingsSchema, statusSchema } from './schemas';

export const statusQueryKey = ['status'] as const;

export const settingsUpdateSchema = z.object({
  gap_mode: z.enum(['keep', 'lowest', 'last', 'renumber']).optional(),
  setup_complete: z.boolean().optional(),
  danbooru_rating: z.enum(['g', 's', 'q', 'e']).optional(),
  wallhaven_purity: z.enum(['sfw', 'sketchy', 'nsfw']).optional(),
  yandere_rating: z.enum(['s', 'q', 'e']).optional(),
  safebooru_rating: z.enum(['general', 'safe', 'questionable', 'explicit']).optional(),
  konachan_rating: z.enum(['s', 'q', 'e']).optional(),
  zerochan_username: z.string().max(80).optional(),
  warn_before_unrated_sites: z.boolean().optional(),
  wallpaper_apply_script: z.string().max(4096).optional(),
  wallpaper_apply_args: z.array(z.string().max(4096)).max(64).optional(),
}).strict();

const rescanRequestSchema = z.object({}).strict();
const rescanResponseSchema = z.object({ ok: z.boolean() }).passthrough();

export function getStatus() {
  return getJson('/api/status', statusSchema);
}

export function requestRescan() {
  return sendJson('POST', '/api/rescan', {}, rescanRequestSchema, rescanResponseSchema);
}

export function updateSettings(body: z.infer<typeof settingsUpdateSchema>) {
  return sendJson('PUT', '/api/settings', body, settingsUpdateSchema, settingsSchema);
}
