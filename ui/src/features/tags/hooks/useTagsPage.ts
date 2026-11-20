import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../../components/dialogs';
import { useToastStore } from '../../../stores/toast';
import { getStatus, statusQueryKey } from '../../status/api';
import { deleteTag, getTagFolders, getTags, saveTag, tagFoldersQueryKey, tagsQueryKey, testTagName } from '../api';
import type { Tag, TagRequest } from '../schemas';

let lastTestedFilename = '';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useTagsPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [editingTag, setEditingTag] = useState<Tag | null | undefined>(undefined);
  const [tagError, setTagError] = useState<string | null>(null);
  const [testerInput, setTesterInput] = useState(lastTestedFilename);
  const [testedFilename, setTestedFilename] = useState(lastTestedFilename.trim());
  const testerInputRef = useRef<HTMLInputElement>(null);
  const tagsQuery = useQuery({ queryKey: tagsQueryKey, queryFn: getTags });
  const foldersQuery = useQuery({ queryKey: tagFoldersQueryKey, queryFn: getTagFolders });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const testQuery = useQuery({
    queryKey: ['tag-test', testedFilename],
    queryFn: () => testTagName(testedFilename),
    enabled: testedFilename !== '',
    retry: false,
  });

  useEffect(() => {
    // Preserve the existing 200 ms debounce before issuing the filename-test request.
    const timer = window.setTimeout(() => setTestedFilename(testerInput.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [testerInput]);

  const refreshPageData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tagsQueryKey }),
      queryClient.invalidateQueries({ queryKey: tagFoldersQueryKey }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: ({ index, request }: { index: number | null; request: TagRequest }) => saveTag(index, request),
    onSuccess: async () => {
      setEditingTag(undefined);
      showToast('Tag saved. Waiting images that match are sorted now.');
      await refreshPageData();
    },
    onError: (error) => setTagError(messageOf(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ tag }: { tag: Tag }) => deleteTag(tag.index, tag.keywords, tag.dest),
    onSuccess: async () => {
      showToast('Tag deleted');
      await refreshPageData();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const openEditor = (tag: Tag | null) => {
    setTagError(null);
    setEditingTag(tag);
  };
  const submitTag = (request: TagRequest) => {
    setTagError(null);
    saveMutation.mutate({ index: editingTag?.index ?? null, request });
  };
  const removeTag = async (tag: Tag) => {
    const confirmed = await confirmDialog(
      `Delete the tag “${tag.keywords.join(', ')}”? Images already sorted stay where they are.`,
      'Delete tag',
      true,
    );
    if (confirmed) deleteMutation.mutate({ tag });
  };
  const setExample = (filename: string) => {
    lastTestedFilename = filename;
    setTesterInput(filename);
    setTestedFilename(filename.trim());
    if (testerInputRef.current) testerInputRef.current.value = filename;
  };
  const updateTesterInput = (filename: string) => {
    lastTestedFilename = filename;
    setTesterInput(filename);
  };
  const closeEditor = () => {
    if (saveMutation.isPending) return;
    setEditingTag(undefined);
    setTagError(null);
  };

  return {
    tagsQuery,
    foldersQuery,
    statusQuery,
    testQuery,
    testerInput,
    testedFilename,
    testerInputRef,
    editingTag,
    tagError,
    saveMutation,
    deleteMutation,
    openEditor,
    submitTag,
    removeTag,
    setExample,
    updateTesterInput,
    closeEditor,
  };
}
