import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../stores/toast';
import { fetchJobQueryKey, getFetchJob, submitFetch } from '../fetch/api';
import { searchPosts } from './api';
import { SearchImageSheet } from './components/SearchImageSheet';
import { type SearchResults, type SearchSite } from './schemas';

const sites: SearchSite[] = ['Wallhaven', 'Danbooru', 'yande.re', 'Safebooru', 'Konachan.net'];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function SearchPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [site, setSite] = useState<SearchSite>('Wallhaven');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState<{ site: SearchSite; query: string; page: number } | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);
  const [downloadJobId, setDownloadJobId] = useState<number | null>(null);
  const reportedJobId = useRef<number | null>(null);
  const downloadMutation = useMutation({
    mutationFn: ({ postSite, id }: { postSite: SearchSite; id: string }) =>
      submitFetch({ items: [{ site: postSite, input: id }] }),
    onSuccess: (job) => {
      reportedJobId.current = null;
      setDownloadJobId(job.id);
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const downloadJobQuery = useQuery({
    queryKey: downloadJobId === null ? ['fetch-job', null] : fetchJobQueryKey(downloadJobId),
    queryFn: () => getFetchJob(downloadJobId!),
    enabled: downloadJobId !== null,
    refetchInterval: (queryState) => queryState.state.data?.done ? false : 750,
  });
  const resultsQuery = useQuery({
    queryKey: ['site-search', searchVersion, submitted?.site, submitted?.query, submitted?.page],
    queryFn: () => searchPosts(submitted!.site, submitted!.query, submitted!.page),
    enabled: submitted !== null,
    retry: false,
  });

  useEffect(() => {
    if (downloadJobId !== null && downloadJobQuery.isError) {
      showToast(messageOf(downloadJobQuery.error), { error: true });
      setDownloadJobId(null);
      return;
    }
    const job = downloadJobQuery.data;
    if (!job?.done || downloadJobId === null || reportedJobId.current === downloadJobId) return;
    reportedJobId.current = downloadJobId;
    const result = job.items[0];
    if (result?.state === 'sorted') {
      showToast(`Downloaded and sorted to ${result.location ?? 'a folder'}`, { success: true });
    } else if (result?.state === 'inbox') {
      showToast('Downloaded to the Inbox', { success: true });
    } else if (result?.state === 'duplicate') {
      showToast('That image is already in the library');
    } else {
      showToast(result?.message ?? 'The download failed', { error: true });
    }
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['library'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: ['status'] }),
    ]);
    setDownloadJobId(null);
  }, [downloadJobId, downloadJobQuery.data, downloadJobQuery.error, downloadJobQuery.isError, queryClient, showToast]);

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSelectedItemIndex(null);
    setSubmitted({ site, query: query.trim(), page: 1 });
    setSearchVersion((version) => version + 1);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Browse sites</h1>
        <span className="sub">Search public posts using each site’s API</span>
      </div>
      <form className="panel" onSubmit={search}>
        <div className="row search-controls">
          <label className="field">
            <span className="lbl">Site</span>
            <select
              className="select"
              aria-label="Site"
              value={site}
              onChange={(event) => setSite(event.currentTarget.value as SearchSite)}
            >
              {sites.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              <option value="" disabled>Zerochan (browsing unavailable)</option>
            </select>
          </label>
          <label className="field search-query">
            <span className="lbl">Tags or search terms</span>
            <input
              className="input"
              aria-label="Tags or search terms"
              maxLength={300}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="anime girls beach"
            />
          </label>
          <button className="btn primary" type="submit" disabled={resultsQuery.isFetching}>
            {resultsQuery.isFetching ? 'Searching…' : 'Search'}
          </button>
        </div>
        <p className="muted">Leave the query blank to browse recent posts. Results respect the rating limits in Settings.</p>
        <p className="muted">Zerochan browsing is not implemented. You can still fetch Zerochan posts from the Fetch box.</p>
      </form>

      {resultsQuery.isError ? <p className="error" role="alert">{messageOf(resultsQuery.error)}</p> : null}
      {resultsQuery.isPending && submitted ? <p className="muted" role="status">Searching…</p> : null}
      {resultsQuery.data ? (
        <>
          <div className="page-head">
            <span className="sub">
              {resultsQuery.data.items.length} results · {resultsQuery.data.site} · page {resultsQuery.data.page}
            </span>
            <span className="spacer" />
            <button
              className="btn"
              type="button"
              disabled={submitted!.page <= 1 || resultsQuery.isFetching}
              onClick={() => setSubmitted({ ...submitted!, page: submitted!.page - 1 })}
            >
              Previous
            </button>
            <button
              className="btn"
              type="button"
              disabled={!resultsQuery.data.has_more || resultsQuery.isFetching}
              onClick={() => setSubmitted({ ...submitted!, page: submitted!.page + 1 })}
            >
              Next
            </button>
          </div>
          {resultsQuery.data.items.length ? (
            <div className="search-grid">
              {resultsQuery.data.items.map((item, index) => (
                <article className="search-card" key={`${resultsQuery.data!.site}:${item.id}`}>
                  <button
                    className="search-preview-button"
                    type="button"
                    aria-label={`View image ${item.id}`}
                    onClick={() => setSelectedItemIndex(index)}
                  >
                    <img
                      className="search-preview"
                      src={item.preview}
                      alt={`${resultsQuery.data!.site} post ${item.id}`}
                      loading="lazy"
                    />
                  </button>
                  <div className="search-card-body">
                    <div className="row">
                      <span className="m">{item.id}</span>
                      <span className="badge">{item.rating}</span>
                      <span className="spacer" />
                      <a className="btn small" href={item.url} target="_blank" rel="noreferrer">Open post</a>
                    </div>
                    <div className="row">
                      <button className="btn small" type="button" onClick={() => setSelectedItemIndex(index)}>
                        View image and tags
                      </button>
                      <button
                        className="btn small"
                        type="button"
                        disabled={downloadMutation.isPending || downloadJobId !== null}
                        onClick={() => downloadMutation.mutate({
                          postSite: resultsQuery.data!.site as SearchSite,
                          id: item.id,
                        })}
                      >
                        Download
                      </button>
                    </div>
                    {item.tags.length ? (
                      <div className="search-tags">
                        {item.tags.slice(0, 12).map((tag) => <span className="tagchip" key={tag}>{tag}</span>)}
                      </div>
                    ) : resultsQuery.data.site === 'Wallhaven'
                      ? <p className="muted">Open the image to load its tags</p>
                      : <p className="muted">No tags returned</p>}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty"><b>No matching posts</b>Try different tags or widen the rating limit in Settings.</div>}
        </>
      ) : null}
      {selectedItemIndex !== null && submitted && resultsQuery.data?.items[selectedItemIndex] ? (
        <SearchImageSheet
          site={submitted.site}
          items={resultsQuery.data.items}
          initialIndex={selectedItemIndex}
          onClose={() => setSelectedItemIndex(null)}
        />
      ) : null}
    </div>
  );
}
