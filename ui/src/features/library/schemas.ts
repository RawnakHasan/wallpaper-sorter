import { z } from 'zod';
import { resortPreviewSchema } from '../resort/schemas';

const sourceSchema = z.object({
  site: z.string(),
  id: z.string(),
  url: z.string(),
  page: z.number().int().nonnegative().nullable(),
  artist: z.string().nullable(),
  artist_id: z.string().nullable(),
}).passthrough();

const originSchema = z.object({
  hash: z.string(),
  path: z.string(),
  original_name: z.string(),
  sources: z.array(sourceSchema),
  added: z.number().nonnegative(),
  note: z.string(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
}).passthrough();

export const libraryFoldersSchema = z.array(z.object({
  path: z.string(),
  name: z.string(),
  prefix: z.string(),
  count: z.number().int().nonnegative(),
  next_number: z.number().int().nonnegative(),
  gaps: z.array(z.number().int().nonnegative()),
}).passthrough());

export const libraryImagesSchema = z.array(z.object({
  name: z.string(),
  path: z.string(),
  number: z.number().int().nonnegative().nullable(),
  size: z.number().nonnegative(),
  hash: z.string().nullable(),
  origin: originSchema.nullable(),
}).passthrough());

export const createFolderRequestSchema = z.object({
  folder: z.string().min(1),
}).strict();

export const createFolderResponseSchema = z.object({
  folder: z.string(),
}).passthrough();

export const folderChangeRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prefix'),
    folder: z.string().min(1),
    prefix: z.string(),
  }).strict(),
  z.object({
    kind: z.enum(['rename', 'merge']),
    from: z.string().min(1),
    to: z.string().min(1),
  }).strict(),
]);

export const folderChangeBodySchema = z.union([
  z.object({
    folder: z.string().min(1),
    prefix: z.string(),
  }).strict(),
  z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }).strict(),
]);

export const folderChangePreviewSchema = resortPreviewSchema;

export const gapFillPreviewSchema = z.array(z.object({
  from: z.string(),
  to: z.string(),
}).passthrough());

export const gapFillRequestSchema = z.object({
  folder: z.string().min(1),
  mode: z.enum(['last', 'renumber']),
}).strict();

export type LibraryFolder = z.infer<typeof libraryFoldersSchema>[number];
export type LibraryImage = z.infer<typeof libraryImagesSchema>[number];
export type FolderChangeRequest = z.infer<typeof folderChangeRequestSchema>;
export type FolderChangePreview = z.infer<typeof folderChangePreviewSchema>;
export type GapFillMode = z.infer<typeof gapFillRequestSchema>['mode'];
