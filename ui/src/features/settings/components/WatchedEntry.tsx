import type { IntakeEntry } from '../types';

interface WatchedEntryProps {
  intake?: IntakeEntry;
  path: string;
  library?: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
}

export function WatchedEntry({ intake, path, library = false, onEdit, onRemove }: WatchedEntryProps) {
  const watching = intake?.watching ?? false;
  const exists = intake?.exists ?? false;
  const recursive = intake?.recursive ?? false;
  const removeEmptyFolders = intake?.remove_empty_folders ?? false;
  const error = intake?.error;

  return (
    <div className="watched-entry">
      <span className="m watched-path">{path}</span>
      <span className="watched-badges">
        {library ? <span className="badge good">library, top level</span> : (
          <span className={`badge ${watching ? 'good' : 'warn'}`}>
            {watching ? 'watching' : exists ? 'not watching' : 'folder not found yet'}
          </span>
        )}
        {!library && recursive ? <span className="badge">includes subfolders</span> : null}
        {!library && removeEmptyFolders ? <span className="badge warn">removes empty folders</span> : null}
      </span>
      {!library ? (
        <span className="watched-actions">
          <button className="btn small" onClick={onEdit}>Edit</button>
          <button className="btn small danger" onClick={onRemove}>Remove</button>
        </span>
      ) : null}
      {error ? <p className="error watched-error">{error}</p> : null}
    </div>
  );
}
