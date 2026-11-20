import { useRef, useState } from 'react';
import { useNativeDialog } from '../../../components/useNativeDialog';
import { siteSchema, type Origin, type Site } from '../schemas';

interface BatchSourceSheetProps {
  records: Origin[];
  pending: boolean;
  onClose: () => void;
  onSave: (site: Site, ids: Record<string, string>) => void;
}

export function BatchSourceSheet({ records, pending, onClose, onSave }: BatchSourceSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [site, setSite] = useState<Site>('Wallhaven');
  const [ids, setIds] = useState<Record<string, string>>({});
  useNativeDialog(dialogRef);

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={`Set sources for ${records.length} records`}
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
        <h2>Set sources for {records.length} records</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>×</button>
      </header>
      <div className="content">
        <div className="field">
          <label htmlFor="batch-source">Source for every selected record</label>
          <select
            id="batch-source"
            className="select"
            aria-label="Batch source"
            value={site}
            disabled={pending}
            onChange={(event) => setSite(siteSchema.parse(event.currentTarget.value))}
          >
            <option value="Wallhaven">Wallhaven</option>
            <option value="Zerochan">Zerochan</option>
            <option value="Konachan">Konachan</option>
            <option value="yande.re">yande.re</option>
            <option value="Danbooru">Danbooru</option>
            <option value="Safebooru">Safebooru</option>
            <option value="Pixiv">Pixiv</option>
            <option value="Unknown">Unknown</option>
          </select>
        </div>
        <div className="batch-source-list">
          {records.map((record) => (
            <div className="batch-source-row" key={record.hash}>
              <span className="m" title={record.path}>{record.name}</span>
              <input
                className="input"
                aria-label={`ID for ${record.name}`}
                placeholder="ID (optional)"
                value={ids[record.hash] ?? ''}
                disabled={pending}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setIds((current) => ({ ...current, [record.hash]: value }));
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={() => onSave(site, ids)}>Save sources</button>
      </footer>
    </dialog>
  );
}
