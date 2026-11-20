import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../components/dialogs';
import { ChipInput, type ChipInputHandle } from '../../components/ChipInput';
import { FolderPicker } from '../../components/FolderPicker';
import { Icon } from '../../components/Icon';
import { ImageGrid, type GridItem } from '../../components/ImageGrid';
import { SelectionBar } from '../../components/SelectionBar';
import { getStatus, statusQueryKey } from '../status/api';
import { getTags, tagsQueryKey, testTagName } from '../tags/api';
import { undoActivity } from '../activity/api';
import { useHotkeysStore } from '../../stores/hotkeys';
import { useSelectionStore } from '../../stores/selection';
import { useToastStore } from '../../stores/toast';
import {
  assignFoldersQueryKey,
  assignInboxItems,
  deleteInboxItems,
  getAssignFolders,
  getInbox,
  inboxQueryKey,
  refreshThumbnail,
} from './api';
import type { AssignFolder, AssignRequest, InboxItem } from './schemas';
import type { Tag } from '../tags/schemas';

type InboxFilters = {
  reason: '' | InboxItem['reason'];
  intake: string;
};

interface AssignFile {
  path: string;
  name: string;
}

let retainedFilters: InboxFilters = { reason: '', intake: '' };
const emptyInbox: InboxItem[] = [];

const BORING_WORDS = new Set([
  'full', 'wallpaper', 'wallpapers', 'konachan', 'yande', 'png', 'jpg', 'jpeg',
  'and', 'the', 'drawn', 'tagme', 'naive', 'com', 'uhdpaper',
]);

const reasonLabels: Record<InboxItem['reason'], string> = {
  no_match: 'No match',
  conflict: 'Conflict',
  ready: 'Ready',
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function formatDateTime(seconds: number) {
  return seconds ? new Date(seconds * 1000).toLocaleString() : '';
}

function safeUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : null;
}

interface InboxDetailProps {
  item: InboxItem;
  pending: boolean;
  onClose: () => void;
  onAssign: () => void;
  onDelete: () => void;
  onRebuild: (hash: string) => void;
}

