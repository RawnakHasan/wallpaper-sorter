import { getJson } from '../../lib/api-client';
import {
  assignFoldersSchema,
  inboxSchema,
} from './schemas';

export const inboxQueryKey = ['inbox'] as const;
export const assignFoldersQueryKey = ['inbox', 'assign-folders'] as const;

export function getInbox() {
  return getJson('/api/inbox', inboxSchema);
}

export function getAssignFolders() {
  return getJson('/api/folders', assignFoldersSchema);
}
