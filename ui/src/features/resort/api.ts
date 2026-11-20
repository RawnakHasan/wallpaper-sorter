import { getJson, sendJson } from '../../lib/api-client';
import {
  applyResortRequestSchema,
  applyResortResponseSchema,
  resortFoldersSchema,
  resortPreviewSchema,
  type ApplyResortRequest,
} from './schemas';

export const resortFoldersQueryKey = ['folders'] as const;
export const resortPreviewQueryKey = (folder: string) => ['resort-preview', folder] as const;

export function getResortFolders() {
  return getJson('/api/folders', resortFoldersSchema);
}

export function getResortPreview(folder: string) {
  const search = folder ? `?${new URLSearchParams({ folder })}` : '';
  return getJson(`/api/resort${search}`, resortPreviewSchema);
}

export function applyResort(request: ApplyResortRequest) {
  return sendJson('POST', '/api/resort', request, applyResortRequestSchema, applyResortResponseSchema);
}
