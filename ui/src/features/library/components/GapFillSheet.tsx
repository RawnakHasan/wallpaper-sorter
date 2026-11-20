import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNativeDialog } from '../../../components/useNativeDialog';
import { getGapFillPreview } from '../api';
import type { GapFillMode } from '../schemas';
import { messageOf, plural } from '../utils';

interface GapFillSheetProps {
  folder: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (mode: GapFillMode) => void;
}

export function GapFillSheet({ folder, pending, error, onClose, onApply }: GapFillSheetProps) {
  const [mode, setMode] = useState<GapFillMode>('last');
  const dialogRef = useRef<HTMLDialogElement>(null);
  useNativeDialog(dialogRef);
  const previewQuery = useQuery({
    queryKey: ['gap-fill', folder, mode],
    queryFn: () => getGapFillPreview(folder, mode),
  });
  const renames = previewQuery.data ?? [];

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={`Close gaps in ${folder}`}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <header><h2>Close gaps in {folder}</h2></header>
      <div className="content">
        <div className="seg" role="group" aria-label="Gap closing mode">
          <button type="button" className={mode === 'last' ? 'on' : ''} aria-pressed={mode === 'last'} onClick={() => setMode('last')}>
            Move the last images into the gaps
          </button>
          <button type="button" className={mode === 'renumber' ? 'on' : ''} aria-pressed={mode === 'renumber'} onClick={() => setMode('renumber')}>
            Renumber everything
          </button>
        </div>
        {previewQuery.isPending ? <p className="muted">Loading preview…</p> : null}
        {previewQuery.error ? <p className="error" role="alert">{messageOf(previewQuery.error)}</p> : null}
        {previewQuery.data ? (
          <>
            <p className="muted">
              {renames.length ? `${plural(renames.length, 'file')} would be renamed. Nothing else moves.` : 'Nothing to rename.'}
            </p>
            <div className="list">
              {renames.slice(0, 40).map((rename) => (
                <div key={`${rename.from}-${rename.to}`}>
                  <span className="m grow">{rename.from} → {rename.to}</span>
                </div>
              ))}
              {renames.length > 40 ? <div className="muted">…and {renames.length - 40} more</div> : null}
            </div>
          </>
        ) : null}
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          type="button"
          disabled={pending || previewQuery.isPending || !!previewQuery.error || !renames.length}
          onClick={() => onApply(mode)}
        >
          Apply
        </button>
      </footer>
    </dialog>
  );
}
