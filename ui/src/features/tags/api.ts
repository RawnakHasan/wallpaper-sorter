import { getJson, sendJson } from '../../lib/api-client';
import {
  deleteTagRequestSchema,
  tagFoldersSchema,
  tagRequestSchema,
  tagsSchema,
  tagTestRequestSchema,
  tagTestResultSchema,
  type TagRequest,
} from './schemas';

export const tagsQueryKey = ['tags'] as const;
export const tagFoldersQueryKey = ['folders'] as const;

export function getTags() {
  return getJson('/api/tags', tagsSchema);
}

export function getTagFolders() {
  return getJson('/api/folders', tagFoldersSchema);
}

export function testTagName(filename: string) {
  return sendJson('POST', '/api/tags/test', { filename }, tagTestRequestSchema, tagTestResultSchema);
}

export function saveTag(index: number | null, body: TagRequest) {
  const method = index === null ? 'POST' : 'PUT';
  const path = index === null ? '/api/tags' : `/api/tags/${index}`;
  return sendJson(method, path, body, tagRequestSchema, tagsSchema);
}

export function deleteTag(index: number, expectedKeywords: string[], expectedDestination: string) {
  return sendJson(
    'DELETE',
    `/api/tags/${index}`,
    { expected_keywords: expectedKeywords, expected_dest: expectedDestination },
    deleteTagRequestSchema,
    tagsSchema,
  );
}
