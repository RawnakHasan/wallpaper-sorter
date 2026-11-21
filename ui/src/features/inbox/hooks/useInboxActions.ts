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
import { getTags, tagsQueryKey } from '../../tags/api';
import { lookupOrigin, saveOrigin } from '../../data/api';
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
  const [assignTagSeed, setAssignTagSeed] = useState<string[]>([]);
  const [thumbVersions, setThumbVersions] = useState<Record<string, number>>({});
  const assignData = useRef<{
    folders: AssignFolder[];
    tags: Awaited<ReturnType<typeof getTags>>;
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
  const undoBatches = (batches: Array<number | null | undefined>) => {
    const valid = [...new Set(batches.filter((batch): batch is number => batch !== null && batch !== undefined))];
    return valid.length
      ? async () => {
        for (const batch of valid.reverse()) await undoActivity({ batch });
        await refreshQueries();
      }
      : undefined;
  };
  const undoBatch = (batch: number | null) => undoBatches([batch]);
  const assignMutation = useMutation({
    mutationFn: assignFilePaths,
    onSuccess: async (result, request) => {
      setAssignFiles(null);
      setAssignTagSeed([]);
      setAssignError(null);
      useSelectionStore.getState().clear();
      if (result.error) {
        showToast(`Stopped: ${result.error}`, { error: true });
      } else {
        const moved = result.done.filter((item) => item.kind === 'move').length;
        const duplicates = result.done.filter((item) => item.kind === 'duplicate').length;
        let message = `Moved ${plural(moved, 'image')} to ${request.folder}`;
        if (duplicates) message += `; ${plural(duplicates, 'duplicate')} sent to ${status?.settings.duplicates_folder ?? 'Duplicates'}`;
        if (result.additional_sorted) {
          message += `; sorted ${plural(result.additional_sorted, 'additional image')} using the new tag`;
        }
        const undo = undoBatches([result.batch, result.additional_batch]);
        if (result.additional_error) {
          showToast(`${message}; additional sorting stopped: ${result.additional_error}`, { error: true, undo });
        } else {
          showToast(message, { undo });
        }
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
  const sourceMutation = useMutation({
    mutationFn: saveOrigin,
    onSuccess: async (_, request) => {
      showToast('Source saved');
      await refreshQueries();
      const current = queryClient.getQueryData<InboxItem[]>(inboxQueryKey);
      setSelectedItem(current?.find((item) => item.origin?.hash === request.hash) ?? null);
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const lookupMutation = useMutation({
    mutationFn: lookupOrigin,
    onSuccess: async (result, request) => {
      await refreshQueries();
      if (result.sorted_to) {
        setSelectedItem(null);
        showToast(`Tags looked up and sorted to ${result.sorted_to}`, { undo: undoBatch(result.batch) });
      } else {
        const current = queryClient.getQueryData<InboxItem[]>(inboxQueryKey);
        setSelectedItem(current?.find((item) => item.origin?.hash === request.hash) ?? null);
        showToast(`Looked up ${plural(result.tags_updated, 'tag')}; image remains in the Inbox.`);
      }
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const openAssign = async (files: AssignFile[], initialTagKeywords: string[] = []) => {
    if (!files.length) return;
    try {
      const [folders, tags] = await Promise.all([
        queryClient.fetchQuery({ queryKey: assignFoldersQueryKey, queryFn: getAssignFolders }),
        queryClient.fetchQuery({ queryKey: tagsQueryKey, queryFn: getTags }),
      ]);
      if (!status) return;
      setAssignError(null);
      assignData.current = { folders, tags, duplicateFolder: status.settings.duplicates_folder };
      setAssignTagSeed(initialTagKeywords);
      setAssignFiles(files);
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
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
      .map((item) => ({ path: item.path, name: item.name, tags: item.origin?.tags ?? [] }));
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
    assignTagSeed, setAssignTagSeed, thumbVersions, assignData, assignMutation, deleteMutation,
    sourceMutation, lookupMutation, openAssign,
    deleteFiles, selectedFiles, rebuildThumbnails,
  };
}
