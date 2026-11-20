import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { flushSync } from 'react-dom';
import { confirmDialog } from '../../../components/dialogs';
import { undoActivity } from '../../activity/api';
import { assignFiles, deleteFiles } from '../../files/api';
import type { AssignFilesRequest, FileActionResponse } from '../../files/schemas';
import { statusQueryKey } from '../../status/api';
import { getTags, tagsQueryKey } from '../../tags/api';
import type { Tag } from '../../tags/schemas';
import { refreshThumbnail } from '../../thumbnails/api';
import { useSelectionStore } from '../../../stores/selection';
import { useToastStore } from '../../../stores/toast';
import {
  applyFolderChange,
  createLibraryFolder,
  fillLibraryGaps,
  libraryFoldersQueryKey,
  libraryImagesQueryOptions,
} from '../api';
import type { FolderChangeRequest, GapFillMode, LibraryFolder, LibraryImage } from '../schemas';
import type { LibraryFile } from '../types';
import { messageOf, plural } from '../utils';
import type { GridItem } from '../../../components/ImageGrid';

interface UseLibraryActionsOptions {
  currentFolder: string;
  images: LibraryImage[];
  duplicateFolder?: string;
}

interface FolderCreated {
  folder: string;
}

export function useLibraryActions({ currentFolder, images, duplicateFolder }: UseLibraryActionsOptions) {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/library' });
  const showToast = useToastStore((state) => state.show);
  const [selectedImage, setSelectedImage] = useState<LibraryImage | null>(null);
  const [moveFiles, setMoveFiles] = useState<LibraryFile[] | null>(null);
  const [moveTags, setMoveTags] = useState<Tag[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [managementFolder, setManagementFolder] = useState<LibraryFolder | null>(null);
  const [managementKey, setManagementKey] = useState(0);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [gapFolder, setGapFolder] = useState<string | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [thumbVersions, setThumbVersions] = useState<Record<string, number>>({});
  const draggedFiles = useRef<LibraryFile[]>([]);

  // Dismiss transient dialogs and state when navigating to a different folder.
  useEffect(() => {
    setSelectedImage(null);
    setMoveFiles(null);
    setCreateOpen(false);
    setManagementFolder(null);
    setGapFolder(null);
  }, [currentFolder]);

  const refreshAfterAction = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: libraryFoldersQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['library-images'] }),
      queryClient.invalidateQueries({ queryKey: ['inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['duplicates'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: tagsQueryKey }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshAfterAction();
  };
  const navigateToFolder = async (folder: string) => {
    try {
      await queryClient.ensureQueryData(libraryImagesQueryOptions(folder));
      await navigate({ to: '/library', search: { folder } });
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const prefetchFolder = (folder: string) => {
    void queryClient.prefetchQuery(libraryImagesQueryOptions(folder));
  };

  const createMutation = useMutation({
    mutationFn: createLibraryFolder,
    onSuccess: async (result: FolderCreated) => {
      setCreateOpen(false);
      setCreateError(null);
      showToast(`Created ${result.folder}`);
      await refreshAfterAction();
      await navigateToFolder(result.folder);
    },
    onError: (error) => setCreateError(messageOf(error)),
  });
  const moveMutation = useMutation({
    mutationFn: assignFiles,
    onSuccess: async (result: FileActionResponse, request: AssignFilesRequest) => {
      setMoveFiles(null);
      setMoveError(null);
      useSelectionStore.getState().clear();
      const moved = result.done.filter((item) => item.kind === 'move').length;
      const duplicates = result.done.filter((item) => item.kind === 'duplicate').length;
      let message = `Moved ${plural(moved, 'image')} to ${request.folder}`;
      if (duplicates) message += `; ${plural(duplicates, 'duplicate')} sent to ${duplicateFolder ?? 'Duplicates'}`;
      if (result.error) showToast(`Stopped: ${result.error}`, { error: true });
      else showToast(message, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    },
    onError: (error) => {
      const message = messageOf(error);
      if (moveFiles) setMoveError(message);
      else showToast(message, { error: true });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteFiles,
    onSuccess: async (result) => {
      useSelectionStore.getState().clear();
      showToast(`Deleted ${plural(result.done.length, 'image')}`, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const folderChangeMutation = useMutation({ mutationFn: applyFolderChange });
  const gapMutation = useMutation({
    mutationFn: (request: { folder: string; mode: GapFillMode }) => fillLibraryGaps(request.folder, request.mode),
  });

  const selectedFiles = () => {
    const selected = useSelectionStore.getState().keys;
    return images.filter((image) => selected.has(image.path)).map(({ path, name }) => ({ path, name }));
  };
  const openMove = async (files: LibraryFile[]) => {
    if (!files.length) return;
    try {
      const tags = await queryClient.fetchQuery({ queryKey: tagsQueryKey, queryFn: getTags });
      setMoveError(null);
      setMoveTags(tags);
      setMoveFiles(files);
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const deleteSelected = async (files: LibraryFile[]) => {
    if (!files.length) return;
    const name = files.length === 1 ? files[0].name : plural(files.length, 'image');
    const confirmed = await confirmDialog(
      `Delete ${name}? ${files.length === 1 ? 'It goes' : 'They go'} to the trash and can be undone.`,
      'Delete',
      true,
    );
    if (confirmed) deleteMutation.mutate(files.map((file) => file.path));
  };
  const rebuildThumbnails = async (hashes: Array<string | null | undefined>) => {
    const unique = [...new Set(hashes.filter((hash): hash is string => Boolean(hash)))];
    if (!unique.length) {
      showToast('No thumbnails available to rebuild', { error: true });
      return;
    }
    showToast(`Rebuilding ${plural(unique.length, 'thumbnail')}…`);
    const rebuilt: string[] = [];
    const errors: string[] = [];
    for (const hash of unique) {
      try {
        await refreshThumbnail(hash);
        rebuilt.push(hash);
      } catch (error) {
        errors.push(messageOf(error));
      }
    }
    if (rebuilt.length) {
      setThumbVersions((current) => {
        const next = { ...current };
        rebuilt.forEach((hash) => { next[hash] = (next[hash] ?? 0) + 1; });
        return next;
      });
    }
    if (errors.length) {
      showToast(`Rebuilt ${rebuilt.length} of ${unique.length}; ${errors.length} failed: ${errors[0]}`, { error: true });
    } else {
      showToast(`Rebuilt ${plural(rebuilt.length, 'thumbnail')}`);
    }
  };
  const openDeleteImage = (image: LibraryImage) => {
    setSelectedImage(null);
    void deleteSelected([{ path: image.path, name: image.name }]);
  };
  const openMoveImage = (image: LibraryImage) => {
    setSelectedImage(null);
    void openMove([{ path: image.path, name: image.name }]);
  };
  const startImageDrag = (event: DragEvent<HTMLDivElement>, item: GridItem) => {
    const selection = useSelectionStore.getState().keys;
    const files = selection.has(item.key)
      ? images.filter((image) => selection.has(image.path))
      : images.filter((image) => image.path === item.key);
    draggedFiles.current = files.map(({ path, name }) => ({ path, name }));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-wallpaper-sorter-image', 'images');
  };
  const dropImagesOnFolder = async (event: DragEvent<HTMLButtonElement>, folder: string) => {
    event.preventDefault();
    setDropTarget(null);
    const files = draggedFiles.current;
    draggedFiles.current = [];
    const filesToMove = files.filter((file) => file.path.slice(0, file.path.lastIndexOf('/')) !== folder);
    if (!filesToMove.length) return;

    const names = filesToMove.length === 1 ? filesToMove[0].name : plural(filesToMove.length, 'image');
    const confirmed = await confirmDialog(
      `Move ${names} to ${folder}? ${filesToMove.length === 1 ? 'It will' : 'They will'} be renamed using the destination folder’s prefix and your current numbering setting. Exact duplicates may be sent to Duplicates. You can undo the move.`,
      'Move & rename',
    );
    if (confirmed) moveMutation.mutate({ paths: filesToMove.map((file) => file.path), folder });
  };
  const folderChangeDone = async (request: FolderChangeRequest, result: FileActionResponse) => {
    const message = request.kind === 'prefix'
      ? `Prefix changed for ${request.folder}`
      : request.kind === 'rename' ? `Renamed ${request.from}` : `Merged ${request.from}`;
    flushSync(() => {
      setManagementFolder(null);
      setManagementError(null);
    });
    const next = request.kind === 'prefix' ? request.folder : request.to;
    await navigateToFolder(next);
    await refreshAfterAction();
    showToast(message, result.done.length ? { undo: undoBatch(result.batch) } : undefined);
  };
  const fillGaps = async (mode: GapFillMode) => {
    if (!gapFolder) return;
    setGapError(null);
    try {
      const result = await gapMutation.mutateAsync({ folder: gapFolder, mode });
      if (result.error) throw new Error(result.error);
      setGapFolder(null);
      showToast(`Renamed ${plural(result.done.length, 'file')} in ${gapFolder}`, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    } catch (error) {
      setGapError(messageOf(error));
    }
  };

  return {
    selectedImage, setSelectedImage, moveFiles, setMoveFiles, moveTags, moveError, setMoveError,
    createOpen, setCreateOpen, createError, setCreateError, managementFolder, setManagementFolder,
    managementKey, setManagementKey, managementError, setManagementError, gapFolder, setGapFolder,
    gapError, setGapError, dropTarget, setDropTarget, thumbVersions, draggedFiles,
    createMutation, moveMutation, deleteMutation, folderChangeMutation, gapMutation,
    navigateToFolder, prefetchFolder, selectedFiles, openMove, deleteSelected, rebuildThumbnails,
    openDeleteImage, openMoveImage, startImageDrag, dropImagesOnFolder, folderChangeDone, fillGaps,
  };
}
