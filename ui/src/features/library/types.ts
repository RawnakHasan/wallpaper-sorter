import type { FolderChangePreview, FolderChangeRequest } from './schemas';

export interface LibraryFile {
  path: string;
  name: string;
}

export interface ChangePreviewState {
  request: FolderChangeRequest;
  preview?: FolderChangePreview;
  loading: boolean;
  error?: string;
}

export type ChangePreviews = Partial<Record<FolderChangeRequest['kind'], ChangePreviewState>>;
