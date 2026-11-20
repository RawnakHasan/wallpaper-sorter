import { ResortList } from './components/ResortList';
import { useResortPage } from './hooks/useResortPage';
import type { ResortItem } from './schemas';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function isChange(item: ResortItem) {
  return item.kind === 'move' || item.kind === 'rename' || item.kind === 'duplicate';
}

export function ResortPage() {
  const {
    folder,
    outputRevision,
    foldersQuery,
    statusQuery,
    previewQuery,
    applyMutation,
    changeFolder,
    scan,
    apply,
  } = useResortPage();

  const error = foldersQuery.error ?? statusQuery.error;
  if (error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(error)}</p>
        <button className="btn" onClick={() => { void foldersQuery.refetch(); void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!foldersQuery.data || !statusQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const duplicateFolder = statusQuery.data.settings.duplicates_folder;
  const folders = foldersQuery.data.filter((entry) =>
    entry.path !== duplicateFolder && !entry.path.startsWith(`${duplicateFolder}/`)
  );
  const preview = previewQuery.data;
  const items = preview?.items ?? [];
  const changes = items.filter(isChange);
  const decisions = items.filter((item) => item.kind === 'leave' && item.reason !== 'no match');
  const noMatch = items.filter((item) => item.kind === 'leave' && item.reason === 'no match').length;
  const stays = items.filter((item) => item.kind === 'stay').length;
  const note = folder
    ? `Includes ${folder} and its subfolders. Duplicates are never re-sorted.`
    : 'Applies current tags to every image already in the library. Duplicates are never re-sorted.';
  const extraSummary = [
    stays ? `${stays} ${stays === 1 ? 'stay' : 'stays'}` : '',
    noMatch ? `${noMatch} no match${noMatch === 1 ? '' : 'es'}` : '',
  ].filter(Boolean).join(', ') || 'Every matching image has a destination.';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Re-sort</h1>
        <span className="sub">Apply current tags to images that are already in the library. Nothing changes until you apply.</span>
      </div>
      <section className="panel resort-scope">
        <div className="field">
          <label htmlFor="resort-scope">Scope</label>
          <select
            id="resort-scope"
            className="select"
            aria-label="Re-sort scope"
            value={folder}
            onChange={(event) => changeFolder(event.currentTarget.value)}
          >
            <option value="">Whole library</option>
            {folders.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}
          </select>
        </div>
        <p className="muted">{note}</p>
        <div className="row">
          <button className="btn primary" type="button" disabled={previewQuery.isFetching} onClick={() => { void scan(); }}>
            {previewQuery.isFetching ? 'Scanning…' : 'Scan and preview'}
          </button>
        </div>
      </section>
      <div className="resort-output" key={outputRevision}>
        {preview ? (
          <>
            <div className="resort-summary">
              <b>{plural(changes.length, 'change')} ready</b>
              <span className="muted">{extraSummary}</span>
              <button
                className="btn primary"
                disabled={!changes.length || applyMutation.isPending}
                onClick={() => { void apply(changes.length); }}
              >
                Apply {plural(changes.length, 'change')}
              </button>
            </div>
            {changes.length ? (
              <>
                <h3>Changes</h3>
                <ResortList items={changes} library={statusQuery.data.library} />
              </>
            ) : null}
            {decisions.length ? (
              <>
                <h3>Needs a decision</h3>
                <ResortList items={decisions} library={statusQuery.data.library} />
              </>
            ) : null}
            {items.length === 0 ? <div className="empty"><b>No images in this scope</b></div> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
