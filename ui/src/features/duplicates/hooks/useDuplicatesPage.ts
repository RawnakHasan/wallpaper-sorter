import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../../components/dialogs';
import { useToastStore } from '../../../stores/toast';
import { undoActivity } from '../../activity/api';
import { getStatus, statusQueryKey } from '../../status/api';
import {
  deleteDuplicates,
  duplicateFoldersQueryKey,
  duplicatesQueryKey,
  emptyDuplicates,
  getDuplicateFolders,
  getDuplicates,
  restoreDuplicate,
} from '../api';
import type { DuplicateItem } from '../schemas';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useDuplicatesPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [restoreItem, setRestoreItem] = useState<DuplicateItem | null>(null);
  const [restoreFolder, setRestoreFolder] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const duplicatesQuery = useQuery({ queryKey: duplicatesQueryKey, queryFn: getDuplicates });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const foldersQuery = useQuery({
    queryKey: duplicateFoldersQueryKey,
    queryFn: getDuplicateFolders,
    enabled: restoreItem !== null,
  });

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: duplicatesQueryKey }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshQueries();
  };
  const deleteMutation = useMutation({
    mutationFn: deleteDuplicates,
    onSuccess: async (result) => {
      showToast(`Deleted ${result.done.length} ${result.done.length === 1 ? 'image' : 'images'}`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const emptyMutation = useMutation({
    mutationFn: emptyDuplicates,
    onSuccess: async (result) => {
      showToast(`Moved ${result.done.length} ${result.done.length === 1 ? 'copy' : 'copies'} to the trash`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreDuplicate,
    onSuccess: async (result) => {
      setRestoreItem(null);
      setRestoreFolder('');
      showToast(`Restored ${result.done.length} ${result.done.length === 1 ? 'copy' : 'copies'} as new images`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => setRestoreError(messageOf(error)),
  });

  const openRestore = async (item: DuplicateItem) => {
    try {
      await queryClient.fetchQuery({ queryKey: duplicateFoldersQueryKey, queryFn: getDuplicateFolders });
    } catch (error) {
      showToast(messageOf(error), { error: true });
      return;
    }
    setRestoreError(null);
    setRestoreFolder('');
    setRestoreItem(item);
  };
  const closeRestore = () => {
    if (restoreMutation.isPending) return;
    setRestoreItem(null);
    setRestoreFolder('');
    setRestoreError(null);
  };
  const restore = (folder: string) => {
    if (!folder) {
      setRestoreError('Choose a folder.');
      return;
    }
    if (!restoreItem) return;
    setRestoreError(null);
    restoreMutation.mutate({ paths: [restoreItem.path], folder });
  };
  const deleteItem = async (item: DuplicateItem) => {
    const confirmed = await confirmDialog(`Delete ${item.name}? It goes to the trash and can be undone.`, 'Delete', true);
    if (confirmed) deleteMutation.mutate({ paths: [item.path] });
  };
  const emptyFolder = async (count: number, total: number) => {
    const confirmed = await confirmDialog(
      `Move all ${count} copies (${formatBytes(total)}) to the trash? You can undo this.`,
      'Move to trash',
      true,
    );
    if (confirmed) emptyMutation.mutate();
  };

  return {
    duplicatesQuery,
    statusQuery,
    foldersQuery,
    restoreItem,
    restoreFolder,
    setRestoreFolder,
    restoreError,
    setRestoreError,
    restoreMutation,
    deleteMutation,
    emptyMutation,
    openRestore,
    closeRestore,
    restore,
    deleteItem,
    emptyFolder,
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
