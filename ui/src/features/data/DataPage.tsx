import { Icon } from '../../components/Icon';
import { Thumb } from '../../components/Thumb';
import { OriginDetails } from './components/OriginDetails';
import { SourceBadges } from './components/SourceBadges';
import { BatchSourceSheet } from './components/BatchSourceSheet';
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
  } = useDataPage();
  const error = dataQuery.error ?? unknownCountQuery.error;
  if (error) {
    return (
      <div className="page data-page">
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
  const selectedHashes = new Set(selectedRecords.map((record) => record.hash));
  const allPageSelected = items.length > 0 && items.every((record) => selectedHashes.has(record.hash));
  const allUnknownSelected = unknownCountQuery.data.total > 0
    && selectedRecords.length === unknownCountQuery.data.total;

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
          <option value="Konachan.net">Konachan.net</option>
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
      <div className={`row data-selection${selectedRecords.length ? ' active-selection' : ''}`}>
        <label className="check-row">
          <input
            type="checkbox"
            aria-label="Select all unknown records"
            checked={allUnknownSelected}
            onChange={(event) => {
              if (event.currentTarget.checked) void selectAllUnknown();
              else clearSelectedRecords();
            }}
          />
          Select all unknown
        </label>
        {selectedRecords.length ? (
          <>
            <span className="muted">{selectedRecords.length} selected</span>
            <button className="btn small primary" onClick={() => setBatchSheetOpen(true)}>
              Set sources ({selectedRecords.length})
            </button>
            <button
              className="btn small"
              type="button"
              disabled={!lookupableRecords.length || bulkLookupMutation.isPending}
              onClick={() => bulkLookupMutation.mutate(lookupableRecords)}
            >
              {bulkLookupMutation.isPending ? 'Looking up…' : `Look up tags (${lookupableRecords.length})`}
            </button>
            {lookupableRecords.length < selectedRecords.length ? (
              <span className="muted">
                {selectedRecords.length - lookupableRecords.length} selected {selectedRecords.length - lookupableRecords.length === 1 ? 'record has' : 'records have'} no supported site ID
              </span>
            ) : null}
            <button className="btn small" onClick={clearSelectedRecords}>Clear</button>
          </>
        ) : null}
      </div>
      <div className="spacer" />
      {result.total ? (
        <div>
          <table className="tbl">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all records on this page"
                    checked={allPageSelected}
                    onChange={(event) => toggleSelectedPage(items, event.currentTarget.checked)}
                  />
                </th>
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
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('input')) return;
                    setSelectedRecord(record);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setSelectedRecord(record);
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${record.name}`}
                      checked={selectedHashes.has(record.hash)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleSelectedRecord(record)}
                    />
                    <Thumb hash={record.hash} alt={record.name} />
                  </td>
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
      {batchSheetOpen && selectedRecords.length ? (
        <BatchSourceSheet
          records={selectedRecords}
          pending={batchSaveMutation.isPending}
          onClose={() => {
            if (!batchSaveMutation.isPending) setBatchSheetOpen(false);
          }}
          onSave={(site, ids) => batchSaveMutation.mutate({ records: selectedRecords, site, ids })}
        />
      ) : null}
    </div>
  );
}
