import { Fragment, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Icon } from '../../components/Icon';
import { Thumb } from '../../components/Thumb';
import { useToastStore } from '../../stores/toast';
import { dataQueryKey, getData, saveOrigin, unknownCountQueryKey } from './api';
import type { DataFilters } from './api';
import { siteSchema, type Origin, type OriginSource, type Site } from './schemas';

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

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatDateTime(seconds: number) {
  return seconds ? new Date(seconds * 1000).toLocaleString() : '';
}

function safeUrl(value?: string) {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

function sourceBadges(sources: OriginSource[]) {
  const shown = sources.filter((source) => source.site !== 'Unknown');
  return shown.length
    ? shown.map((source, index) => (
      <span className="badge" key={`${source.site}-${source.id}-${index}`}>
        {source.id ? `${source.site} ${source.id}` : source.site}
      </span>
    ))
    : <span className="badge">Unknown source</span>;
}

interface OriginDetailsProps {
  record: Origin;
  pending: boolean;
  onClose: () => void;
  onSave: (request: { hash: string; site: Site; id: string }) => void;
}

function OriginDetails({ record, pending, onClose, onSave }: OriginDetailsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const siteRef = useRef<HTMLSelectElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const firstSource = record.sources[0];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

  const save = () => {
    const site = siteSchema.parse(siteRef.current?.value);
    onSave({
      hash: record.hash,
      site,
      id: idRef.current?.value.trim() ?? '',
    });
  };

  const rows: Array<[string, string]> = [
    ['File', record.name],
    ['Folder', record.folder || 'the library folder'],
    ['Original name', record.original_name],
  ];
  if (record.width) rows.push(['Resolution', `${record.width} × ${record.height ?? ''}`]);
  rows.push(['Added', formatDateTime(record.added)]);
  if (record.note) rows.push(['Why here', record.note]);

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={record.name}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <header>
        <h2>{record.name}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        <img className="preview" src={`/api/image/${record.hash}`} alt={record.name} />
        <div className="kv">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <div>{label}</div>
              <div className="m">{value}</div>
            </Fragment>
          ))}
        </div>
        {record.sources.map((source, index) => {
          const url = safeUrl(source.url);
          return (
            <div className="kv" key={`${source.site}-${source.id}-${index}`}>
              <div>Source</div>
              <div>
                <span className="badge">{source.site}</span>
                {source.id ? <> <span className="m">{source.id}</span></> : null}
                {url ? <> <a href={url} target="_blank" rel="noopener noreferrer">open page</a></> : null}
                {source.artist ? (
                  <div className="muted">
                    Artist: {source.artist}{source.artist_id ? ` (${source.artist_id})` : ''}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        <div className="field">
          <span className="lbl">Set the source by hand</span>
          <div className="row">
            <select ref={siteRef} className="select" aria-label="Site" defaultValue={firstSource?.site ?? 'Unknown'}>
              <option value="Wallhaven">Wallhaven</option>
              <option value="Zerochan">Zerochan</option>
              <option value="Konachan">Konachan</option>
              <option value="yande.re">yande.re</option>
              <option value="Danbooru">Danbooru</option>
              <option value="Safebooru">Safebooru</option>
              <option value="Pixiv">Pixiv</option>
              <option value="Unknown">Unknown</option>
            </select>
            <input
              ref={idRef}
              className="input"
              defaultValue={firstSource?.id ?? ''}
              aria-label="Id on the site"
              placeholder="id on the site"
            />
            <button className="btn" type="button" disabled={pending} onClick={save}>Save source</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
export function DataPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/data' });
  const routeSearch = useSearch({ from: '/data' });
  const showToast = useToastStore((state) => state.show);
  const [filters, setFilters] = useState<PageFilters>(() => routeSearch.q === undefined
    ? retainedFilters
    : { ...retainedFilters, q: routeSearch.q, searchText: routeSearch.q, offset: 0 });
  const filtersRef = useRef(filters);
  const [selectedRecord, setSelectedRecord] = useState<Origin | null>(null);

  const updateFilters = (patch: Partial<PageFilters>) => {
    const next = { ...filtersRef.current, ...patch };
    filtersRef.current = next;
    retainedFilters = next;
    setFilters(next);
  };

  useEffect(() => {
    if (routeSearch.q === undefined) return;
    updateFilters({ q: routeSearch.q, searchText: routeSearch.q, offset: 0 });
    void navigate({ search: { q: undefined }, replace: true });
  }, [navigate, routeSearch.q]);

  useEffect(() => {
    if (filters.searchText.trim() === filters.q) return;
    const timer = window.setTimeout(() => {
      updateFilters({ q: filters.searchText.trim(), offset: 0 });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [filters.searchText]);

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

  const error = dataQuery.error ?? unknownCountQuery.error;
  if (error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(error)}</p>
        <button className="btn" onClick={() => { void dataQuery.refetch(); void unknownCountQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!dataQuery.data || !unknownCountQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const result = dataQuery.data;
  const items = result.items;
  const first = result.total ? result.offset + 1 : 0;
  const last = result.offset + items.length;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Data</h1>
        <span className="sub">Where each image came from</span>
      </div>
      <div className="row">
        <input
          className="input"
          id="data-q"
          value={filters.searchText}
          placeholder="Search name or id"
          aria-label="Search"
          onChange={(event) => updateFilters({ searchText: event.currentTarget.value })}
          onInput={(event) => updateFilters({ searchText: event.currentTarget.value })}
        />
        <select
          className="select"
          aria-label="Site"
          value={filters.site}
          onChange={(event) => {
            const value = event.currentTarget.value;
            updateFilters({ site: value ? siteSchema.parse(value) : '', offset: 0 });
          }}
        >
          <option value="">All sites</option>
          <option value="Wallhaven">Wallhaven</option>
          <option value="Zerochan">Zerochan</option>
          <option value="Konachan">Konachan</option>
          <option value="yande.re">yande.re</option>
          <option value="Danbooru">Danbooru</option>
          <option value="Safebooru">Safebooru</option>
          <option value="Pixiv">Pixiv</option>
          <option value="Unknown">Unknown</option>
        </select>
        <input
          className="input"
          id="data-folder"
          value={filters.folderText}
          placeholder="Folder"
          aria-label="Folder"
          onChange={(event) => updateFilters({ folderText: event.currentTarget.value })}
          onInput={(event) => updateFilters({ folderText: event.currentTarget.value })}
        />
        <button
          className={`btn${filters.unknown ? ' primary' : ''}`}
          aria-pressed={filters.unknown}
          onClick={() => updateFilters({ unknown: !filters.unknown, offset: 0 })}
        >
          Unknown source ({unknownCountQuery.data.total})
        </button>
      </div>
      <div className="spacer" />
      {result.total ? (
        <div>
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th className="hide-s">Folder</th>
                <th>Source</th>
                <th className="hide-s">Original name</th>
                <th className="hide-s">Size</th>
                <th className="hide-s">Added</th>
              </tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr
                  key={record.path}
                  className="click"
                  tabIndex={0}
                  onClick={() => setSelectedRecord(record)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSelectedRecord(record);
                  }}
                >
                  <td><Thumb hash={record.hash} alt={record.name} /></td>
                  <td className="m" title={record.path}>{record.name}</td>
                  <td className="m hide-s">{record.folder}</td>
                  <td>{sourceBadges(record.sources)}</td>
                  <td className="m hide-s" title={record.original_name}>{record.original_name}</td>
                  <td className="m hide-s">{record.width ? `${record.width} × ${record.height ?? ''}` : ''}</td>
                  <td className="hide-s">{formatDateTime(record.added)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row data-pager">
            <span className="muted">{first}–{last} of {result.total}</span>
            <button
              className="btn small icon-btn"
              type="button"
              aria-label="Previous page"
              title="Previous page"
              disabled={result.offset === 0}
              onClick={() => updateFilters({ offset: Math.max(0, filters.offset - PAGE_SIZE) })}
            >
              <Icon name="previous" />
            </button>
            <button
              className="btn small icon-btn"
              type="button"
              aria-label="Next page"
              title="Next page"
              disabled={last >= result.total}
              onClick={() => updateFilters({ offset: filters.offset + PAGE_SIZE })}
            >
              <Icon name="next" />
            </button>
          </div>
        </div>
      ) : (
        <div className="empty">
          <b>No records match</b>
          Every image gets a record when it arrives or when the library is first opened.
        </div>
      )}
      {selectedRecord ? (
        <OriginDetails
          key={selectedRecord.hash}
          record={selectedRecord}
          pending={saveMutation.isPending}
          onClose={() => {
            if (!saveMutation.isPending) setSelectedRecord(null);
          }}
          onSave={(request) => saveMutation.mutate(request)}
        />
      ) : null}
    </div>
  );
}
