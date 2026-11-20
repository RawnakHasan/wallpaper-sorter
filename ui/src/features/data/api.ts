import { getJson, sendJson } from '../../lib/api-client';
import {
  dataResponseSchema,
  saveOriginRequestSchema,
  saveOriginResponseSchema,
  type Site,
} from './schemas';

export interface DataFilters {
  q: string;
  site: Site | '';
  folder: string;
  unknown: boolean;
  offset: number;
}

export const dataQueryKey = (filters: DataFilters, limit: number) => ['data', filters, limit] as const;
export const unknownCountQueryKey = ['data', 'unknown-count'] as const;

export function getData(filters: DataFilters, limit: number) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(filters.offset),
  });
  if (filters.q) params.set('q', filters.q);
  if (filters.site) params.set('site', filters.site);
  if (filters.folder) params.set('folder', filters.folder);
  if (filters.unknown) params.set('unknown', '1');
  return getJson(`/api/data?${params}`, dataResponseSchema);
}

export function saveOrigin(body: { hash: string; site: Site; id: string }) {
  return sendJson('PUT', '/api/origins', body, saveOriginRequestSchema, saveOriginResponseSchema);
}
