import { z } from 'zod';
import { getJson, sendJson } from '../../lib/api-client';
import {
  assignFoldersSchema,
  assignRequestSchema,
  deleteInboxRequestSchema,
  inboxActionResponseSchema,
  inboxSchema,
  thumbnailRefreshResponseSchema,
  type AssignRequest,
} from './schemas';

export const inboxQueryKey = ['inbox'] as const;
export const assignFoldersQueryKey = ['inbox', 'assign-folders'] as const;

export function getInbox() {
  return getJson('/api/inbox', inboxSchema);
}

export function getAssignFolders() {
  return getJson('/api/folders', assignFoldersSchema);
}

export function assignInboxItems(request: AssignRequest) {
  return sendJson('POST', '/api/assign', request, assignRequestSchema, inboxActionResponseSchema);
}

export function deleteInboxItems(paths: string[]) {
  return sendJson('POST', '/api/delete', { paths }, deleteInboxRequestSchema, inboxActionResponseSchema);
}

export function refreshThumbnail(hash: string) {
  return sendJson(
    'POST',
    `/api/thumb/${hash}/refresh`,
    {},
    z.object({}).strict(),
    thumbnailRefreshResponseSchema,
  );
}
