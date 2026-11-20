import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions<TBody, TResponse> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  responseSchema: z.ZodType<TResponse>;
  requestSchema?: z.ZodType<TBody>;
  body?: TBody;
}

export async function requestJson<TBody, TResponse>(
  path: string,
  options: RequestOptions<TBody, TResponse>,
): Promise<TResponse> {
  const { method, responseSchema, requestSchema, body } = options;
  const init: RequestInit = { method };
  if (method !== 'GET') {
    if (!requestSchema || body === undefined) throw new ApiError('Invalid request data');
    const parsedBody = requestSchema.safeParse(body);
    if (!parsedBody.success) throw new ApiError('Invalid request data');
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(parsedBody.data);
  }

  let response: Response;
  try {
    response = await fetch(new URL(path, window.location.origin), init);
  } catch {
    throw new ApiError('Cannot reach the sorter');
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(response.ok ? 'Invalid response from the sorter' : response.statusText, response.status);
  }

  if (!response.ok) {
    const error = z.object({ error: z.string().optional() }).passthrough().safeParse(data);
    const message = error.success ? error.data.error : undefined;
    throw new ApiError(message || response.statusText || 'Request failed', response.status);
  }

  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError('Invalid response from the sorter', response.status);
  }
  return parsed.data;
}

export function getJson<T>(path: string, responseSchema: z.ZodType<T>) {
  return requestJson<never, T>(path, { method: 'GET', responseSchema });
}

export function sendJson<TBody, TResponse>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: TBody,
  requestSchema: z.ZodType<TBody>,
  responseSchema: z.ZodType<TResponse>,
) {
  return requestJson(path, { method, body, requestSchema, responseSchema });
}
