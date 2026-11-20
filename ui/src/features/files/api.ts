import { sendJson } from '../../lib/api-client';
import {
  assignFilesRequestSchema,
  deleteFilesRequestSchema,
  fileActionResponseSchema,
  type AssignFilesRequest,
} from './schemas';

export function assignFiles(request: AssignFilesRequest) {
  return sendJson('POST', '/api/assign', request, assignFilesRequestSchema, fileActionResponseSchema);
}

export function deleteFiles(paths: string[]) {
  return sendJson('POST', '/api/delete', { paths }, deleteFilesRequestSchema, fileActionResponseSchema);
}
