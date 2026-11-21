import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useToastStore } from '../../../stores/toast';
import { undoActivity } from '../../activity/api';
import { dataQueryKey, getData, lookupOrigin, saveOrigin, unknownCountQueryKey } from '../api';
import type { DataFilters } from '../api';
import { siteSchema, type Origin, type OriginSource, type Site } from '../schemas';
import { messageOf } from '../utils';

const PAGE_SIZE = 50;

interface PageFilters extends DataFilters {
  searchText: string;
  folderText: string;
}

let retainedFilters: PageFilters = {
  q: '',
  site: '',
  folder: '',
  unknown: false,
  offset: 0,
  searchText: '',
  folderText: '',
};

function lookupSite(source: OriginSource): Site | null {
  if (!source.id.trim()) return null;
  switch (source.site) {
    case 'Wallhaven':
    case 'Danbooru':
    case 'yande.re':
    case 'Safebooru':
      return source.site;
    default:
      return null;
  }
}

function lookupSource(record: Origin): OriginSource | undefined {
  return record.sources.find((source) => lookupSite(source) !== null);
}

export function useDataPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/data' });
  const routeSearch = useSearch({ from: '/data' });
  const showToast = useToastStore((state) => state.show);
  const [filters, setFilters] = useState<PageFilters>(() => routeSearch.q === undefined
    ? retainedFilters
    : { ...retainedFilters, q: routeSearch.q, searchText: routeSearch.q, offset: 0 });
  const filtersRef = useRef(filters);
  const [selectedRecord, setSelectedRecord] = useState<Origin | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<Origin[]>([]);
  const [batchSheetOpen, setBatchSheetOpen] = useState(false);
  const lookupableRecords = selectedRecords.filter((record) => lookupSource(record) !== undefined);

  const updateFilters = (patch: Partial<PageFilters>) => {
    const next = { ...filtersRef.current, ...patch };
    filtersRef.current = next;
    retainedFilters = next;
    setFilters(next);
  };

  // Consume the global search query once, then return to the canonical Data URL.
  useEffect(() => {
    if (routeSearch.q === undefined) return;
    updateFilters({ q: routeSearch.q, searchText: routeSearch.q, offset: 0 });
    void navigate({ search: { q: undefined }, replace: true });
  }, [navigate, routeSearch.q]);

  // Debounce name and ID searches to avoid issuing a request for every keystroke.
  useEffect(() => {
    if (filters.searchText.trim() === filters.q) return;
    const timer = window.setTimeout(() => {
      updateFilters({ q: filters.searchText.trim(), offset: 0 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.searchText]);

  // Debounce folder filtering while preserving immediate text entry.
  useEffect(() => {
    if (filters.folderText.trim() === filters.folder) return;
    const timer = window.setTimeout(() => {
      updateFilters({ folder: filters.folderText.trim(), offset: 0 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.folderText]);

  const requestFilters: DataFilters = {
    q: filters.q,
    site: filters.site,
    folder: filters.folder,
    unknown: filters.unknown,
    offset: filters.offset,
  };
  const dataQuery = useQuery({
    queryKey: dataQueryKey(requestFilters, PAGE_SIZE),
    queryFn: () => getData(requestFilters, PAGE_SIZE),
  });
  const unknownCountQuery = useQuery({
    queryKey: unknownCountQueryKey,
    queryFn: () => getData({ q: '', site: '', folder: '', unknown: true, offset: 0 }, 1),
  });
  const saveMutation = useMutation({
    mutationFn: saveOrigin,
    onSuccess: async () => {
      setSelectedRecord(null);
      showToast('Source saved');
      await queryClient.invalidateQueries({ queryKey: ['data'] });
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const batchSaveMutation = useMutation({
    mutationFn: async ({ records, site, ids }: {
      records: Origin[];
      site: Origin['sources'][number]['site'];
      ids: Record<string, string>;
    }) => {
      await Promise.all(records.map((record) => saveOrigin({
        hash: record.hash,
        site,
        id: ids[record.hash]?.trim() ?? '',
      })));
    },
    onSuccess: async (_, { records }) => {
      setBatchSheetOpen(false);
      setSelectedRecords([]);
      showToast(`Sources saved for ${records.length} ${records.length === 1 ? 'record' : 'records'}`);
      await queryClient.invalidateQueries({ queryKey: ['data'] });
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const bulkLookupMutation = useMutation({
    mutationFn: async (records: Origin[]) => {
      const report = {
        updated: 0,
        sorted: 0,
        batches: [] as number[],
        failures: [] as string[],
      };
      for (const record of records) {
        const source = lookupSource(record);
        const site = source ? lookupSite(source) : null;
        if (!source || !site) continue;
        try {
          const result = await lookupOrigin({ hash: record.hash, site, id: source.id });
          report.updated += 1;
          if (result.sorted_to) report.sorted += 1;
          if (result.batch !== null) report.batches.push(result.batch);
        } catch (error) {
          report.failures.push(`${record.name}: ${messageOf(error)}`);
        }
      }
      return report;
    },
    onSuccess: async (report) => {
      setSelectedRecords([]);
      const details = [
        `${report.updated} updated`,
        report.sorted ? `${report.sorted} sorted from the Inbox` : '',
        report.failures.length ? `${report.failures.length} failed: ${report.failures[0]}` : '',
      ].filter(Boolean);
      const undo = report.batches.length
        ? async () => {
          for (const batch of [...report.batches].reverse()) await undoActivity({ batch });
          await queryClient.invalidateQueries({ queryKey: ['data'] });
          await queryClient.invalidateQueries({ queryKey: ['inbox'] });
          await queryClient.invalidateQueries({ queryKey: ['library-images'] });
          await queryClient.invalidateQueries({ queryKey: ['library-folders'] });
          await queryClient.invalidateQueries({ queryKey: ['status'] });
          await queryClient.invalidateQueries({ queryKey: ['activity'] });
        }
        : undefined;
      showToast(`Metadata lookup: ${details.join('; ')}`, {
        error: report.failures.length > 0,
        undo,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['data'] }),
        queryClient.invalidateQueries({ queryKey: ['inbox'] }),
        queryClient.invalidateQueries({ queryKey: ['library-images'] }),
        queryClient.invalidateQueries({ queryKey: ['library-folders'] }),
        queryClient.invalidateQueries({ queryKey: ['status'] }),
        queryClient.invalidateQueries({ queryKey: ['activity'] }),
      ]);
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const toggleSelectedRecord = (record: Origin) => {
    setSelectedRecords((current) => {
      const present = current.some((entry) => entry.hash === record.hash);
      return present
        ? current.filter((entry) => entry.hash !== record.hash)
        : [...current, record];
    });
  };
  const toggleSelectedPage = (records: Origin[], checked: boolean) => {
    setSelectedRecords((current) => {
      if (!checked) {
        const pageHashes = new Set(records.map((record) => record.hash));
        return current.filter((record) => !pageHashes.has(record.hash));
      }
      const byHash = new Map(current.map((record) => [record.hash, record]));
      records.forEach((record) => byHash.set(record.hash, record));
      return [...byHash.values()];
    });
  };
  const selectAllUnknown = async () => {
    const total = unknownCountQuery.data?.total ?? 0;
    if (!total) {
      setSelectedRecords([]);
      return;
    }
    try {
      const result = await getData({
        q: '',
        site: '',
        folder: '',
        unknown: true,
        offset: 0,
      }, total);
      setSelectedRecords(result.items);
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const clearSelectedRecords = () => setSelectedRecords([]);

  return {
    filters,
    updateFilters,
    dataQuery,
    unknownCountQuery,
    saveMutation,
    selectedRecord,
    setSelectedRecord,
    pageSize: PAGE_SIZE,
    siteSchema,
    selectedRecords,
    toggleSelectedRecord,
    toggleSelectedPage,
    selectAllUnknown,
    clearSelectedRecords,
    batchSheetOpen,
    setBatchSheetOpen,
    batchSaveMutation,
    lookupableRecords,
    bulkLookupMutation,
  };
}
