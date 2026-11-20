import { useRef, useState } from 'react';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { IntakeRequest } from '../api';
import type { IntakeDraft } from '../types';

interface IntakeSheetProps {
  draft: IntakeDraft;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (request: IntakeDraft & IntakeRequest) => void;
}

export function IntakeSheet({ draft, pending, error, onClose, onSave }: IntakeSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pathRef = useRef<HTMLInputElement>(null);
  const recursiveRef = useRef<HTMLInputElement>(null);
  const removeEmptyRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  useNativeDialog(dialogRef);

  const submit = () => {
    const request: IntakeDraft & IntakeRequest = {
      ...draft,
      path: (pathRef.current?.value ?? draft.path).trim(),
      recursive: recursiveRef.current?.checked ?? draft.recursive,
      remove_empty_folders: removeEmptyRef.current?.checked ?? draft.remove_empty_folders,
    };
    if (!request.path) {
      setLocalError('Folder path is required.');
      return;
    }
    setLocalError(null);
    onSave(request);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={draft.index === null ? 'Add intake folder' : 'Edit intake folder'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <h2>{draft.index === null ? 'Add intake folder' : 'Edit intake folder'}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" onClick={onClose}>×</button>
      </header>
      <div className="content">
        <div className="field">
          <label htmlFor="intake-folder-path">Folder path</label>
          <input
            ref={pathRef}
            id="intake-folder-path"
            className="input wide"
            defaultValue={draft.path}
            aria-label="Intake folder path"
            placeholder="/absolute/path/to/downloads"
          />
        </div>
        <div className="field">
          <div className="check-row">
            <input ref={recursiveRef} type="checkbox" id="intake-recursive" defaultChecked={draft.recursive} />
            <label htmlFor="intake-recursive">Include subfolders</label>
          </div>
        </div>
        <div className="field">
          <div className="check-row">
            <input ref={removeEmptyRef} type="checkbox" id="intake-remove-empty" defaultChecked={draft.remove_empty_folders} />
            <label htmlFor="intake-remove-empty">Remove empty subfolders</label>
          </div>
          <span className="faint">Off by default. Hidden folders are never removed.</span>
        </div>
        {localError || error ? <p className="error" role="alert">{localError ?? error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={submit}>Save</button>
      </footer>
    </dialog>
  );
}
