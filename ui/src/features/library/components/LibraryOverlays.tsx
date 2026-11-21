import { CreateFolderSheet } from './CreateFolderSheet';
import { FolderManagementSheet } from './FolderManagementSheet';
import { GapFillSheet } from './GapFillSheet';
import { ImageDetail } from './ImageDetail';
import { MoveSheet } from './MoveSheet';
import type { FolderChangeRequest, GapFillMode, LibraryFolder, LibraryImage } from '../schemas';
import type { LibraryFile } from '../types';
import type { Tag } from '../../tags/schemas';
import type { AssignFilesRequest, FileActionResponse } from '../../files/schemas';
import type { OriginLookupRequest, Site } from '../../data/schemas';

interface LibraryOverlaysProps {
  selectedImage: LibraryImage | null;
  currentFolder: string;
  imagePending: boolean;
  onCloseImage: () => void;
  onMoveImage: () => void;
  onDeleteImage: () => void;
  onRebuildImage: (hash: string | null) => void;
  sourcePending: boolean;
  onSaveSource: (request: { hash: string; site: Site; id: string }) => void;
  onLookupSource: (request: OriginLookupRequest) => void;
  moveFiles: LibraryFile[] | null;
  folders: LibraryFolder[];
  moveTags: Tag[];
  duplicateFolder: string;
  movePending: boolean;
  moveError: string | null;
  onCloseMove: () => void;
  onMove: (request: AssignFilesRequest) => void;
  createOpen: boolean;
  createPending: boolean;
  createError: string | null;
  onCloseCreate: () => void;
  onCreate: (folder: string) => void;
  managementFolder: LibraryFolder | null;
  managementKey: number;
  folderChangePending: boolean;
  managementError: string | null;
  onCloseManagement: () => void;
  onApplyFolderChange: (request: FolderChangeRequest) => Promise<FileActionResponse>;
  onFolderChangeApplied: (request: FolderChangeRequest, result: FileActionResponse) => Promise<void>;
  gapFolder: string | null;
  gapPending: boolean;
  gapError: string | null;
  onCloseGaps: () => void;
  onFillGaps: (mode: GapFillMode) => void;
}

export function LibraryOverlays({
  selectedImage,
  currentFolder,
  imagePending,
  onCloseImage,
  onMoveImage,
  onDeleteImage,
  onRebuildImage,
  sourcePending,
  onSaveSource,
  onLookupSource,
  moveFiles,
  folders,
  moveTags,
  duplicateFolder,
  movePending,
  moveError,
  onCloseMove,
  onMove,
  createOpen,
  createPending,
  createError,
  onCloseCreate,
  onCreate,
  managementFolder,
  managementKey,
  folderChangePending,
  managementError,
  onCloseManagement,
  onApplyFolderChange,
  onFolderChangeApplied,
  gapFolder,
  gapPending,
  gapError,
  onCloseGaps,
  onFillGaps,
}: LibraryOverlaysProps) {
  return (
    <>
      {selectedImage ? (
        <ImageDetail
          key={selectedImage.path}
          image={selectedImage}
          folder={currentFolder}
          pending={imagePending}
          onClose={onCloseImage}
          onMove={onMoveImage}
          onDelete={onDeleteImage}
          onRebuild={onRebuildImage}
          sourcePending={sourcePending}
          onSaveSource={onSaveSource}
          onLookupSource={onLookupSource}
        />
      ) : null}
      {moveFiles ? (
        <MoveSheet
          files={moveFiles}
          folders={folders}
          tags={moveTags}
          duplicateFolder={duplicateFolder}
          pending={movePending}
          error={moveError}
          onClose={onCloseMove}
          onSubmit={onMove}
        />
      ) : null}
      {createOpen ? (
        <CreateFolderSheet
          defaultPath={currentFolder ? `${currentFolder}/` : ''}
          pending={createPending}
          error={createError}
          onClose={onCloseCreate}
          onCreate={onCreate}
        />
      ) : null}
      {managementFolder ? (
        <FolderManagementSheet
          key={managementKey}
          folder={managementFolder}
          folders={folders}
          pending={folderChangePending}
          error={managementError}
          onClose={onCloseManagement}
          onApply={onApplyFolderChange}
          onApplied={onFolderChangeApplied}
        />
      ) : null}
      {gapFolder ? (
        <GapFillSheet
          folder={gapFolder}
          pending={gapPending}
          error={gapError}
          onClose={onCloseGaps}
          onApply={onFillGaps}
        />
      ) : null}
    </>
  );
}
