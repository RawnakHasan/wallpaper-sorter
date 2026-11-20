import { z } from 'zod';
import { originSourceSchema, siteSchema } from '../data/schemas';

const idSchema = z.number().int().nonnegative();
const inboxOriginSourceSchema = originSourceSchema.extend({
  site: z.union([siteSchema, z.literal('YandeRe')]),
});

export const inboxOriginSchema = z.object({
  hash: z.string(),
  path: z.string(),
  original_name: z.string(),
  sources: z.array(inboxOriginSourceSchema),
  added: z.number().nonnegative(),
  note: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
}).passthrough();

export const inboxItemSchema = z.object({
  path: z.string(),
  name: z.string(),
  reason: z.enum(['no_match', 'conflict', 'ready']),
  matched: z.array(z.string()),
  intake: z.string(),
  size: z.number().nonnegative(),
  modified: z.number().nonnegative(),
  origin: inboxOriginSchema.nullable(),
}).passthrough();

export const inboxSchema = z.array(inboxItemSchema);

export const assignFoldersSchema = z.array(z.object({
  path: z.string(),
  name: z.string(),
  prefix: z.string(),
  count: z.number().int().nonnegative(),
  next_number: z.number().int().nonnegative(),
  gaps: z.array(z.number().int().nonnegative()),
}).passthrough());

export const assignRequestSchema = z.object({
  paths: z.array(z.string()).min(1),
  folder: z.string().min(1),
  tag: z.object({
    keywords: z.array(z.string()).min(1),
    dest: z.string().min(1),
  }).strict().optional(),
}).strict();

export const deleteInboxRequestSchema = z.object({
  paths: z.array(z.string()).min(1),
}).strict();

export const inboxActionResponseSchema = z.object({
  batch: idSchema.nullable(),
  done: z.array(z.object({
    kind: z.string(),
    from: z.string(),
    to: z.string(),
  }).passthrough()),
  error: z.string().nullable(),
}).passthrough();

export const thumbnailRefreshResponseSchema = z.object({
  refreshed: z.boolean(),
}).passthrough();

export type InboxItem = z.infer<typeof inboxItemSchema>;
export type AssignFolder = z.infer<typeof assignFoldersSchema>[number];
export type AssignRequest = z.infer<typeof assignRequestSchema>;
export type InboxActionResponse = z.infer<typeof inboxActionResponseSchema>;
