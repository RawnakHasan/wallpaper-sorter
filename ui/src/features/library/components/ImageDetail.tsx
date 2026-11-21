import { Fragment, useRef } from 'react';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import { OriginSourceEditor } from '../../data/components/OriginSourceEditor';
import type { OriginLookupRequest, Site } from '../../data/schemas';
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
  sourcePending: boolean;
  onSaveSource: (request: { hash: string; site: Site; id: string }) => void;
  onLookupSource: (request: OriginLookupRequest) => void;
}

export function ImageDetail({
  image,
  folder,
  pending,
  onClose,
  onMove,
  onDelete,
  onRebuild,
  sourcePending,
  onSaveSource,
  onLookupSource,
}: ImageDetailProps) {
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
    if (origin.rating) rows.push(['Content rating', origin.rating]);
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
        {origin?.tags.length ? (
          <div className="kv">
            <div>Site tags</div>
            <div className="site-tags">
              {origin.tags.map((tag) => <span className="tagchip" key={tag}>{tag}</span>)}
            </div>
          </div>
        ) : null}
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
        <OriginSourceEditor
          hash={image.hash}
          source={origin?.sources[0]}
          pending={sourcePending}
          onSave={onSaveSource}
          onLookup={onLookupSource}
        />
      </div>
      <footer>
        {image.hash ? <button className="btn" type="button" onClick={() => onRebuild(image.hash!)}>Rebuild thumbnail</button> : null}
        <button className="btn primary" type="button" onClick={onMove}>Move to folder…</button>
        <button className="btn danger" type="button" onClick={onDelete}>Delete</button>
      </footer>
    </dialog>
  );
}
