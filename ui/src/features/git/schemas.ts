import { z } from 'zod';

export const gitChangeSchema = z.object({
  path: z.string(),
  status: z.enum(['Added', 'Renamed', 'Deleted', 'Modified']),
  from: z.string().nullable(),
}).passthrough();

export const gitStatusSchema = z.object({
  repository: z.string(),
  branch: z.string(),
  remote: z.string(),
  up_to_date: z.boolean(),
  commits_to_push: z.number().int().nonnegative(),
  changes: z.array(gitChangeSchema),
}).passthrough();

export const gitCommitResponseSchema = z.object({
  hash: z.string(),
  message: z.string(),
  changed: z.number().int().nonnegative(),
}).passthrough();

export const gitPushResponseSchema = z.object({
  pushed: z.number().int().nonnegative(),
  remote: z.string(),
  branch: z.string(),
}).passthrough();

export const gitLogItemSchema = z.object({
  hash: z.string(),
  message: z.string(),
  date: z.number().int(),
  local: z.boolean(),
}).passthrough();

export const gitLogResponseSchema = z.object({
  items: z.array(gitLogItemSchema),
}).passthrough();

export type GitStatus = z.infer<typeof gitStatusSchema>;
export type GitLogItem = z.infer<typeof gitLogItemSchema>;
