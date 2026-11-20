import { Icon } from '../../components/Icon';
import { Thumb } from '../../components/Thumb';
import { OriginDetails } from './components/OriginDetails';
import { SourceBadges } from './components/SourceBadges';
import { useDataPage } from './hooks/useDataPage';
import { formatDateTime, messageOf } from './utils';

export function DataPage() {
  const {
    filters,
    updateFilters,
    dataQuery,
    unknownCountQuery,
    saveMutation,
    selectedRecord,
    setSelectedRecord,
    pageSize,
    siteSchema,
  } = useDataPage();
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
                  <td><SourceBadges sources={record.sources} /></td>
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
              onClick={() => updateFilters({ offset: Math.max(0, filters.offset - pageSize) })}
            >
              <Icon name="previous" />
            </button>
            <button
              className="btn small icon-btn"
              type="button"
              aria-label="Next page"
              title="Next page"
              disabled={last >= result.total}
              onClick={() => updateFilters({ offset: filters.offset + pageSize })}
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
