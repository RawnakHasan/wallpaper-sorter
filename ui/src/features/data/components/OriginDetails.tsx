import { Fragment, useRef } from 'react';
import { Icon } from '../../../components/Icon';
import { useNativeDialog } from '../../../components/useNativeDialog';
import { siteSchema, type Origin, type Site } from '../schemas';
import { formatDateTime, safeUrl } from '../utils';

interface OriginDetailsProps {
  record: Origin;
  pending: boolean;
  onClose: () => void;
  onSave: (request: { hash: string; site: Site; id: string }) => void;
}

export function OriginDetails({ record, pending, onClose, onSave }: OriginDetailsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const siteRef = useRef<HTMLSelectElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const firstSource = record.sources[0];
  useNativeDialog(dialogRef);

  const save = () => {
    const site = siteSchema.parse(siteRef.current?.value);
    onSave({
      hash: record.hash,
      site,
      id: idRef.current?.value.trim() ?? '',
    });
  };

  const rows: Array<[string, string]> = [
    ['File', record.name],
    ['Folder', record.folder || 'the library folder'],
    ['Original name', record.original_name],
  ];
  if (record.width) rows.push(['Resolution', `${record.width} × ${record.height ?? ''}`]);
  rows.push(['Added', formatDateTime(record.added)]);
  if (record.note) rows.push(['Why here', record.note]);
  if (record.rating) rows.push(['Content rating', record.rating]);
  if (record.tags.length) rows.push(['Site tags', record.tags.join(', ')]);

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={record.name}
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
        <h2>{record.name}</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        <img className="preview" src={`/api/image/${record.hash}`} alt={record.name} />
        <div className="kv">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <div>{label}</div>
              <div className="m">{value}</div>
            </Fragment>
          ))}
        </div>
        {record.sources.map((source, index) => {
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
        <div className="field">
          <span className="lbl">Set the source by hand</span>
          <div className="row">
            <select ref={siteRef} className="select" aria-label="Site" defaultValue={firstSource?.site ?? 'Unknown'}>
              <option value="Wallhaven">Wallhaven</option>
              <option value="Zerochan">Zerochan</option>
              <option value="Konachan.net">Konachan.net</option>
              <option value="yande.re">yande.re</option>
              <option value="Danbooru">Danbooru</option>
              <option value="Safebooru">Safebooru</option>
              <option value="Pixiv">Pixiv</option>
              <option value="Unknown">Unknown</option>
            </select>
            <input
              ref={idRef}
              className="input"
              defaultValue={firstSource?.id ?? ''}
              aria-label="Id on the site"
              placeholder="id on the site"
            />
            <button className="btn" type="button" disabled={pending} onClick={save}>Save source</button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