function InboxDetail({ item, pending, onClose, onAssign, onDelete, onRebuild }: InboxDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const origin = item.origin;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

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

interface AssignSheetProps {
  files: AssignFile[];
  folders: AssignFolder[];
  tags: Tag[];
  duplicateFolder: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (request: AssignRequest) => void;
}

function AssignSheet({
  files,
  folders,
  tags,
  duplicateFolder,
  pending,
  error,
  onClose,
  onSubmit,
}: AssignSheetProps) {
  const [folder, setFolder] = useState('');
  const [withTag, setWithTag] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [chipValues, setChipValues] = useState<string[]>([]);
  const tagCheckbox = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<ChipInputHandle>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFile = files[0];
  const suggestionsQuery = useQuery({
    queryKey: ['inbox-tag-suggestions', firstFile.name],
    queryFn: () => testTagName(firstFile.name),
    enabled: withTag,
    retry: false,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, []);

  const selectedFolder = folders.find((entry) => entry.path === folder);
  const savedTag = tags.find((tag) => tag.dest === folder && tag.prefix);
  const prefix = selectedFolder?.prefix
    ?? savedTag?.prefix
    ?? folder.split('/').pop()?.replace(/-/g, ' ')
    ?? '';
  const nextNumber = selectedFolder?.next_number ?? 1;
  const extension = firstFile.name.includes('.') ? firstFile.name.slice(firstFile.name.lastIndexOf('.') + 1) : '';
  const previewName = `${prefix} ${nextNumber}.${extension}`;
  const suggestions = [...new Set(suggestionsQuery.data?.words ?? [])]
    .filter((word) => /^[a-z]{3,}$/.test(word) && !BORING_WORDS.has(word))
    .slice(0, 8);

  const submit = () => {
    setLocalError(null);
    const destination = folder.trim();
    if (!destination) {
      setLocalError('Choose a folder.');
      return;
    }
    const shouldSaveTag = tagCheckbox.current?.checked ?? withTag;
    const keywords = chipsRef.current?.get() ?? chipValues;
    if (shouldSaveTag && !keywords.length) {
      setLocalError('Add at least one keyword, or untick "Also save a tag".');
      return;
    }
    onSubmit({
      paths: files.map((file) => file.path),
      folder: destination,
      ...(shouldSaveTag ? { tag: { keywords, dest: destination } } : {}),
    });
  };

  const problem = localError ?? error;
  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label="Assign to folder"
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
        <h2>Assign to folder</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        <p className="muted">{files.length === 1 ? files[0].name : `${files.length} images`}</p>
        <div className="field">
          <span className="lbl">Folder</span>
          <FolderPicker
            folders={folders}
            hide={duplicateFolder}
            value={folder}
            onChange={setFolder}
          />
          {folder ? (
            <div className="preview-line">
              {files.length > 1
                ? `${previewName} and ${files.length - 1} more, numbered on from there`
                : `Will be named ${previewName}`}
            </div>
          ) : null}
        </div>
        <div className="field">
          <div className="check-row">
            <input
              ref={tagCheckbox}
              type="checkbox"
              id="also-tag"
              onChange={(event) => setWithTag(event.currentTarget.checked)}
              onInput={(event) => setWithTag(event.currentTarget.checked)}
            />
            <label htmlFor="also-tag">Also save a tag, so this does not happen again</label>
          </div>
          <div hidden={!withTag}>
            <div className="field">
              <span className="lbl">Keywords (whole words in a filename)</span>
              <ChipInput ref={chipsRef} placeholder="keyword, then Enter" onChange={setChipValues} />
              <div className="sugg">
                {suggestions.map((word) => (
                  <button key={word} type="button" onClick={() => chipsRef.current?.add(word)}>{word}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {problem ? <p className="error" role="alert">{problem}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={submit}>Assign</button>
      </footer>
    </dialog>
  );
}

export function InboxPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const selectionKeys = useSelectionStore((state) => state.keys);
  const [filters, setFilters] = useState(retainedFilters);
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null);
  const [assignFiles, setAssignFiles] = useState<AssignFile[] | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [thumbVersions, setThumbVersions] = useState<Record<string, number>>({});
  const assignData = useRef<{
    folders: AssignFolder[];
    tags: Tag[];
    duplicateFolder: string;
  } | null>(null);
  const inboxQuery = useQuery({
    queryKey: inboxQueryKey,
    queryFn: getInbox,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const allItems = inboxQuery.data ?? emptyInbox;
  const items = useMemo(() => allItems.filter((item) =>
    (!filters.reason || item.reason === filters.reason)
    && (!filters.intake || item.intake === filters.intake)
  ), [allItems, filters]);
  const intakes = useMemo(() => [...new Set(allItems.map((item) => item.intake))], [allItems]);

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inboxQueryKey }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
      queryClient.invalidateQueries({ queryKey: tagsQueryKey }),
      queryClient.invalidateQueries({ queryKey: assignFoldersQueryKey }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshQueries();
  };

  const assignMutation = useMutation({
    mutationFn: assignInboxItems,
    onSuccess: async (result, request) => {
      setAssignFiles(null);
      setAssignError(null);
      useSelectionStore.getState().clear();
      if (result.error) {
        showToast(`Stopped: ${result.error}`, { error: true });
      } else {
        const moved = result.done.filter((item) => item.kind === 'move').length;
        const duplicates = result.done.filter((item) => item.kind === 'duplicate').length;
        let message = `Moved ${plural(moved, 'image')} to ${request.folder}`;
        if (duplicates) message += `; ${plural(duplicates, 'duplicate')} sent to ${statusQuery.data?.settings.duplicates_folder ?? 'Duplicates'}`;
        showToast(message, { undo: undoBatch(result.batch) });
      }
      await refreshQueries();
    },
    onError: (error) => setAssignError(messageOf(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteInboxItems,
    onSuccess: async (result) => {
      useSelectionStore.getState().clear();
      showToast(`Deleted ${plural(result.done.length, 'image')}`, { undo: undoBatch(result.batch) });
      await refreshQueries();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  const openAssign = async (files: AssignFile[]) => {
    if (!files.length) return;
    try {
      const [folders, tags] = await Promise.all([
        queryClient.fetchQuery({ queryKey: assignFoldersQueryKey, queryFn: getAssignFolders }),
        queryClient.fetchQuery({ queryKey: tagsQueryKey, queryFn: getTags }),
      ]);
      if (!statusQuery.data) return;
      setAssignError(null);
      assignData.current = { folders, tags, duplicateFolder: statusQuery.data.settings.duplicates_folder };
      setAssignFiles(files);
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };

  const deleteFiles = async (files: AssignFile[]) => {
    if (!files.length) return;
    const name = files.length === 1 ? files[0].name : plural(files.length, 'image');
    const confirmed = await confirmDialog(
      `Delete ${name}? ${files.length === 1 ? 'It goes' : 'They go'} to the trash and can be undone.`,
      'Delete',
      true,
    );
    if (confirmed) deleteMutation.mutate(files.map((file) => file.path));
  };

  const selectedFiles = () => {
    const selected = useSelectionStore.getState().keys;
    return items
      .filter((item) => selected.has(item.path))
      .map(({ path, name }) => ({ path, name }));
  };

  const rebuildThumbnails = async (hashes: Array<string | null | undefined>) => {
    const unique = [...new Set(hashes.filter((hash): hash is string => Boolean(hash)))];
    if (!unique.length) {
      showToast('No thumbnails available to rebuild', { error: true });
      return;
    }
    showToast(`Rebuilding ${plural(unique.length, 'thumbnail')}…`);
    const rebuilt: string[] = [];
    const errors: string[] = [];
    for (const hash of unique) {
      try {
        await refreshThumbnail(hash);
        rebuilt.push(hash);
      } catch (error) {
        errors.push(messageOf(error));
      }
    }
    if (rebuilt.length) {
      setThumbVersions((current) => {
        const next = { ...current };
        rebuilt.forEach((hash) => { next[hash] = (next[hash] ?? 0) + 1; });
        return next;
      });
    }
    if (errors.length) {
      showToast(`Rebuilt ${rebuilt.length} of ${unique.length}; ${errors.length} failed: ${errors[0]}`, { error: true });
    } else {
      showToast(`Rebuilt ${plural(rebuilt.length, 'thumbnail')}`);
    }
  };

  const allKeys = items.map((item) => item.path);
  const gridItems: GridItem[] = items.map((item) => ({
    key: item.path,
    hash: item.origin?.hash ?? null,
    thumbVersion: item.origin?.hash ? thumbVersions[item.origin.hash] ?? 0 : 0,
    name: item.name,
    sub: item.origin?.sources.filter((source) => source.site !== 'Unknown').map((source) => source.site).join(', ') ?? '',
    label: reasonLabels[item.reason],
    labelClass: item.reason,
    title: item.reason === 'conflict'
      ? `These tags clash: ${item.matched.join(', ')}`
      : item.reason === 'ready'
        ? 'A tag matches now; the next scan sorts it'
        : 'No tag matches this name',
    onOpen: () => setSelectedItem(item),
  }));

  useLayoutEffect(() => {
    if (!inboxQuery.data) return;
    const valid = new Set(items.map((item) => item.path));
    const current = useSelectionStore.getState();
    const keys = new Set([...current.keys].filter((key) => valid.has(key)));
    if (keys.size !== current.keys.size || (current.last !== null && !valid.has(current.last))) {
      useSelectionStore.setState({
        keys,
        last: current.last !== null && valid.has(current.last) ? current.last : null,
      });
    }
  }, [inboxQuery.data, items]);

  useLayoutEffect(() => {
    const setActions = useHotkeysStore.getState().setActions;
    setActions({
      assign: () => { void openAssign(selectedFiles()); },
      remove: () => { void deleteFiles(selectedFiles()); },
      all: () => flushSync(() => useSelectionStore.getState().addMany(allKeys)),
    });
    return () => setActions({});
  }, [items]);

  const error = inboxQuery.error ?? statusQuery.error;
  if (error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(error)}</p>
        <button className="btn" onClick={() => { void inboxQuery.refetch(); void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!inboxQuery.data || !statusQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const reasonChanged = (reason: InboxFilters['reason']) => {
    retainedFilters = { ...filters, reason };
    setFilters(retainedFilters);
  };
  const intakeChanged = (intake: string) => {
    retainedFilters = { ...filters, intake };
    setFilters(retainedFilters);
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inbox</h1>
        {allItems.length ? <span className="sub">{allItems.length} waiting</span> : null}
        <span className="spacer" />
        <div className="row">
          <select
            className="select"
            aria-label="Filter by reason"
            value={filters.reason}
            onChange={(event) => reasonChanged(event.currentTarget.value as InboxFilters['reason'])}
          >
            <option value="">Any reason</option>
            <option value="no_match">No match</option>
            <option value="conflict">Conflict</option>
            <option value="ready">Ready</option>
          </select>
          {intakes.length > 1 ? (
            <select
              className="select"
              aria-label="Filter by folder"
              value={filters.intake}
              onChange={(event) => intakeChanged(event.currentTarget.value)}
            >
              <option value="">All folders</option>
              {intakes.map((intake) => (
                <option key={intake} value={intake}>{intake === 'library' ? 'Library folder' : basename(intake)}</option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
      {allItems.length === 0 ? (
        <div className="empty"><b>Inbox clear</b>Images that cannot be sorted by their name wait here.</div>
      ) : items.length === 0 ? (
        <div className="empty"><b>Nothing matches these filters</b></div>
      ) : null}
      <SelectionBar
        allKeys={allKeys}
        actions={[
          { label: 'Assign to folder…', className: 'primary', onClick: () => { void openAssign(selectedFiles()); } },
          { label: 'Rebuild thumbnails', onClick: () => { void rebuildThumbnails(items.filter((item) => selectionKeys.has(item.path)).map((item) => item.origin?.hash)); } },
          { label: 'Delete', className: 'danger', onClick: () => { void deleteFiles(selectedFiles()); } },
        ]}
      />
      {items.length ? <ImageGrid items={gridItems} /> : null}
      {selectedItem ? (
        <InboxDetail
          key={selectedItem.path}
          item={selectedItem}
          pending={deleteMutation.isPending || assignMutation.isPending}
          onClose={() => setSelectedItem(null)}
          onAssign={() => {
            const file = { path: selectedItem.path, name: selectedItem.name };
            setSelectedItem(null);
            void openAssign([file]);
          }}
          onDelete={() => {
            const file = { path: selectedItem.path, name: selectedItem.name };
            setSelectedItem(null);
            void deleteFiles([file]);
          }}
          onRebuild={(hash) => { void rebuildThumbnails([hash]); }}
        />
      ) : null}
      {assignFiles && assignData.current ? (
        <AssignSheet
          files={assignFiles}
          folders={assignData.current.folders}
          tags={assignData.current.tags}
          duplicateFolder={assignData.current.duplicateFolder}
          pending={assignMutation.isPending}
          error={assignError}
          onClose={() => {
            if (assignMutation.isPending) return;
            setAssignFiles(null);
            setAssignError(null);
          }}
          onSubmit={(request) => {
            setAssignError(null);
            assignMutation.mutate(request);
          }}
        />
      ) : null}
    </div>
  );
}
