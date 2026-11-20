import { useEffect, useRef, useState } from 'react';
import { ChipInput } from '../../../components/ChipInput';
import { FolderPicker } from '../../../components/FolderPicker';
import { Icon } from '../../../components/Icon';
import type { Tag, TagRequest } from '../schemas';

interface Folder {
  path: string;
}

interface TagEditorProps {
  tag: Tag | null;
  folders: Folder[];
  duplicateFolder: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (request: TagRequest) => void;
}

export function TagEditor({
  tag,
  folders,
  duplicateFolder,
  pending,
  error,
  onClose,
  onSave,
}: TagEditorProps) {
  const keywords = useRef(tag?.keywords ?? []);
  const strictWords = useRef(tag?.strict_words ?? []);
  const [destination, setDestination] = useState(tag?.dest ?? '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const prefixRef = useRef<HTMLInputElement>(null);
  const matchRef = useRef<HTMLSelectElement>(null);
  const genericRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

  const save = () => {
    onSave({
      keywords: keywords.current,
      dest: (folderRef.current?.value ?? destination).trim(),
      prefix: prefixRef.current?.value.trim() || null,
      match: matchRef.current?.value === 'substring' ? 'substring' : 'word',
      strict_words: strictWords.current,
      generic: genericRef.current?.checked ?? false,
      ...(tag ? { expected_keywords: tag.keywords, expected_dest: tag.dest } : {}),
    });
  };

  const defaultPrefix = destination
    ? `Default: ${destination.split('/').pop()?.replace(/-/g, ' ')}`
    : 'Default: the folder name';

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={tag ? 'Edit tag' : 'Add tag'}
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
        <h2>{tag ? 'Edit tag' : 'Add tag'}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        <div className="field">
          <span className="lbl">Keywords</span>
          <ChipInput
            initial={keywords.current}
            placeholder="keyword, then Enter"
            onChange={(next) => { keywords.current = next; }}
          />
        </div>
        <div className="field">
          <span className="lbl">Destination folder</span>
          <FolderPicker
            folders={folders}
            hide={duplicateFolder}
            value={destination}
            onChange={setDestination}
            inputRef={folderRef}
          />
        </div>
        <div className="field">
          <label htmlFor="tag-prefix">File prefix (optional)</label>
          <input
            ref={prefixRef}
            id="tag-prefix"
            className="input wide"
            defaultValue={tag?.prefix ?? ''}
            placeholder={tag ? (destination ? defaultPrefix : '') : defaultPrefix}
            aria-label="File prefix"
          />
        </div>
        <div className="field">
          <label htmlFor="tag-match">Match</label>
          <select ref={matchRef} id="tag-match" className="select" aria-label="Match mode" defaultValue={tag?.match ?? 'word'}>
            <option value="word">Whole words only</option>
            <option value="substring">Anywhere in the name</option>
          </select>
        </div>
        <div className="field">
          <span className="lbl">Only if one of these words is also in the name (optional)</span>
          <ChipInput
            initial={strictWords.current}
            placeholder="word, then Enter"
            onChange={(next) => { strictWords.current = next; }}
          />
        </div>
        <div className="field">
          <div className="check-row">
            <input ref={genericRef} type="checkbox" id="tag-generic" defaultChecked={tag?.generic ?? false} />
            <label htmlFor="tag-generic">Generic folder</label>
          </div>
          <span className="faint">Used only when no specific tag matched and the name is short (four words or fewer).</span>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={save}>Save</button>
      </footer>
    </dialog>
  );
}
