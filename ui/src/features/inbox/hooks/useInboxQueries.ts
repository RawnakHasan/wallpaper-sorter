import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getStatus, statusQueryKey } from '../../status/api';
import { getInbox, inboxQueryKey } from '../api';
import type { InboxItem } from '../schemas';
import type { InboxFilters } from '../types';

let retainedFilters: InboxFilters = { reason: '', intake: '' };
const emptyInbox: InboxItem[] = [];

export function useInboxQueries() {
  const [filters, setFilters] = useState(retainedFilters);
  const inboxQuery = useQuery({
    queryKey: inboxQueryKey,
    queryFn: getInbox,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const allItems = inboxQuery.data ?? emptyInbox;
  const items = useMemo(() => allItems.filter((item) =>
    (!filters.reason || item.reason === filters.reason)
    && (!filters.intake || item.intake === filters.intake)
  ), [allItems, filters]);
  const intakes = useMemo(() => [...new Set(allItems.map((item) => item.intake))], [allItems]);
  const setReason = (reason: InboxFilters['reason']) => {
    retainedFilters = { ...filters, reason };
    setFilters(retainedFilters);
  };
  const setIntake = (intake: string) => {
    retainedFilters = { ...filters, intake };
    setFilters(retainedFilters);
  };

  return { inboxQuery, statusQuery, allItems, items, intakes, filters, setReason, setIntake };
}
