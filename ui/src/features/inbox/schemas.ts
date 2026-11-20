import { z } from 'zod';
import { originSourceSchema, siteSchema } from '../data/schemas';

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

export type InboxItem = z.infer<typeof inboxItemSchema>;
export type AssignFolder = z.infer<typeof assignFoldersSchema>[number];
