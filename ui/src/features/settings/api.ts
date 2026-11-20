import { z } from 'zod';
import { requestJson, sendJson } from '../../lib/api-client';

const intakeRequestSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean(),
  remove_empty_folders: z.boolean(),
}).strict();

const emptyRequestSchema = z.object({}).strict();

const intakeResponseSchema = z.object({
  intake: z.array(z.object({
    path: z.string(),
    recursive: z.boolean(),
    remove_empty_folders: z.boolean(),
  }).passthrough()),
}).passthrough();

const emptyTrashResponseSchema = z.object({
  removed: z.number().int().nonnegative(),
}).passthrough();

export interface IntakeRequest {
  path: string;
  recursive: boolean;
  remove_empty_folders: boolean;
}

export function saveIntake(index: number | null, body: IntakeRequest) {
  const method = index === null ? 'POST' : 'PUT';
  const path = index === null ? '/api/intake' : `/api/intake/${index}`;
  return sendJson(method, path, body, intakeRequestSchema, intakeResponseSchema);
}

export function removeIntake(index: number) {
  return requestJson('/api/intake/' + index, {
    method: 'DELETE',
    body: {},
    requestSchema: emptyRequestSchema,
    responseSchema: intakeResponseSchema,
  });
}

export function emptyTrash() {
  return sendJson('POST', '/api/trash/empty', {}, emptyRequestSchema, emptyTrashResponseSchema);
}
