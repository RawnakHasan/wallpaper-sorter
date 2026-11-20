import { Fragment, useRef } from 'react';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { LibraryImage } from '../schemas';
import { formatBytes, formatDateTime, safeUrl } from '../utils';

interface ImageDetailProps {
  image: LibraryImage;
  folder: string;
  pending: boolean;
  onClose: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRebuild: (hash: string) => void;
}

export function ImageDetail({ image, folder, pending, onClose, onMove, onDelete, onRebuild }: ImageDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef);
  const origin = image.origin;

  const rows: Array<[string, string]> = [
    ['Folder', folder],
    ['Size', formatBytes(image.size)],
  ];
  if (origin) {
    rows.push(['Original name', origin.original_name]);
    if (origin.width) rows.push(['Resolution', `${origin.width} × ${origin.height}`]);
    rows.push(['Added', formatDateTime(origin.added)]);
    if (origin.note) rows.push(['Why here', origin.note]);
  }

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={image.name}
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
        <h2>{image.name}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        {image.hash ? <img className="preview" src={`/api/image/${image.hash}`} alt={image.name} /> : null}
        <div className="kv">
          <div>File</div>
          <div className="m">{image.name}</div>
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <div>{label}</div>
              <div className="m">{value}</div>
            </Fragment>
          ))}
        </div>
        {origin?.sources.map((source, index) => {
          const url = safeUrl(source.url);
          return (
            <div className="kv" key={`${source.site}-${source.id}-${index}`}>
              <div>Source</div>
              <div>
                <span className="badge">{source.site}</span>
                {source.id ? <> <span className="m">{source.id}</span></> : null}
                {url ? <> <a href={url} target="_blank" rel="noopener noreferrer">open page</a></> : null}
                {source.artist ? (
                  <div className="muted">
                    Artist: {source.artist}{source.artist_id ? ` (${source.artist_id})` : ''}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <footer>
        {image.hash ? <button className="btn" type="button" onClick={() => onRebuild(image.hash!)}>Rebuild thumbnail</button> : null}
        <button className="btn primary" type="button" onClick={onMove}>Move to folder…</button>
        <button className="btn danger" type="button" onClick={onDelete}>Delete</button>
      </footer>
    </dialog>
  );
}
