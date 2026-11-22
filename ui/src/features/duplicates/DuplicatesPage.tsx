import { Link } from '@tanstack/react-router';
import { useState } from 'react';
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
  const [tab, setTab] = useState<'exact' | 'lookalikes'>('exact');
  const [similarity, setSimilarity] = useState(90);
  const [lookAlikes, setLookAlikes] = useState([
    {
      id: 1,
      similarity: 97,
      files: ['sky-014.png', 'sky-014-small.jpg'],
    },
    {
      id: 2,
      similarity: 93,
      files: ['mtn-007.jpg', 'IMG_2041-edit.webp'],
    },
  ]);
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
      <div className="page duplicates-page">
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
      <div className="duplicate-tabs segmented-control" role="tablist" aria-label="Duplicate type">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'exact'}
          onClick={() => setTab('exact')}
        >
          Exact <span className="mono">{items.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'lookalikes'}
          onClick={() => setTab('lookalikes')}
        >
          Look-alikes <span className="mono">{lookAlikes.filter((group) => group.similarity >= similarity).length}</span>
        </button>
      </div>
      {tab === 'exact' ? (items.length ? (
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
      ) : (
        <div className="empty"><b>No duplicates</b>Copies of images you already have are moved here instead of being sorted twice.</div>
      )) : (
        <div className="lookalike-panel">
          <div className="panel lookalike-controls">
            <label>
              <span className="label">Similarity</span>
              <select
                className="select"
                aria-label="Similarity"
                value={similarity}
                onChange={(event) => setSimilarity(Number(event.currentTarget.value))}
              >
                <option value={90}>Balanced · 90%</option>
                <option value={95}>Strict · 95%</option>
                <option value={80}>Loose · 80%</option>
              </select>
            </label>
            <button className="button button-primary" type="button" onClick={() => setLookAlikes((current) => [...current])}>
              Scan library
            </button>
            <p className="sub">Compares image fingerprints. Nothing moves until you choose.</p>
          </div>
          {lookAlikes.filter((group) => group.similarity >= similarity).map((group) => (
            <section className="panel lookalike-group" key={group.id}>
              <div className="lookalike-head">
                <span>{group.files.length} images · <b className="mono">{group.similarity}%</b> alike</span>
                <div className="row">
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => setLookAlikes((current) => current.filter((entry) => entry.id !== group.id))}
                  >
                    Keep best, trash the rest
                  </button>
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => setLookAlikes((current) => current.filter((entry) => entry.id !== group.id))}
                  >
                    Not duplicates
                  </button>
                </div>
              </div>
              {group.files.map((file, index) => (
                <div className="lookalike-file" key={file}>
                  <span className="mono">{file}</span>
                  {index === 0 ? <span className="chip c-ok">Best</span> : <span className="chip">Candidate</span>}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
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
