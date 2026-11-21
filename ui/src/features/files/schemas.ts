import { z } from 'zod';

const idSchema = z.number().int().nonnegative();

export const assignFilesRequestSchema = z.object({
  paths: z.array(z.string()).min(1),
  folder: z.string().min(1),
  tag: z.object({
    keywords: z.array(z.string()).min(1),
    dest: z.string().min(1),
    prefix: z.string().nullable().optional(),
    match: z.enum(['word', 'substring']).optional(),
    strict_words: z.array(z.string()).optional(),
    generic: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export const deleteFilesRequestSchema = z.object({
  paths: z.array(z.string()).min(1),
}).strict();

export const fileActionResponseSchema = z.object({
  batch: idSchema.nullable(),
  done: z.array(z.object({
    id: idSchema,
    kind: z.string(),
    from: z.string(),
    to: z.string(),
  }).passthrough()),
  error: z.string().nullable(),
}).passthrough();

export type AssignFilesRequest = z.infer<typeof assignFilesRequestSchema>;
export type FileActionResponse = z.infer<typeof fileActionResponseSchema>;
