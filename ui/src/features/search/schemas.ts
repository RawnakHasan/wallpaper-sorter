import { z } from 'zod';

export const searchSiteSchema = z.enum(['Wallhaven', 'Danbooru', 'yande.re', 'Safebooru']);

export const searchResultsSchema = z.object({
  site: searchSiteSchema,
  page: z.number().int().min(1),
  has_more: z.boolean(),
  items: z.array(z.object({
    id: z.string(),
    url: z.string().url(),
    rating: z.string(),
    tags: z.array(z.string()),
    preview: z.string().regex(/^\/api\/search\/preview\/[a-f0-9]{64}$/),
  }).strict()),
}).strict();

export type SearchSite = z.infer<typeof searchSiteSchema>;
export type SearchResults = z.infer<typeof searchResultsSchema>;
