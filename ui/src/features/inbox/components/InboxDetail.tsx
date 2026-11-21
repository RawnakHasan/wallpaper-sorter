import { Fragment, useRef } from 'react';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { InboxItem } from '../schemas';
import { formatDateTime, reasonLabels, safeUrl } from '../utils';

interface InboxDetailProps {
  item: InboxItem;
  pending: boolean;
  onClose: () => void;
  onAssign: () => void;
  onDelete: () => void;
  onRebuild: (hash: string) => void;
}

export function InboxDetail({ item, pending, onClose, onAssign, onDelete, onRebuild }: InboxDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const origin = item.origin;
  useNativeDialog(dialogRef);

  const rows: Array<[string, string]> = [
    ['File', item.name],
    ['Waiting because', reasonLabels[item.reason]],
    ['Folder', item.intake === 'library' ? 'the library folder' : item.intake],
  ];
  if (origin) {
    rows.push(['Original name', origin.original_name]);
    if (origin.width) rows.push(['Resolution', `${origin.width} × ${origin.height}`]);
    rows.push(['Added', formatDateTime(origin.added)]);
    if (origin.note) rows.push(['Why here', origin.note]);
    if (origin.rating) rows.push(['Content rating', origin.rating]);
    if (origin.tags.length) rows.push(['Site tags', origin.tags.join(', ')]);
  }

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={item.name}
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
        <h2>{item.name}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        {origin ? <img className="preview" src={`/api/image/${origin.hash}`} alt={item.name} /> : null}
        <div className="kv">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <div>{label}</div>
              <div className="m">{value}</div>
            </Fragment>
          ))}
        </div>
        {origin?.sources.map((source, index) => {
          const url = safeUrl(source.url ?? '');
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
        {origin?.hash ? <button className="btn" type="button" onClick={() => onRebuild(origin.hash)}>Rebuild thumbnail</button> : null}
        <button className="btn primary" type="button" onClick={onAssign}>Assign…</button>
        <button className="btn danger" type="button" onClick={onDelete}>Delete</button>
      </footer>
    </dialog>
  );
}
