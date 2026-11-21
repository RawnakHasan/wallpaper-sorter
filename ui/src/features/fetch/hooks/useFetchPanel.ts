import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { statusQueryKey } from '../../status/api';
import { fetchJobQueryKey, getFetchJob, submitFetch } from '../api';

export function useFetchPanel() {
  const queryClient = useQueryClient();
  const [site, setSite] = useState<'Wallhaven' | 'Danbooru'>('Wallhaven');
  const [input, setInput] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);
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
  };
}
