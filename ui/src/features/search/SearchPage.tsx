import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchPosts } from './api';
import { type SearchSite } from './schemas';

const sites: SearchSite[] = ['Wallhaven', 'Danbooru', 'yande.re', 'Safebooru'];

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function SearchPage() {
  const [site, setSite] = useState<SearchSite>('Wallhaven');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState<{ site: SearchSite; query: string; page: number } | null>(null);
  const [searchVersion, setSearchVersion] = useState(0);
  const resultsQuery = useQuery({
    queryKey: ['site-search', searchVersion, submitted?.site, submitted?.query, submitted?.page],
    queryFn: () => searchPosts(submitted!.site, submitted!.query, submitted!.page),
    enabled: submitted !== null,
    retry: false,
  });

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
              {resultsQuery.data.items.map((item) => (
                <article className="search-card" key={`${resultsQuery.data!.site}:${item.id}`}>
                  <img
                    className="search-preview"
                    src={item.preview}
                    alt={`${resultsQuery.data!.site} post ${item.id}`}
                    loading="lazy"
                  />
                  <div className="search-card-body">
                    <div className="row">
                      <span className="m">{item.id}</span>
                      <span className="badge">{item.rating}</span>
                      <span className="spacer" />
                      <a className="btn small" href={item.url} target="_blank" rel="noreferrer">Open post</a>
                    </div>
                    {item.tags.length ? (
                      <div className="search-tags">
                        {item.tags.slice(0, 12).map((tag) => <span className="tagchip" key={tag}>{tag}</span>)}
                      </div>
                    ) : <p className="muted">No tags returned</p>}
                  </div>
                </article>
              ))}
            </div>
          ) : <div className="empty"><b>No matching posts</b>Try different tags or widen the rating limit in Settings.</div>}
        </>
      ) : null}
    </div>
  );
}
