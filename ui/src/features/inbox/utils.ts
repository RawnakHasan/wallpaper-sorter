import type { InboxItem } from './schemas';

export const boringWords = new Set([
  'full', 'wallpaper', 'wallpapers', 'konachan', 'yande', 'png', 'jpg', 'jpeg',
  'and', 'the', 'drawn', 'tagme', 'naive', 'com', 'uhdpaper',
]);

export const reasonLabels: Record<InboxItem['reason'], string> = {
  no_match: 'No match',
  conflict: 'Conflict',
  ready: 'Ready',
};

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function formatDateTime(seconds: number) {
  return seconds ? new Date(seconds * 1000).toLocaleString() : '';
}

export function safeUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : null;
}
