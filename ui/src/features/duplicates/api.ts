import { getJson, sendJson } from '../../lib/api-client';
import {
  duplicateFoldersSchema,
  duplicatesSchema,
  emptyDuplicatesRequestSchema,
  duplicateMutationResponseSchema,
  deleteDuplicatesRequestSchema,
  restoreDuplicateRequestSchema,
  type DeleteDuplicatesRequest,
  type RestoreDuplicateRequest,
} from './schemas';

export const duplicatesQueryKey = ['duplicates'] as const;
export const duplicateFoldersQueryKey = ['folders'] as const;

export function getDuplicates() {
  return getJson('/api/duplicates', duplicatesSchema);
}

export function getDuplicateFolders() {
  return getJson('/api/folders', duplicateFoldersSchema);
}

export function deleteDuplicates(body: DeleteDuplicatesRequest) {
  return sendJson('POST', '/api/delete', body, deleteDuplicatesRequestSchema, duplicateMutationResponseSchema);
}

export function restoreDuplicate(body: RestoreDuplicateRequest) {
  return sendJson('POST', '/api/duplicates/restore', body, restoreDuplicateRequestSchema, duplicateMutationResponseSchema);
}

export function emptyDuplicates() {
  return sendJson('POST', '/api/duplicates/empty', {}, emptyDuplicatesRequestSchema, duplicateMutationResponseSchema);
}
