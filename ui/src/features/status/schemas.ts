import { z } from 'zod';

const countSchema = z.number().int().nonnegative();

export const settingsSchema = z.object({
  gap_mode: z.enum(['keep', 'lowest', 'last', 'renumber']),
  image_extensions: z.array(z.string()),
  duplicates_folder: z.string(),
  generic_max_words: countSchema,
}).passthrough();

export const statusSchema = z.object({
  version: z.string(),
  library: z.string(),
  config_file: z.string(),
  activity_last_id: countSchema,
  intake: z.array(z.object({
    index: countSchema,
    path: z.string(),
    exists: z.boolean(),
    recursive: z.boolean(),
    remove_empty_folders: z.boolean(),
    watching: z.boolean(),
    error: z.string().nullable(),
  }).passthrough()),
  counts: z.object({
    library_images: countSchema,
    inbox: countSchema,
    duplicates: countSchema,
    records: countSchema,
  }).passthrough(),
  settings: settingsSchema,
  setup_complete: z.boolean(),
}).passthrough();

export type Status = z.infer<typeof statusSchema>;
