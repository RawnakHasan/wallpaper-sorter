import { z } from 'zod';
import { getJson, sendJson } from '../../lib/api-client';
import {
  gitCommitResponseSchema,
  gitLogResponseSchema,
  gitPushResponseSchema,
  gitStatusSchema,
} from './schemas';

export function getGitStatus(repository: string) {
  return getJson(`/api/git/status?repo=${encodeURIComponent(repository)}`, gitStatusSchema);
}

export function getGitLog(repository: string, limit = 300) {
  const params = new URLSearchParams({ repo: repository, limit: String(limit) });
  return getJson(`/api/git/log?${params}`, gitLogResponseSchema);
}

const gitCommitRequestSchema = z.object({
  repository: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  message: z.string().min(1),
}).strict();

export function commitGit(repository: string, paths: string[], message: string) {
  return sendJson(
    'POST',
    '/api/git/commit',
    { repository, paths, message },
    gitCommitRequestSchema,
    gitCommitResponseSchema,
  );
}

const gitPushRequestSchema = z.object({
  repository: z.string().min(1),
  remote: z.string().min(1),
  branch: z.string().min(1),
}).strict();

export function pushGit(repository: string, remote: string, branch: string) {
  return sendJson(
    'POST',
    '/api/git/push',
    { repository, remote, branch },
    gitPushRequestSchema,
    gitPushResponseSchema,
  );
}
