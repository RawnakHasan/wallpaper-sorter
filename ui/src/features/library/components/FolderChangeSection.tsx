import type { ReactNode } from 'react';
import type { FolderChangeRequest } from '../schemas';
import type { ChangePreviewState } from '../types';

interface FolderChangeSectionProps {
  kind: FolderChangeRequest['kind'];
  title: string;
  control: ReactNode;
  allowNoFiles: boolean;
  pending: boolean;
  state?: ChangePreviewState;
  onPreview: () => void;
  onApply: () => void;
}

export function FolderChangeSection({
  kind,
  title,
  control,
  allowNoFiles,
  pending,
  state,
  onPreview,
  onApply,
}: FolderChangeSectionProps) {
  const preview = state?.preview;
  const blocked = preview?.items.some((item) => item.kind === 'leave') ?? false;
  const details = preview?.items.slice(0, 30) ?? [];

  return (
    <section className="folder-manage-section">
      <h3>{title}</h3>
      {control}
      <button className="btn" type="button" disabled={pending || state?.loading} onClick={onPreview}>
        {state?.loading
          ? 'Loading preview…'
          : kind === 'prefix' ? 'Preview prefix' : kind === 'rename' ? 'Preview rename' : 'Preview merge'}
      </button>
      <div className="folder-preview">
        {state?.error ? <p className="error" role="alert">{state.error}</p> : null}
        {preview ? (
          <>
            <p className={blocked ? 'error' : 'muted'}>
              {blocked
                ? 'Some destinations are occupied. Resolve the conflicts before applying.'
                : `${preview.changes} ${preview.changes === 1 ? 'file' : 'files'} will change.`}
            </p>
            {details.map((item, index) => {
              const hasDestination = item.kind === 'move' || item.kind === 'rename' || item.kind === 'duplicate';
              const from = hasDestination ? item.from : item.path;
              const to = hasDestination ? item.to : '';
              const reason = item.kind === 'leave' ? item.reason : '';
              return (
                <div className="resort-row" key={`${item.kind}-${from}-${index}`}>
                  <span className="m grow">{to ? `${from} → ${to}` : from}</span>
                  {reason ? <span className="muted">{reason}</span> : null}
                </div>
              );
            })}
            {preview.items.length > details.length ? (
              <p className="muted">Showing 30 of {preview.items.length} changes.</p>
            ) : null}
            <button
              className="btn primary"
              type="button"
              disabled={pending || blocked || (!allowNoFiles && preview.changes === 0)}
              onClick={onApply}
            >
              {kind === 'prefix' ? 'Save prefix' : kind === 'rename' ? 'Rename folder' : 'Merge folders'}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
