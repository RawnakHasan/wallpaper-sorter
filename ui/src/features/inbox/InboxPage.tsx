import { ImageGrid, type GridItem } from '../../components/ImageGrid';
import { SelectionBar } from '../../components/SelectionBar';
import { useSelectionStore } from '../../stores/selection';
import { AssignSheet } from './components/AssignSheet';
import { InboxDetail } from './components/InboxDetail';
import { useInboxActions } from './hooks/useInboxActions';
import { useInboxQueries } from './hooks/useInboxQueries';
import { basename, messageOf, reasonLabels } from './utils';

export function InboxPage() {
  const { inboxQuery, statusQuery, allItems, items, intakes, filters, setReason, setIntake } = useInboxQueries();
  const selectionKeys = useSelectionStore((state) => state.keys);
  const allKeys = items.map((item) => item.path);
  const actions = useInboxActions({
    items,
    allKeys,
    hasInboxData: Boolean(inboxQuery.data),
    status: statusQuery.data,
  });
  const {
    selectedItem, setSelectedItem, assignFiles, setAssignFiles, assignError, setAssignError,
    assignTagSeed, setAssignTagSeed, thumbVersions, assignData, assignMutation, deleteMutation,
    sourceMutation, lookupMutation, openAssign,
    deleteFiles, selectedFiles, rebuildThumbnails,
  } = actions;
  const gridItems: GridItem[] = items.map((item) => ({
    key: item.path,
    hash: item.origin?.hash ?? null,
    thumbVersion: item.origin?.hash ? thumbVersions[item.origin.hash] ?? 0 : 0,
    name: item.name,
    sub: item.origin?.sources.filter((source) => source.site !== 'Unknown').map((source) => source.site).join(', ') ?? '',
    label: reasonLabels[item.reason],
    labelClass: item.reason,
    title: item.reason === 'conflict'
      ? `These tags clash: ${item.matched.join(', ')}`
      : item.reason === 'ready'
        ? 'A tag matches now; the next scan sorts it'
        : 'No tag matches this name',
    onOpen: () => setSelectedItem(item),
  }));

  const error = inboxQuery.error ?? statusQuery.error;
  if (error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(error)}</p>
        <button className="btn" onClick={() => { void inboxQuery.refetch(); void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!inboxQuery.data || !statusQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inbox</h1>
        {allItems.length ? <span className="sub">{allItems.length} waiting</span> : null}
        <span className="spacer" />
        <div className="row">
          <select
            className="select"
            aria-label="Filter by reason"
            value={filters.reason}
            onChange={(event) => setReason(event.currentTarget.value as typeof filters.reason)}
          >
            <option value="">Any reason</option>
            <option value="no_match">No match</option>
            <option value="conflict">Conflict</option>
            <option value="ready">Ready</option>
          </select>
          {intakes.length > 1 ? (
            <select
              className="select"
              aria-label="Filter by folder"
              value={filters.intake}
              onChange={(event) => setIntake(event.currentTarget.value)}
            >
              <option value="">All folders</option>
              {intakes.map((intake) => (
                <option key={intake} value={intake}>{intake === 'library' ? 'Library folder' : basename(intake)}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
      {allItems.length === 0 ? (
        <div className="empty"><b>Inbox clear</b>Images that cannot be sorted by their name wait here.</div>
      ) : items.length === 0 ? (
        <div className="empty"><b>Nothing matches these filters</b></div>
      ) : null}
      <SelectionBar
        allKeys={allKeys}
        actions={[
          { label: 'Assign to folder…', className: 'primary', onClick: () => { void openAssign(selectedFiles()); } },
          { label: 'Rebuild thumbnails', onClick: () => { void rebuildThumbnails(items.filter((item) => selectionKeys.has(item.path)).map((item) => item.origin?.hash)); } },
          { label: 'Delete', className: 'danger', onClick: () => { void deleteFiles(selectedFiles()); } },
        ]}
      />
      {items.length ? <ImageGrid items={gridItems} /> : null}
      {selectedItem ? (
        <InboxDetail
          key={selectedItem.path}
          item={selectedItem}
          pending={deleteMutation.isPending || assignMutation.isPending}
          onClose={() => setSelectedItem(null)}
          onAssign={() => {
            const file = {
              path: selectedItem.path,
              name: selectedItem.name,
              tags: selectedItem.origin?.tags ?? [],
            };
            setSelectedItem(null);
            void openAssign([file]);
          }}
          onAssignCandidate={(folder) => {
            const path = selectedItem.path;
            setSelectedItem(null);
            assignMutation.mutate({ paths: [path], folder });
          }}
          onDelete={() => {
            const file = { path: selectedItem.path, name: selectedItem.name, tags: [] };
            setSelectedItem(null);
            void deleteFiles([file]);
          }}
          onRebuild={(hash) => { void rebuildThumbnails([hash]); }}
          onCreateTag={(keywords) => {
            const file = {
              path: selectedItem.path,
              name: selectedItem.name,
              tags: selectedItem.origin?.tags ?? [],
            };
            setSelectedItem(null);
            void openAssign([file], keywords);
          }}
          sourcePending={sourceMutation.isPending || lookupMutation.isPending}
          onSaveSource={(request) => sourceMutation.mutate(request)}
          onLookupSource={(request) => lookupMutation.mutate(request)}
        />
      ) : null}
      {assignFiles && assignData.current ? (
        <AssignSheet
          files={assignFiles}
          folders={assignData.current.folders}
          tags={assignData.current.tags}
          duplicateFolder={assignData.current.duplicateFolder}
          pending={assignMutation.isPending}
          error={assignError}
          initialTagKeywords={assignTagSeed}
          onClose={() => {
            if (assignMutation.isPending) return;
            setAssignFiles(null);
            setAssignTagSeed([]);
            setAssignError(null);
          }}
          onSubmit={(request) => {
            setAssignError(null);
            assignMutation.mutate(request);
          }}
        />
      ) : null}
    </div>
  );
}
