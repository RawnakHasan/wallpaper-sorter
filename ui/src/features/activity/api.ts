import { getJson, sendJson } from '../../lib/api-client';
import { activitySchema, undoRequestSchema, undoResponseSchema, type UndoRequest } from './schemas';

export const activityQueryKey = (limit: number) => ['activity', limit] as const;

export function getActivity(limit: number) {
  const search = new URLSearchParams({ limit: String(limit) });
  return getJson(`/api/activity?${search}`, activitySchema);
}

export function undoActivity(request: UndoRequest) {
  return sendJson('POST', '/api/undo', request, undoRequestSchema, undoResponseSchema);
}
