import { z } from 'zod';

const idSchema = z.number().int().nonnegative();

export const duplicateSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number().nonnegative(),
  hash: z.string().nullable(),
  duplicate_of: z.string().nullable(),
}).passthrough();

export const duplicatesSchema = z.array(duplicateSchema);

export const duplicateFoldersSchema = z.array(z.object({
  path: z.string(),
}).passthrough());

export const deleteDuplicatesRequestSchema = z.object({
  paths: z.array(z.string()).min(1),
}).strict();

export const restoreDuplicateRequestSchema = z.object({
  paths: z.array(z.string()).min(1),
  folder: z.string().min(1),
}).strict();

export const emptyDuplicatesRequestSchema = z.object({}).strict();

export const duplicateMutationResponseSchema = z.object({
  batch: idSchema.nullable(),
  done: z.array(z.object({
    id: idSchema,
    kind: z.string(),
    from: z.string(),
    to: z.string(),
    note: z.string(),
  }).passthrough()),
}).passthrough();

export type DuplicateItem = z.infer<typeof duplicateSchema>;
export type DeleteDuplicatesRequest = z.infer<typeof deleteDuplicatesRequestSchema>;
export type RestoreDuplicateRequest = z.infer<typeof restoreDuplicateRequestSchema>;
