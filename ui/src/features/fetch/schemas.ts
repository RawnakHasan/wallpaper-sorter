import { z } from 'zod';

export const fetchSubmitRequestSchema = z.object({
  items: z.array(z.object({
    site: z.enum(['Wallhaven', 'Danbooru']).optional(),
    input: z.string().max(2048),
  }).strict()).min(1).max(100),
}).strict();

export const fetchJobSchema = z.object({
  id: z.number().int().positive(),
  done: z.boolean(),
  items: z.array(z.object({
    input: z.string(),
    site: z.string().nullable(),
    id: z.string().nullable(),
    state: z.enum(['queued', 'downloading', 'sorted', 'inbox', 'duplicate', 'error']),
    location: z.string().nullable(),
    message: z.string().nullable(),
  }).strict()),
}).strict();

export const secretsStatusSchema = z.object({
  wallhaven_saved: z.boolean(),
  danbooru_saved: z.boolean(),
}).strict();

export const secretsUpdateSchema = z.object({
  wallhaven_api_key: z.string().optional(),
  danbooru_username: z.string().optional(),
  danbooru_api_key: z.string().optional(),
  danbooru_user_id: z.string().optional(),
  clear_wallhaven: z.boolean().optional(),
  clear_danbooru: z.boolean().optional(),
}).strict();

export type FetchJob = z.infer<typeof fetchJobSchema>;
export type FetchRequest = z.infer<typeof fetchSubmitRequestSchema>;
export type SecretsStatus = z.infer<typeof secretsStatusSchema>;
export type SecretsUpdate = z.infer<typeof secretsUpdateSchema>;
