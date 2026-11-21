import { getJson, sendJson } from '../../lib/api-client';
import {
  fetchJobSchema,
  fetchSubmitRequestSchema,
  secretsStatusSchema,
  secretsUpdateSchema,
  type FetchRequest,
  type SecretsUpdate,
} from './schemas';

export const fetchJobQueryKey = (id: number) => ['fetch-job', id] as const;
export const secretsQueryKey = ['secrets'] as const;

export function submitFetch(body: FetchRequest) {
  return sendJson('POST', '/api/fetch', body, fetchSubmitRequestSchema, fetchJobSchema);
}

export function getFetchJob(id: number) {
  return getJson(`/api/fetch/${id}`, fetchJobSchema);
}

export function getSecretsStatus() {
  return getJson('/api/secrets', secretsStatusSchema);
}

export function saveSecrets(body: SecretsUpdate) {
  return sendJson('PUT', '/api/secrets', body, secretsUpdateSchema, secretsStatusSchema);
}
