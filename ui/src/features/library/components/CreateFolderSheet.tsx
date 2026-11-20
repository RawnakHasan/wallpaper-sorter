import { useRef, useState } from 'react';
import { useNativeDialog } from '../../../components/useNativeDialog';

interface CreateFolderSheetProps {
  defaultPath: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (folder: string) => void;
}

export function CreateFolderSheet({ defaultPath, pending, error, onClose, onCreate }: CreateFolderSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  useNativeDialog(dialogRef);

  const submit = () => {
    const folder = inputRef.current?.value.trim() ?? '';
    if (!folder) {
      setLocalError('Enter a folder path.');
      return;
    }
    setLocalError(null);
    onCreate(folder);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label="New folder"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header><h2>New folder</h2></header>
      <div className="content">
        <div className="field">
          <label htmlFor="new-folder">Folder path</label>
          <input
            ref={inputRef}
            id="new-folder"
            className="input wide"
            defaultValue={defaultPath}
            placeholder="Folder path, for example Series/Violet"
            aria-label="New folder path"
          />
        </div>
        {localError || error ? <p className="error" role="alert">{localError ?? error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={submit}>Create folder</button>
      </footer>
    </dialog>
  );
}
