import { getJson, sendJson } from '../../lib/api-client';
import { fileActionResponseSchema } from '../files/schemas';
import {
  createFolderRequestSchema,
  createFolderResponseSchema,
  folderChangeBodySchema,
  folderChangePreviewSchema,
  gapFillPreviewSchema,
  gapFillRequestSchema,
  libraryFoldersSchema,
  libraryImagesSchema,
  type FolderChangeRequest,
  type GapFillMode,
} from './schemas';

export const libraryFoldersQueryKey = ['folders'] as const;
export const libraryImagesQueryKey = (folder: string) => ['library-images', folder] as const;
export const gapFillPreviewQueryKey = (folder: string, mode: GapFillMode) => ['gap-fill', folder, mode] as const;

export function getLibraryFolders() {
  return getJson('/api/folders', libraryFoldersSchema);
}

export function getLibraryImages(folder: string) {
  const search = new URLSearchParams({ folder });
  return getJson(`/api/images?${search}`, libraryImagesSchema);
}

export function libraryImagesQueryOptions(folder: string) {
  return {
    queryKey: libraryImagesQueryKey(folder),
    queryFn: () => getLibraryImages(folder),
    staleTime: 10_000,
  };
}

export function createLibraryFolder(folder: string) {
  return sendJson('POST', '/api/folders', { folder }, createFolderRequestSchema, createFolderResponseSchema);
}

export function getFolderChangePreview(request: FolderChangeRequest) {
  const { kind, ...params } = request;
  const search = new URLSearchParams(params);
  return getJson(`/api/folder-${kind}?${search}`, folderChangePreviewSchema);
}

export function applyFolderChange(request: FolderChangeRequest) {
  const { kind, ...body } = request;
  const method = kind === 'prefix' ? 'PUT' : 'POST';
  return sendJson(method, `/api/folder-${kind}`, body, folderChangeBodySchema, fileActionResponseSchema);
}

export function getGapFillPreview(folder: string, mode: GapFillMode) {
  const search = new URLSearchParams({ folder, mode });
  return getJson(`/api/gap-fill?${search}`, gapFillPreviewSchema);
}

export function fillLibraryGaps(folder: string, mode: GapFillMode) {
  return sendJson('POST', '/api/gap-fill', { folder, mode }, gapFillRequestSchema, fileActionResponseSchema);
}
