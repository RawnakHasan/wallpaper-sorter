import { z } from 'zod';

const countSchema = z.number().int().nonnegative();

export const settingsSchema = z.object({
  gap_mode: z.enum(['keep', 'lowest', 'last', 'renumber']),
  image_extensions: z.array(z.string()),
  duplicates_folder: z.string(),
  generic_max_words: countSchema,
  danbooru_rating: z.enum(['g', 's', 'q', 'e']).default('g'),
  wallhaven_purity: z.enum(['sfw', 'sketchy', 'nsfw']).default('sfw'),
  yandere_rating: z.enum(['s', 'q', 'e']).default('s'),
  safebooru_rating: z.enum(['general', 'safe', 'questionable', 'explicit']).default('general'),
  konachan_rating: z.enum(['s', 'q', 'e']).default('s'),
  zerochan_username_saved: z.boolean().default(false),
  zerochan_username: z.string().default(''),
  warn_before_unrated_sites: z.boolean().default(true),
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
