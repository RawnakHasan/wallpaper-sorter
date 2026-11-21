import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../../stores/toast';
import { undoActivity } from '../../activity/api';
import { assignFiles } from '../../files/api';
import type { AssignFilesRequest } from '../../files/schemas';
import { getStatus, statusQueryKey } from '../../status/api';
import { getTags, getTagFolders, tagFoldersQueryKey, tagsQueryKey } from '../../tags/api';
import type { TagRequest } from '../../tags/schemas';
import { fetchJobQueryKey, getFetchJob, submitFetch } from '../api';

interface CharacterTagPrompt {
  key: string;
  itemKey: string;
  location: string;
  keyword: string;
  initialDestination: string;
}

function normalizeTagKeyword(value: string) {
  return value
    .replace(/\([^)]*\)/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function folderSegment(value: string) {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function useFetchPanel() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [site, setSite] = useState<'Wallhaven' | 'Danbooru'>('Wallhaven');
  const [input, setInput] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);
  const [creatingTag, setCreatingTag] = useState<CharacterTagPrompt | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(() => new Set());
  const [locationOverrides, setLocationOverrides] = useState<Record<string, string>>({});
  const submitMutation = useMutation({
    mutationFn: submitFetch,
    onSuccess: (job) => {
      setJobId(job.id);
      setInput('');
    },
  });
  const activeJobId = jobId;
  const jobQuery = useQuery({
    queryKey: activeJobId === null ? ['fetch-job', null] : fetchJobQueryKey(activeJobId),
    queryFn: () => getFetchJob(activeJobId!),
    enabled: activeJobId !== null,
    refetchInterval: (query) => query.state.data?.done ? false : 750,
  });
  const hasCharacterSuggestions = Boolean(
    jobQuery.data?.done
      && jobQuery.data.items.some((item) => item.character_suggestions.length > 0),
  );
  const tagsQuery = useQuery({
    queryKey: tagsQueryKey,
    queryFn: getTags,
    enabled: hasCharacterSuggestions,
  });
  const foldersQuery = useQuery({
    queryKey: tagFoldersQueryKey,
    queryFn: getTagFolders,
    enabled: creatingTag !== null,
  });
  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: getStatus,
    enabled: creatingTag !== null,
  });

  useEffect(() => {
    if (!jobQuery.data?.done) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['library'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
      queryClient.invalidateQueries({ queryKey: ['duplicates'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ]);
  }, [jobQuery.data?.done, queryClient]);

  const refreshAfterTagSave = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: tagsQueryKey }),
      queryClient.invalidateQueries({ queryKey: tagFoldersQueryKey }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['library-images'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
      queryClient.invalidateQueries({ queryKey: ['duplicates'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ]);
  };
  const createTagMutation = useMutation({
    mutationFn: async ({
      itemKey,
      key,
      path,
      request,
    }: {
      itemKey: string;
      key: string;
      path: string;
      request: TagRequest;
    }) => {
      const body: AssignFilesRequest = {
        paths: [path],
        folder: request.dest,
        tag: {
          keywords: request.keywords,
          dest: request.dest,
          prefix: request.prefix,
          match: request.match,
          strict_words: request.strict_words,
          generic: request.generic,
        },
      };
      const result = await assignFiles(body);
      if (result.error) throw new Error(result.error);
      return { result, itemKey, path, key };
    },
    onSuccess: async ({ result, itemKey, path, key }) => {
      const movedTo = result.done.find((entry) => entry.from === path)?.to;
      if (movedTo) {
        setLocationOverrides((current) => ({ ...current, [itemKey]: movedTo }));
      }
      setDismissedSuggestions((current) => new Set(current).add(key));
      setCreatingTag(null);
      setTagError(null);
      const batch = result.batch;
      const undo = batch === null
        ? undefined
        : async () => {
            await undoActivity({ batch });
            await refreshAfterTagSave();
          };
      showToast(`Created tag and sorted image to ${movedTo ?? result.done[0]?.to ?? 'its new folder'}`, { success: true, undo });
      await refreshAfterTagSave();
    },
    onError: (error) => setTagError(error instanceof Error ? error.message : String(error)),
  });

  const suggestions = (jobQuery.data?.items ?? []).flatMap((item, itemIndex) => {
    if (!tagsQuery.data || !['inbox', 'sorted'].includes(item.state) || !item.location) return [];
    return item.character_suggestions.flatMap((suggestion) => {
      const itemKey = `${jobQuery.data!.id}:${itemIndex}`;
      const key = `${itemKey}:${suggestion.keyword.toLowerCase()}`;
      const alreadyTagged = tagsQuery.data.some((tag) => tag.keywords.some(
        (keyword) => normalizeTagKeyword(keyword) === normalizeTagKeyword(suggestion.keyword),
      ));
      if (alreadyTagged || dismissedSuggestions.has(key)) return [];
      const seriesTag = suggestion.series
        ? tagsQuery.data.find((tag) => tag.keywords.some(
            (keyword) => normalizeTagKeyword(keyword) === normalizeTagKeyword(suggestion.series!),
          ))
        : undefined;
      const destination = folderSegment(suggestion.keyword);
      const prompt: CharacterTagPrompt = {
        key,
        itemKey,
        location: locationOverrides[itemKey] ?? item.location,
        keyword: suggestion.keyword,
        initialDestination: seriesTag ? `${seriesTag.dest}/${destination}` : destination,
      };
      return [prompt];
    });
  });

  const dismissSuggestion = (key: string) => {
    setDismissedSuggestions((current) => new Set(current).add(key));
  };
  const openTagEditor = (suggestion: CharacterTagPrompt) => {
    setTagError(null);
    setCreatingTag(suggestion);
  };
  const closeTagEditor = () => {
    if (createTagMutation.isPending) return;
    setCreatingTag(null);
    setTagError(null);
  };
  const saveSuggestedTag = (request: TagRequest) => {
    if (!creatingTag) return;
    setTagError(null);
    createTagMutation.mutate({
      itemKey: creatingTag.itemKey,
      key: creatingTag.key,
      path: creatingTag.location,
      request,
    });
  };

  const submit = () => {
    const items = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((value) => ({ site, input: value }));
    if (items.length) submitMutation.mutate({ items });
  };
  const busy = submitMutation.isPending || (
    activeJobId !== null && !jobQuery.data?.done && !jobQuery.error
  );

  return {
    site,
    setSite,
    input,
    setInput,
    submit,
    busy,
    submitMutation,
    jobQuery,
    tagsQuery,
    foldersQuery,
    statusQuery,
    suggestions,
    creatingTag,
    openTagEditor,
    closeTagEditor,
    tagError,
    createTagPending: createTagMutation.isPending,
    dismissSuggestion,
    saveSuggestedTag,
  };
}
