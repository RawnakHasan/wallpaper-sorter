import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChipInput, type ChipInputHandle } from '../../../components/ChipInput';
import { FolderPicker } from '../../../components/FolderPicker';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { AssignFilesRequest } from '../../files/schemas';
import type { Tag } from '../../tags/schemas';
import { testTagName } from '../../tags/api';
import type { AssignFolder } from '../schemas';
import type { AssignFile } from '../types';
import { boringWords } from '../utils';

interface AssignSheetProps {
  files: AssignFile[];
  folders: AssignFolder[];
  tags: Tag[];
  duplicateFolder: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (request: AssignFilesRequest) => void;
}

export function AssignSheet({ files, folders, tags, duplicateFolder, pending, error, onClose, onSubmit }: AssignSheetProps) {
  const [folder, setFolder] = useState('');
  const [withTag, setWithTag] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [chipValues, setChipValues] = useState<string[]>([]);
  const tagCheckbox = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<ChipInputHandle>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFile = files[0];
  const suggestionsQuery = useQuery({
    queryKey: ['inbox-tag-suggestions', firstFile.name],
    queryFn: () => testTagName(firstFile.name),
    enabled: withTag,
    retry: false,
  });
  useNativeDialog(dialogRef);

  const selectedFolder = folders.find((entry) => entry.path === folder);
  const savedTag = tags.find((tag) => tag.dest === folder && tag.prefix);
  const prefix = selectedFolder?.prefix
    ?? savedTag?.prefix
    ?? folder.split('/').pop()?.replace(/-/g, ' ')
    ?? '';
  const nextNumber = selectedFolder?.next_number ?? 1;
  const extension = firstFile.name.includes('.') ? firstFile.name.slice(firstFile.name.lastIndexOf('.') + 1) : '';
  const previewName = `${prefix} ${nextNumber}.${extension}`;
  const suggestions = [...new Set(suggestionsQuery.data?.words ?? [])]
    .filter((word) => /^[a-z]{3,}$/.test(word) && !boringWords.has(word))
    .slice(0, 8);

  const submit = () => {
    setLocalError(null);
    const destination = folder.trim();
    if (!destination) {
      setLocalError('Choose a folder.');
      return;
    }
    const shouldSaveTag = tagCheckbox.current?.checked ?? withTag;
    const keywords = chipsRef.current?.get() ?? chipValues;
    if (shouldSaveTag && !keywords.length) {
      setLocalError('Add at least one keyword, or untick "Also save a tag".');
      return;
    }
    onSubmit({
      paths: files.map((file) => file.path),
      folder: destination,
      ...(shouldSaveTag ? { tag: { keywords, dest: destination } } : {}),
    });
  };

  const problem = localError ?? error;
  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label="Assign to folder"
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
        <h2>Assign to folder</h2>
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
        <div className="field">
          <div className="check-row">
            <input
              ref={tagCheckbox}
              type="checkbox"
              id="also-tag"
              onChange={(event) => setWithTag(event.currentTarget.checked)}
              onInput={(event) => setWithTag(event.currentTarget.checked)}
            />
            <label htmlFor="also-tag">Also save a tag, so this does not happen again</label>
          </div>
          <div hidden={!withTag}>
            <div className="field">
              <span className="lbl">Keywords (whole words in a filename)</span>
              <ChipInput ref={chipsRef} placeholder="keyword, then Enter" onChange={setChipValues} />
              <div className="sugg">
                {suggestions.map((word) => (
                  <button key={word} type="button" onClick={() => chipsRef.current?.add(word)}>{word}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {problem ? <p className="error" role="alert">{problem}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={submit}>Assign</button>
      </footer>
    </dialog>
  );
}
