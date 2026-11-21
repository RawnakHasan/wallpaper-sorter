import { z } from 'zod';

export const siteSchema = z.enum([
  'Wallhaven',
  'Zerochan',
  'Konachan',
  'yande.re',
  'Danbooru',
  'Safebooru',
  'Pixiv',
  'Unknown',
]);

export const originSourceSchema = z.object({
  site: siteSchema,
  id: z.string(),
  url: z.string().optional(),
  artist: z.string().nullable().optional(),
  artist_id: z.string().nullable().optional(),
}).passthrough();

export const originSchema = z.object({
  hash: z.string(),
  path: z.string(),
  folder: z.string(),
  name: z.string(),
  original_name: z.string(),
  sources: z.array(originSourceSchema),
  added: z.number().nonnegative(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  note: z.string(),
  tags: z.array(z.string()).default([]),
  rating: z.string().nullable().default(null),
}).passthrough();

export const dataResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  items: z.array(originSchema),
}).passthrough();

export const saveOriginRequestSchema = z.object({
  hash: z.string().min(1),
  site: siteSchema,
  id: z.string(),
}).strict();

export const saveOriginResponseSchema = z.object({
  ok: z.boolean(),
}).passthrough();

export const originLookupRequestSchema = z.object({
  hash: z.string().min(1),
  site: siteSchema,
  id: z.string().min(1),
}).strict();

export const originLookupResponseSchema = z.object({
  tags_updated: z.number().int().nonnegative(),
  sorted_to: z.string().nullable(),
  batch: z.number().int().nonnegative().nullable(),
}).passthrough();

export type Origin = z.infer<typeof originSchema>;
export type OriginSource = z.infer<typeof originSourceSchema>;
export type Site = z.infer<typeof siteSchema>;
export type OriginLookupRequest = z.infer<typeof originLookupRequestSchema>;
export type OriginLookupResponse = z.infer<typeof originLookupResponseSchema>;
