import { z } from 'zod';

const previewItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('move'),
    from: z.string(),
    to: z.string(),
    rule: z.string(),
    matched: z.array(z.string()),
  }).passthrough(),
  z.object({
    kind: z.literal('rename'),
    from: z.string(),
    to: z.string(),
  }).passthrough(),
  z.object({
    kind: z.literal('duplicate'),
    from: z.string(),
    to: z.string(),
    duplicate_of: z.string(),
  }).passthrough(),
  z.object({
    kind: z.literal('leave'),
    path: z.string(),
    reason: z.string(),
  }).passthrough(),
  z.object({
    kind: z.literal('stay'),
    path: z.string(),
  }).passthrough(),
]);

export const resortFoldersSchema = z.array(z.object({
  path: z.string(),
}).passthrough());

export const resortPreviewSchema = z.object({
  items: z.array(previewItemSchema),
  changes: z.number().int().nonnegative(),
}).passthrough();

export const applyResortRequestSchema = z.object({
  folder: z.string().optional(),
}).strict();

export const applyResortResponseSchema = z.object({
  batch: z.number().int().nonnegative().nullable(),
  done: z.array(z.object({
    id: z.number().int().nonnegative(),
    kind: z.string(),
    from: z.string(),
    to: z.string(),
  }).passthrough()),
}).passthrough();

export type ResortPreview = z.infer<typeof resortPreviewSchema>;
export type ResortItem = z.infer<typeof previewItemSchema>;
export type ApplyResortRequest = z.infer<typeof applyResortRequestSchema>;
export type ApplyResortResponse = z.infer<typeof applyResortResponseSchema>;
