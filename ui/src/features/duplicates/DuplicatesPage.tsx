import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { confirmDialog } from '../../components/dialogs';
import { FolderPicker } from '../../components/FolderPicker';
import { Thumb } from '../../components/Thumb';
import { undoActivity } from '../activity/api';
import { statusQueryKey, getStatus } from '../status/api';
import { useToastStore } from '../../stores/toast';
import {
  deleteDuplicates,
  duplicateFoldersQueryKey,
  duplicatesQueryKey,
  emptyDuplicates,
  getDuplicateFolders,
  getDuplicates,
  restoreDuplicate,
} from './api';
import type { DuplicateItem } from './schemas';

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
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [restoreItem, setRestoreItem] = useState<DuplicateItem | null>(null);
  const [restoreFolder, setRestoreFolder] = useState('');
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const restoreFolderInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const duplicatesQuery = useQuery({ queryKey: duplicatesQueryKey, queryFn: getDuplicates });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const foldersQuery = useQuery({
    queryKey: duplicateFoldersQueryKey,
    queryFn: getDuplicateFolders,
    enabled: restoreItem !== null,
  });

  useEffect(() => {
    if (!restoreItem) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [restoreItem]);

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: duplicatesQueryKey }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshQueries();
  };

  const deleteMutation = useMutation({
    mutationFn: deleteDuplicates,
    onSuccess: async (result) => {
      showToast(`Deleted ${result.done.length} ${result.done.length === 1 ? 'image' : 'images'}`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const emptyMutation = useMutation({
    mutationFn: emptyDuplicates,
    onSuccess: async (result) => {
      showToast(`Moved ${result.done.length} ${result.done.length === 1 ? 'copy' : 'copies'} to the trash`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const restoreMutation = useMutation({
    mutationFn: restoreDuplicate,
    onSuccess: async (result) => {
      setRestoreItem(null);
      setRestoreFolder('');
      showToast(`Restored ${result.done.length} ${result.done.length === 1 ? 'copy' : 'copies'} as new images`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => setRestoreError(messageOf(error)),
  });

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
  const openRestore = async (item: DuplicateItem) => {
    try {
      await queryClient.fetchQuery({
        queryKey: duplicateFoldersQueryKey,
        queryFn: getDuplicateFolders,
      });
    } catch (error) {
      showToast(messageOf(error), { error: true });
      return;
    }
    setRestoreError(null);
    setRestoreFolder('');
    setRestoreItem(item);
  };
  const closeRestore = () => {
    if (restoreMutation.isPending) return;
    setRestoreItem(null);
    setRestoreFolder('');
    setRestoreError(null);
  };
  const restore = () => {
    const folder = (restoreFolderInput.current?.value ?? restoreFolder).trim();
    if (!folder) {
      setRestoreError('Choose a folder.');
      return;
    }
    if (!restoreItem) return;
    setRestoreError(null);
    restoreMutation.mutate({ paths: [restoreItem.path], folder });
  };
  const deleteItem = async (item: DuplicateItem) => {
    const confirmed = await confirmDialog(
      `Delete ${item.name}? It goes to the trash and can be undone.`,
      'Delete',
      true,
    );
    if (confirmed) deleteMutation.mutate({ paths: [item.path] });
  };
  const emptyFolder = async () => {
    const confirmed = await confirmDialog(
      `Move all ${items.length} copies (${formatBytes(total)}) to the trash? You can undo this.`,
      'Move to trash',
      true,
    );
    if (confirmed) emptyMutation.mutate();
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Duplicates</h1>
        {items.length ? <span className="sub">{items.length} {items.length === 1 ? 'copy' : 'copies'}, {formatBytes(total)}</span> : null}
        <span className="spacer" />
        {items.length ? (
          <button className="btn danger" disabled={emptyMutation.isPending} onClick={() => { void emptyFolder(); }}>
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
        <dialog
          ref={dialogRef}
          className="sheet"
          aria-label="Restore duplicate"
          aria-modal="true"
          onCancel={(event) => {
            event.preventDefault();
            closeRestore();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeRestore();
          }}
        >
          <header>
            <h2>Restore duplicate</h2>
            <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" onClick={closeRestore}>×</button>
          </header>
          <div className="content">
            <p className="muted">{restoreItem.name}</p>
            {foldersQuery.isPending ? <p className="muted">Loading folders…</p> : foldersQuery.error ? (
              <div>
                <p className="error" role="alert">{messageOf(foldersQuery.error)}</p>
                <button className="btn" onClick={() => { void foldersQuery.refetch(); }}>Try again</button>
              </div>
            ) : (
              <div className="field">
                <span className="lbl">Folder</span>
                <FolderPicker folders={folders} value={restoreFolder} onChange={setRestoreFolder} inputRef={restoreFolderInput} />
              </div>
            )}
            {restoreError ? <p className="error" role="alert">{restoreError}</p> : null}
          </div>
          <footer>
            <button className="btn" type="button" onClick={closeRestore}>Cancel</button>
            <button
              className="btn primary"
              type="button"
              disabled={foldersQuery.isPending || !!foldersQuery.error || restoreMutation.isPending}
              onClick={restore}
            >
              Restore as new image
            </button>
          </footer>
        </dialog>
      ) : null}
    </div>
  );
}
