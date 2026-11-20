import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../components/dialogs';
import { Icon } from '../../components/Icon';
import { getStatus, statusQueryKey } from '../status/api';
import { undoActivity } from '../activity/api';
import { useToastStore } from '../../stores/toast';
import {
  applyResort,
  getResortFolders,
  getResortPreview,
  resortFoldersQueryKey,
  resortPreviewQueryKey,
} from './api';
import type { ResortItem } from './schemas';

let retainedFolder = '';

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function isChange(item: ResortItem) {
  return item.kind === 'move' || item.kind === 'rename' || item.kind === 'duplicate';
}

function itemPath(item: ResortItem) {
  return item.kind === 'move' || item.kind === 'rename' || item.kind === 'duplicate'
    ? item.from
    : item.path;
}

function itemDestination(item: ResortItem) {
  return item.kind === 'move' || item.kind === 'rename' || item.kind === 'duplicate' ? item.to : '';
}

function itemReason(item: ResortItem) {
  if (item.kind === 'leave') return item.reason;
  if (item.kind === 'duplicate') return item.duplicate_of;
  if (item.kind === 'move') return item.rule;
  return '';
}

function relativePath(path: string, library: string) {
  return library && path.startsWith(`${library}/`) ? path.slice(library.length + 1) : path;
}

const kindLabels: Record<ResortItem['kind'], string> = {
  move: 'Move and rename',
  rename: 'Rename',
  duplicate: 'Duplicate',
  leave: 'Leave here',
  stay: 'Stays',
};

function ResortList({ items, library }: { items: ResortItem[]; library: string }) {
  const shown = items.slice(0, 200);
  return (
    <div className="resort-list">
      {shown.map((item, index) => {
        const from = relativePath(itemPath(item), library);
        const to = itemDestination(item);
        const detail = to ? `${from} → ${to}` : from;
        const reason = itemReason(item);
        const tone = item.kind === 'leave' ? 'warn' : item.kind === 'duplicate' ? 'bad' : 'good';
        return (
          <div className="resort-row" key={`${item.kind}-${itemPath(item)}-${index}`}>
            <span className={`badge ${tone}`}>{kindLabels[item.kind]}</span>
            <span className="m grow">{detail}</span>
            {reason ? <span className="muted">{reason}</span> : null}
          </div>
        );
      })}
      {items.length > shown.length ? <p className="muted">and {items.length - shown.length} more</p> : null}
    </div>
  );
}

export function ResortPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const [folder, setFolder] = useState(retainedFolder);
  const [outputRevision, setOutputRevision] = useState(0);
  const foldersQuery = useQuery({ queryKey: resortFoldersQueryKey, queryFn: getResortFolders });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const previewQuery = useQuery({
    queryKey: resortPreviewQueryKey(folder),
    queryFn: () => getResortPreview(folder),
    enabled: false,
    gcTime: Infinity,
  });

  const refreshAfterAction = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshAfterAction();
    setOutputRevision((revision) => revision + 1);
  };
  const applyMutation = useMutation({
    mutationFn: applyResort,
    onSuccess: async (result, request) => {
      queryClient.removeQueries({ queryKey: resortPreviewQueryKey(request.folder ?? '') });
      showToast(`Re-sorted ${plural(result.done.length, 'file')}`, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const duplicateFolder = statusQuery.data?.settings.duplicates_folder ?? '';
  const folders = (foldersQuery.data ?? []).filter((entry) =>
    entry.path !== duplicateFolder && !entry.path.startsWith(`${duplicateFolder}/`)
  );
  useEffect(() => {
    if (!folder || !foldersQuery.data || !statusQuery.data) return;
    const isValid = foldersQuery.data.some((entry) =>
      entry.path === folder
      && entry.path !== statusQuery.data.settings.duplicates_folder
      && !entry.path.startsWith(`${statusQuery.data.settings.duplicates_folder}/`)
    );
    if (!isValid) {
      retainedFolder = '';
      setFolder('');
      queryClient.removeQueries({ queryKey: ['resort-preview'] });
    }
  }, [folder, foldersQuery.data, queryClient, statusQuery.data]);

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

  const changeFolder = (next: string) => {
    retainedFolder = next;
    queryClient.removeQueries({ queryKey: ['resort-preview'] });
    setFolder(next);
  };
  const scan = async () => {
    try {
      await previewQuery.refetch({ throwOnError: true });
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const apply = async () => {
    const confirmed = await confirmDialog(
      `Apply ${plural(changes.length, 'change')}? The result is saved as one activity batch and can be undone.`,
      'Apply re-sort',
      true,
    );
    if (!confirmed) return;
    applyMutation.mutate(folder ? { folder } : {});
  };

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
                onClick={() => { void apply(); }}
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
