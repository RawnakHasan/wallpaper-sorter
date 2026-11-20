import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../../components/dialogs';
import { useToastStore } from '../../../stores/toast';
import { undoActivity } from '../../activity/api';
import { getStatus, statusQueryKey } from '../../status/api';
import {
  applyResort,
  getResortFolders,
  getResortPreview,
  resortFoldersQueryKey,
  resortPreviewQueryKey,
} from '../api';

let retainedFolder = '';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function useResortPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [folder, setFolder] = useState(retainedFolder);
  const [outputRevision, setOutputRevision] = useState(0);
  const foldersQuery = useQuery({ queryKey: resortFoldersQueryKey, queryFn: getResortFolders });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const previewQuery = useQuery({
    queryKey: resortPreviewQueryKey(folder),
    queryFn: () => getResortPreview(folder),
    enabled: false,
    gcTime: Infinity,
  });

  const refreshAfterAction = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshAfterAction();
    setOutputRevision((revision) => revision + 1);
  };
  const applyMutation = useMutation({
    mutationFn: applyResort,
    onSuccess: async (result, request) => {
      queryClient.removeQueries({ queryKey: resortPreviewQueryKey(request.folder ?? '') });
      showToast(`Re-sorted ${plural(result.done.length, 'file')}`, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  useEffect(() => {
    if (!folder || !foldersQuery.data || !statusQuery.data) return;
    const isValid = foldersQuery.data.some((entry) =>
      entry.path === folder
      && entry.path !== statusQuery.data.settings.duplicates_folder
      && !entry.path.startsWith(`${statusQuery.data.settings.duplicates_folder}/`)
    );
    // Clear module-retained scope if folders or duplicate settings change while this route remains mounted.
    if (!isValid) {
      retainedFolder = '';
      setFolder('');
      queryClient.removeQueries({ queryKey: ['resort-preview'] });
    }
  }, [folder, foldersQuery.data, queryClient, statusQuery.data]);

  const changeFolder = (next: string) => {
    retainedFolder = next;
    queryClient.removeQueries({ queryKey: ['resort-preview'] });
    setFolder(next);
  };
  const scan = async () => {
    try {
      await previewQuery.refetch({ throwOnError: true });
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const apply = async (changes: number) => {
    const confirmed = await confirmDialog(
      `Apply ${plural(changes, 'change')}? The result is saved as one activity batch and can be undone.`,
      'Apply re-sort',
      true,
    );
    if (!confirmed) return;
    applyMutation.mutate(folder ? { folder } : {});
  };

  return {
    folder,
    outputRevision,
    foldersQuery,
    statusQuery,
    previewQuery,
    applyMutation,
    changeFolder,
    scan,
    apply,
  };
}
