import { getJson } from '../../lib/api-client';
import { statusSchema } from './schemas';

export const statusQueryKey = ['status'] as const;

export function getStatus() {
  return getJson('/api/status', statusSchema);
}
