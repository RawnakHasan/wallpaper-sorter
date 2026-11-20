import { useRef } from 'react';
import { FolderPicker } from '../../../components/FolderPicker';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { DuplicateItem } from '../schemas';

interface RestoreDuplicateSheetProps {
  item: DuplicateItem;
  folders: { path: string }[];
  foldersPending: boolean;
  foldersError: unknown;
  folder: string;
  error: string | null;
  pending: boolean;
  onFolderChange: (folder: string) => void;
  onClose: () => void;
  onRetryFolders: () => void;
  onRestore: (folder: string) => void;
}

export function RestoreDuplicateSheet({
  item,
  folders,
  foldersPending,
  foldersError,
  folder,
  error,
  pending,
  onFolderChange,
  onClose,
  onRetryFolders,
  onRestore,
}: RestoreDuplicateSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useNativeDialog(dialogRef);

  const restore = () => {
    const nextFolder = (inputRef.current?.value ?? folder).trim();
    onRestore(nextFolder);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label="Restore duplicate"
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <header>
        <h2>Restore duplicate</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" onClick={onClose}>×</button>
      </header>
      <div className="content">
        <p className="muted">{item.name}</p>
        {foldersPending ? <p className="muted">Loading folders…</p> : foldersError ? (
          <div>
            <p className="error" role="alert">{foldersError instanceof Error ? foldersError.message : String(foldersError)}</p>
            <button className="btn" onClick={onRetryFolders}>Try again</button>
          </div>
        ) : (
          <div className="field">
            <span className="lbl">Folder</span>
            <FolderPicker folders={folders} value={folder} onChange={onFolderChange} inputRef={inputRef} />
          </div>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={foldersPending || !!foldersError || pending} onClick={restore}>
          Restore as new image
        </button>
      </footer>
    </dialog>
  );
}
