import { useEffect, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { useRecentFoldersStore } from '../stores/recent-folders';

interface Folder {
  path: string;
}

interface FolderPickerProps {
  folders: Folder[];
  value?: string;
  hide?: string;
  placeholder?: string;
  onChange?: (path: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}

export function FolderPicker({ folders, value = '', hide, placeholder, onChange, inputRef }: FolderPickerProps) {
  const recent = useRecentFoldersStore((state) => state.folders);
  const [input, setInput] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setInput(value), [value]);
  const known = folders.map((folder) => folder.path).filter((path) => path !== hide);
  const query = input.trim().toLowerCase();
  const suggestions = (query
    ? known.filter((path) => path.toLowerCase().includes(query))
    : recent.filter((path) => known.includes(path))
  ).slice(0, 8);
  const typed = input.trim();

  const update = (next: string) => {
    flushSync(() => {
      setInput(next);
      onChange?.(next.trim());
    });
  };

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className="input wide"
        value={input}
        placeholder={placeholder || 'Folder, for example Wuthering-Waves/Chisa'}
        autoComplete="off"
        aria-label="Folder"
        aria-expanded={open && (suggestions.length > 0 || (typed !== '' && !known.includes(typed)))}
        onChange={(event) => update(event.currentTarget.value)}
        onInput={(event) => update(event.currentTarget.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open && suggestions.length + (typed !== '' && !known.includes(typed) ? 1 : 0) > 0 ? (
        <div className="suggest">
          {suggestions.map((path) => (
            <button
              key={path}
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                update(path);
                setOpen(false);
              }}
            >
              {path}
            </button>
          ))}
          {typed && !known.includes(typed) ? <div className="new">New folder: {typed}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
