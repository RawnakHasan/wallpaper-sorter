import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../../components/dialogs';
import { refreshThumbnail } from '../../thumbnails/api';
import { undoActivity } from '../../activity/api';
import { useHotkeysStore } from '../../../stores/hotkeys';
import { useSelectionStore } from '../../../stores/selection';
import { useToastStore } from '../../../stores/toast';
import { assignFiles as assignFilePaths, deleteFiles as deleteFilePaths } from '../../files/api';
import type { AssignFilesRequest } from '../../files/schemas';
import { getTagFolders, getTags, saveTag, tagFoldersQueryKey, tagsQueryKey } from '../../tags/api';
import type { Tag, TagRequest } from '../../tags/schemas';
import { statusQueryKey } from '../../status/api';
import type { Status } from '../../status/schemas';
import { assignFoldersQueryKey, getAssignFolders, inboxQueryKey } from '../api';
import type { AssignFolder, InboxItem } from '../schemas';
import type { AssignFile } from '../types';
import { messageOf, plural } from '../utils';

interface UseInboxActionsOptions {
  items: InboxItem[];
  allKeys: string[];
  hasInboxData: boolean;
  status?: Status;
}

export function useInboxActions({ items, allKeys, hasInboxData, status }: UseInboxActionsOptions) {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [assignFiles, setAssignFiles] = useState<AssignFile[] | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [thumbVersions, setThumbVersions] = useState<Record<string, number>>({});
  const [tagEditorKeywords, setTagEditorKeywords] = useState<string[] | null>(null);
  const [tagEditorFolders, setTagEditorFolders] = useState<Array<{ path: string }>>([]);
  const [tagEditorLoading, setTagEditorLoading] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const assignData = useRef<{
    folders: AssignFolder[];
    tags: Tag[];
    duplicateFolder: string;
  } | null>(null);

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inboxQueryKey }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
      queryClient.invalidateQueries({ queryKey: tagsQueryKey }),
      queryClient.invalidateQueries({ queryKey: assignFoldersQueryKey }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshQueries();
  };
  const assignMutation = useMutation({
    mutationFn: assignFilePaths,
    onSuccess: async (result, request) => {
      setAssignFiles(null);
      setAssignError(null);
      useSelectionStore.getState().clear();
      if (result.error) {
        showToast(`Stopped: ${result.error}`, { error: true });
      } else {
        const moved = result.done.filter((item) => item.kind === 'move').length;
        const duplicates = result.done.filter((item) => item.kind === 'duplicate').length;
        let message = `Moved ${plural(moved, 'image')} to ${request.folder}`;
        if (duplicates) message += `; ${plural(duplicates, 'duplicate')} sent to ${status?.settings.duplicates_folder ?? 'Duplicates'}`;
        showToast(message, { undo: undoBatch(result.batch) });
      }
      await refreshQueries();
    },
    onError: (error) => setAssignError(messageOf(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteFilePaths,
    onSuccess: async (result) => {
      useSelectionStore.getState().clear();
      showToast(`Deleted ${plural(result.done.length, 'image')}`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const tagMutation = useMutation({
    mutationFn: (request: TagRequest) => saveTag(null, request),
    onSuccess: async () => {
      setTagEditorKeywords(null);
      setTagError(null);
      showToast('Tag saved. Waiting images that match are sorted now.');
      await refreshQueries();
    },
    onError: (error) => setTagError(messageOf(error)),
  });

  const openAssign = async (files: AssignFile[]) => {
    if (!files.length) return;
    try {
      const [folders, tags] = await Promise.all([
        queryClient.fetchQuery({ queryKey: assignFoldersQueryKey, queryFn: getAssignFolders }),
        queryClient.fetchQuery({ queryKey: tagsQueryKey, queryFn: getTags }),
      ]);
      if (!status) return;
      setAssignError(null);
      assignData.current = { folders, tags, duplicateFolder: status.settings.duplicates_folder };
      setAssignFiles(files);
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const openTagEditor = async (keywords: string[]) => {
    if (!keywords.length) return;
    setTagEditorLoading(true);
    try {
      const folders = await queryClient.fetchQuery({
        queryKey: tagFoldersQueryKey,
        queryFn: getTagFolders,
      });
      setTagError(null);
      setTagEditorFolders(folders);
      setTagEditorKeywords(keywords);
    } catch (error) {
      showToast(`Could not load folders for the tag editor: ${messageOf(error)}`, { error: true });
    } finally {
      setTagEditorLoading(false);
    }
  };
  const closeTagEditor = () => {
    if (tagMutation.isPending) return;
    setTagEditorKeywords(null);
    setTagError(null);
  };
  const saveInboxTag = (request: TagRequest) => {
    setTagError(null);
    tagMutation.mutate(request);
  };
  const deleteFiles = async (files: AssignFile[]) => {
    if (!files.length) return;
    const name = files.length === 1 ? files[0].name : plural(files.length, 'image');
    const confirmed = await confirmDialog(
      `Delete ${name}? ${files.length === 1 ? 'It goes' : 'They go'} to the trash and can be undone.`,
      'Delete',
      true,
    );
    if (confirmed) deleteMutation.mutate(files.map((file) => file.path));
  };
  const selectedFiles = () => {
    const selected = useSelectionStore.getState().keys;
    return items
      .filter((item) => selected.has(item.path))
      .map(({ path, name }) => ({ path, name }));
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

  // Keep selection limited to the currently filtered inbox results.
  useLayoutEffect(() => {
    if (!hasInboxData) return;
    const valid = new Set(items.map((item) => item.path));
    const current = useSelectionStore.getState();
    const keys = new Set([...current.keys].filter((key) => valid.has(key)));
    if (keys.size !== current.keys.size || (current.last !== null && !valid.has(current.last))) {
      useSelectionStore.setState({
        keys,
        last: current.last !== null && valid.has(current.last) ? current.last : null,
      });
    }
  }, [hasInboxData, items]);
  // Register keyboard actions against the current filtered inbox.
  useLayoutEffect(() => {
    const setActions = useHotkeysStore.getState().setActions;
    setActions({
      assign: () => { void openAssign(selectedFiles()); },
      remove: () => { void deleteFiles(selectedFiles()); },
      all: () => flushSync(() => useSelectionStore.getState().addMany(allKeys)),
    });
    return () => setActions({});
  }, [items]);

  return {
    selectedItem, setSelectedItem, assignFiles, setAssignFiles, assignError, setAssignError,
    thumbVersions, assignData, assignMutation, deleteMutation,
    tagEditorKeywords, tagEditorFolders, tagEditorLoading, tagError, tagMutation,
    openAssign, openTagEditor, closeTagEditor, saveInboxTag,
    deleteFiles, selectedFiles, rebuildThumbnails,
  };
}
