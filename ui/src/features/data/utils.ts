export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function formatDateTime(seconds: number) {
  return seconds ? new Date(seconds * 1000).toLocaleString() : '';
}

export function safeUrl(value?: string) {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

