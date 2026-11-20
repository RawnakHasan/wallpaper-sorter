import { z } from 'zod';

const indexSchema = z.number().int().nonnegative();

export const tagSchema = z.object({
  index: indexSchema,
  keywords: z.array(z.string()),
  dest: z.string(),
  prefix: z.string().nullable(),
  match: z.enum(['word', 'substring']),
  strict_words: z.array(z.string()),
  generic: z.boolean(),
  effective_prefix: z.string(),
}).passthrough();

export const tagsSchema = z.array(tagSchema);

export const tagFoldersSchema = z.array(z.object({
  path: z.string(),
}).passthrough());

export const tagRequestSchema = z.object({
  keywords: z.array(z.string()),
  dest: z.string(),
  prefix: z.string().nullable(),
  match: z.enum(['word', 'substring']),
  strict_words: z.array(z.string()),
  generic: z.boolean(),
  expected_keywords: z.array(z.string()).optional(),
  expected_dest: z.string().optional(),
}).strict();

export const deleteTagRequestSchema = z.object({
  expected_keywords: z.array(z.string()),
  expected_dest: z.string(),
}).strict();

export const tagTestRequestSchema = z.object({
  filename: z.string().min(1),
}).strict();

export const tagTestResultSchema = z.object({
  words: z.array(z.string()),
  rule: z.string(),
  dest: z.string(),
  matched: z.array(z.string()),
  ignored: z.string().nullable(),
  new_name: z.string().nullable(),
}).passthrough();

export type Tag = z.infer<typeof tagSchema>;
export type TagRequest = z.infer<typeof tagRequestSchema>;
export type TagTestResult = z.infer<typeof tagTestResultSchema>;
