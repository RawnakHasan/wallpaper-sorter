import { useRef, useState } from 'react';
import { FolderPicker } from '../../../components/FolderPicker';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { AssignFilesRequest } from '../../files/schemas';
import type { Tag } from '../../tags/schemas';
import type { LibraryFolder } from '../schemas';
import type { LibraryFile } from '../types';

interface MoveSheetProps {
  files: LibraryFile[];
  folders: LibraryFolder[];
  tags: Tag[];
  duplicateFolder: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (request: AssignFilesRequest) => void;
}

export function MoveSheet({ files, folders, tags, duplicateFolder, pending, error, onClose, onSubmit }: MoveSheetProps) {
  const [folder, setFolder] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef);
  const firstFile = files[0];
  const selectedFolder = folders.find((entry) => entry.path === folder);
  const savedTag = tags.find((tag) => tag.dest === folder && tag.prefix);
  const prefix = selectedFolder?.prefix
    ?? savedTag?.prefix
    ?? folder.split('/').pop()?.replace(/-/g, ' ')
    ?? '';
  const number = selectedFolder?.next_number ?? 1;
  const extension = firstFile.name.includes('.') ? firstFile.name.slice(firstFile.name.lastIndexOf('.') + 1) : '';
  const previewName = `${prefix} ${number}.${extension}`;

  const submit = () => {
    setLocalError(null);
    if (!folder.trim()) {
      setLocalError('Choose a folder.');
      return;
    }
    onSubmit({ paths: files.map((file) => file.path), folder: folder.trim() });
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label="Move to folder"
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
        <h2>Move to folder</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        <p className="muted">{files.length === 1 ? files[0].name : `${files.length} images`}</p>
        <div className="field">
          <span className="lbl">Folder</span>
          <FolderPicker folders={folders} hide={duplicateFolder} value={folder} onChange={setFolder} />
          {folder ? (
            <div className="preview-line">
              {files.length > 1
                ? `${previewName} and ${files.length - 1} more, numbered on from there`
                : `Will be named ${previewName}`}
            </div>
          ) : null}
        </div>
        {localError || error ? <p className="error" role="alert">{localError ?? error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={submit}>Move</button>
      </footer>
    </dialog>
  );
}
