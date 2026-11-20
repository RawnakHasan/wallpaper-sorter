import { Link } from '@tanstack/react-router';
import { Thumb } from '../../components/Thumb';
import { RestoreDuplicateSheet } from './components/RestoreDuplicateSheet';
import { useDuplicatesPage } from './hooks/useDuplicatesPage';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function parentFolder(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

export function DuplicatesPage() {
  const {
    duplicatesQuery,
    statusQuery,
    foldersQuery,
    restoreItem,
    restoreFolder,
    setRestoreFolder,
    restoreError,
    restoreMutation,
    deleteMutation,
    emptyMutation,
    openRestore,
    closeRestore,
    restore,
    deleteItem,
    emptyFolder,
  } = useDuplicatesPage();

  const error = duplicatesQuery.error ?? statusQuery.error;
  if (error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(error)}</p>
        <button className="btn" onClick={() => { void duplicatesQuery.refetch(); void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!duplicatesQuery.data || !statusQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const items = duplicatesQuery.data;
  const duplicateFolder = statusQuery.data.settings.duplicates_folder;
  const total = items.reduce((sum, item) => sum + item.size, 0);
  const folders = (foldersQuery.data ?? []).filter((folder) =>
    folder.path !== duplicateFolder && !folder.path.startsWith(`${duplicateFolder}/`)
  );
  return (
    <div className="page">
      <div className="page-head">
        <h1>Duplicates</h1>
        {items.length ? <span className="sub">{items.length} {items.length === 1 ? 'copy' : 'copies'}, {formatBytes(total)}</span> : null}
        <span className="spacer" />
        {items.length ? (
          <button className="btn danger" disabled={emptyMutation.isPending} onClick={() => { void emptyFolder(items.length, total); }}>
            Empty {duplicateFolder} folder
          </button>
        ) : null}
      </div>
      {items.length ? (
        <div className="list">
          {items.map((item) => {
            return (
              <div key={item.path}>
                <span className="list-thumb"><Thumb hash={item.hash ?? ''} alt={item.name} /></span>
                <div className="grow">
                  <div className="m">{item.name}</div>
                  <div className="muted">
                    Same as{' '}
                    {item.duplicate_of !== null && !item.duplicate_of.startsWith('/') ? (
                      <Link
                        to="/library"
                        search={{ folder: parentFolder(item.duplicate_of) }}
                        className="m"
                      >
                        {item.duplicate_of}
                      </Link>
                    ) : <span className="m">{item.duplicate_of || 'an image in the library'}</span>}
                    {' · '}{formatBytes(item.size)}
                  </div>
                </div>
                <div className="row actions">
                  <button className="btn small" onClick={() => { void openRestore(item); }}>Restore…</button>
                  <button className="btn small danger" disabled={deleteMutation.isPending} onClick={() => { void deleteItem(item); }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : <div className="empty"><b>No duplicates</b>Copies of images you already have are moved here instead of being sorted twice.</div>}
      {restoreItem ? (
        <RestoreDuplicateSheet
          item={restoreItem}
          folders={folders}
          foldersPending={foldersQuery.isPending}
          foldersError={foldersQuery.error}
          folder={restoreFolder}
          error={restoreError}
          pending={restoreMutation.isPending}
          onFolderChange={setRestoreFolder}
          onClose={closeRestore}
          onRetryFolders={() => { void foldersQuery.refetch(); }}
          onRestore={restore}
        />
      ) : null}
    </div>
  );
}
