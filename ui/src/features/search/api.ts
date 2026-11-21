import { getJson } from '../../lib/api-client';
import { searchResultsSchema, type SearchSite } from './schemas';

export function searchPosts(site: SearchSite, query: string, page: number) {
  const params = new URLSearchParams({ site, q: query, page: String(page) });
  return getJson(`/api/search?${params}`, searchResultsSchema);
}
