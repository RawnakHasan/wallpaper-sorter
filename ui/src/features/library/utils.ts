import type { LibraryImage } from './schemas';

export function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function formatDateTime(seconds: number) {
  return seconds ? new Date(seconds * 1000).toLocaleString() : '';
}

export function safeUrl(value: string) {
  return /^https?:\/\//.test(value) ? value : null;
}

export function imageSources(image: LibraryImage) {
  return image.origin?.sources.filter((source) => source.site !== 'Unknown') ?? [];
}
