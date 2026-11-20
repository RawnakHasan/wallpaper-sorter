import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { confirmDialog } from '../../components/dialogs';
import { FolderPicker } from '../../components/FolderPicker';
import { Icon } from '../../components/Icon';
import { ImageGrid, type GridItem } from '../../components/ImageGrid';
import { SelectionBar } from '../../components/SelectionBar';
import { undoActivity } from '../activity/api';
import { assignFiles, deleteFiles } from '../files/api';
import type { AssignFilesRequest, FileActionResponse } from '../files/schemas';
import { getStatus, statusQueryKey } from '../status/api';
import { getTags, tagsQueryKey } from '../tags/api';
import type { Tag } from '../tags/schemas';
import { refreshThumbnail } from '../thumbnails/api';
import { useHotkeysStore } from '../../stores/hotkeys';
import { useSelectionStore } from '../../stores/selection';
import { useToastStore } from '../../stores/toast';
import {
  applyFolderChange,
  createLibraryFolder,
  fillLibraryGaps,
  getFolderChangePreview,
  getGapFillPreview,
  getLibraryFolders,
  libraryFoldersQueryKey,
  libraryImagesQueryOptions,
} from './api';
import type {
  FolderChangePreview,
  FolderChangeRequest,
  GapFillMode,
  LibraryFolder,
  LibraryImage,
} from './schemas';

interface LibraryFile {
  path: string;
  name: string;
}

const LIBRARY_IMAGE_DRAG_TYPE = 'application/x-wallpaper-sorter-image';

interface FolderCreated {
  folder: string;
}

interface ChangePreviewState {
  request: FolderChangeRequest;
  preview?: FolderChangePreview;
  loading: boolean;
  error?: string;
}

type ChangePreviews = Partial<Record<FolderChangeRequest['kind'], ChangePreviewState>>;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDateTime(seconds: number) {
  return seconds ? new Date(seconds * 1000).toLocaleString() : '';
}

function safeUrl(value: string) {
  return /^https?:\/\//.test(value) ? value : null;
}

function imageSources(image: LibraryImage) {
  return image.origin?.sources.filter((source) => source.site !== 'Unknown') ?? [];
}

interface ImageDetailProps {
  image: LibraryImage;
  folder: string;
  pending: boolean;
  onClose: () => void;
  onMove: () => void;
  onDelete: () => void;
  onRebuild: (hash: string) => void;
}

function ImageDetail({ image, folder, pending, onClose, onMove, onDelete, onRebuild }: ImageDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const origin = image.origin;

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

interface MoveSheetProps {
  files: LibraryFile[];
  folders: LibraryFolder[];
  tags: Tag[];
  duplicateFolder: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (request: AssignFilesRequest) => void;
}

function MoveSheet({ files, folders, tags, duplicateFolder, pending, error, onClose, onSubmit }: MoveSheetProps) {
  const [folder, setFolder] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFile = files[0];

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
  const number = selectedFolder?.next_number ?? 1;
  const extension = firstFile.name.includes('.') ? firstFile.name.slice(firstFile.name.lastIndexOf('.') + 1) : '';
  const previewName = `${prefix} ${number}.${extension}`;

  const submit = () => {
    setLocalError(null);
    if (!folder.trim()) {
      setLocalError('Choose a folder.');
      return;
    }
    onSubmit({ paths: files.map((file) => file.path), folder: folder.trim() });
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label="Move to folder"
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
        <h2>Move to folder</h2>
        <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" disabled={pending} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="content">
        <p className="muted">{files.length === 1 ? files[0].name : `${files.length} images`}</p>
        <div className="field">
          <span className="lbl">Folder</span>
          <FolderPicker folders={folders} hide={duplicateFolder} value={folder} onChange={setFolder} />
          {folder ? (
            <div className="preview-line">
              {files.length > 1
                ? `${previewName} and ${files.length - 1} more, numbered on from there`
                : `Will be named ${previewName}`}
            </div>
          ) : null}
        </div>
        {localError || error ? <p className="error" role="alert">{localError ?? error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={submit}>Move</button>
      </footer>
    </dialog>
  );
}

interface CreateFolderSheetProps {
  defaultPath: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (folder: string) => void;
}

function CreateFolderSheet({ defaultPath, pending, error, onClose, onCreate }: CreateFolderSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);

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

  const submit = () => {
    const folder = inputRef.current?.value.trim() ?? '';
    if (!folder) {
      setLocalError('Enter a folder path.');
      return;
    }
    setLocalError(null);
    onCreate(folder);
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label="New folder"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
    >
      <header><h2>New folder</h2></header>
      <div className="content">
        <div className="field">
          <label htmlFor="new-folder">Folder path</label>
          <input
            ref={inputRef}
            id="new-folder"
            className="input wide"
            defaultValue={defaultPath}
            placeholder="Folder path, for example Series/Violet"
            aria-label="New folder path"
          />
        </div>
        {localError || error ? <p className="error" role="alert">{localError ?? error}</p> : null}
      </div>
      <footer>
        <button className="btn" type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button className="btn primary" type="button" disabled={pending} onClick={submit}>Create folder</button>
      </footer>
    </dialog>
  );
}

interface FolderManagementSheetProps {
  folder: LibraryFolder;
  folders: LibraryFolder[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (request: FolderChangeRequest) => Promise<FileActionResponse>;
  onApplied: (request: FolderChangeRequest, result: FileActionResponse) => Promise<void>;
}

function FolderManagementSheet({
  folder,
  folders,
  pending,
  error,
  onClose,
  onApply,
  onApplied,
}: FolderManagementSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const mergeRef = useRef<HTMLSelectElement>(null);
  const prefixRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<ChangePreviews>({});
  const [applyError, setApplyError] = useState<string | null>(null);
  const destinations = folders.filter((entry) => entry.path !== folder.path && !entry.path.startsWith(`${folder.path}/`));

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

  const previewChange = async (request: FolderChangeRequest) => {
    const kind = request.kind;
    setPreviews((current) => ({ ...current, [kind]: { request, loading: true } }));
    try {
      const preview = await getFolderChangePreview(request);
      setPreviews((current) => ({ ...current, [kind]: { request, preview, loading: false } }));
    } catch (previewError) {
      setPreviews((current) => ({
        ...current,
        [kind]: { request, loading: false, error: messageOf(previewError) },
      }));
    }
  };

  const applyPreview = async (state: ChangePreviewState) => {
    const preview = state.preview;
    if (!preview) return;
    const changes = preview.changes;
    const label = state.request.kind === 'prefix'
      ? `Save the prefix “${state.request.prefix}”?`
      : state.request.kind === 'rename'
        ? `Rename ${state.request.from} to ${state.request.to}?`
        : `Merge ${state.request.from} into ${state.request.to}?`;
    const confirmed = await confirmDialog(
      `${label} ${changes ? 'File changes are logged and can be undone.' : 'No files need renaming.'}`,
      state.request.kind === 'prefix' ? 'Save prefix' : state.request.kind === 'rename' ? 'Rename folder' : 'Merge folders',
      state.request.kind !== 'prefix',
    );
    if (!confirmed) return;
    setApplyError(null);
    try {
      const result = await onApply(state.request);
      if (result.error) throw new Error(result.error);
      const dialog = dialogRef.current;
      if (dialog?.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      await onApplied(state.request, result);
    } catch (applyFailure) {
      setApplyError(messageOf(applyFailure));
    }
  };

  const renderPreviewSection = (
    kind: FolderChangeRequest['kind'],
    title: string,
    control: ReactNode,
    allowNoFiles: boolean,
  ) => {
    const state = previews[kind];
    const preview = state?.preview;
    const blocked = preview?.items.some((item) => item.kind === 'leave') ?? false;
    const details = preview?.items.slice(0, 30) ?? [];
    return (
      <section className="folder-manage-section" key={kind}>
        <h3>{title}</h3>
        {control}
        <button
          className="btn"
          type="button"
          disabled={pending || state?.loading}
          onClick={() => {
            if (kind === 'rename') {
              void previewChange({ kind, from: folder.path, to: renameRef.current?.value.trim() ?? '' });
            } else if (kind === 'merge') {
              void previewChange({ kind, from: folder.path, to: mergeRef.current?.value ?? '' });
            } else {
              void previewChange({ kind, folder: folder.path, prefix: prefixRef.current?.value.trim() ?? '' });
            }
          }}
        >
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
                onClick={() => { void applyPreview(state); }}
              >
                {kind === 'prefix' ? 'Save prefix' : kind === 'rename' ? 'Rename folder' : 'Merge folders'}
              </button>
            </>
          ) : null}
        </div>
      </section>
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={`Manage ${folder.path}`}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <header><h2>Manage {folder.path}</h2></header>
      <div className="content">
        {renderPreviewSection(
          'rename',
          'Rename',
          <input
            ref={renameRef}
            className="input wide"
            defaultValue={folder.path}
            aria-label="New folder path"
          />,
          false,
        )}
        {renderPreviewSection(
          'merge',
          'Merge into',
          <select ref={mergeRef} className="select" aria-label="Merge destination" defaultValue={destinations[0]?.path ?? ''}>
            {destinations.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}
          </select>,
          false,
        )}
        {renderPreviewSection(
          'prefix',
          'Numbering prefix',
          <input
            ref={prefixRef}
            className="input wide"
            defaultValue={folder.prefix}
            aria-label="File prefix"
          />,
          true,
        )}
        {applyError || error ? <p className="error" role="alert">{applyError ?? error}</p> : null}
      </div>
      <footer><button className="btn" type="button" disabled={pending} onClick={onClose}>Done</button></footer>
    </dialog>
  );
}

interface GapFillSheetProps {
  folder: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (mode: GapFillMode) => void;
}

function GapFillSheet({ folder, pending, error, onClose, onApply }: GapFillSheetProps) {
  const [mode, setMode] = useState<GapFillMode>('last');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previewQuery = useQuery({
    queryKey: ['gap-fill', folder, mode],
    queryFn: () => getGapFillPreview(folder, mode),
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

export function LibraryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate({ from: '/library' });
  const routeSearch = useSearch({ from: '/library' });
  const showToast = useToastStore((state) => state.show);
  const selectionKeys = useSelectionStore((state) => state.keys);
  const [selectedImage, setSelectedImage] = useState<LibraryImage | null>(null);
  const [moveFiles, setMoveFiles] = useState<LibraryFile[] | null>(null);
  const [moveTags, setMoveTags] = useState<Tag[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [managementFolder, setManagementFolder] = useState<LibraryFolder | null>(null);
  const [managementKey, setManagementKey] = useState(0);
  const [gapFolder, setGapFolder] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [managementError, setManagementError] = useState<string | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [thumbVersions, setThumbVersions] = useState<Record<string, number>>({});
  const draggedFiles = useRef<LibraryFile[]>([]);
  const foldersQuery = useQuery({
    queryKey: libraryFoldersQueryKey,
    queryFn: getLibraryFolders,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const folders = (foldersQuery.data ?? []).filter((entry) => {
    const duplicateFolder = statusQuery.data?.settings.duplicates_folder ?? '';
    return entry.path !== duplicateFolder && !entry.path.startsWith(`${duplicateFolder}/`);
  });
  const currentFolder = routeSearch.folder && folders.some((entry) => entry.path === routeSearch.folder)
    ? routeSearch.folder
    : folders[0]?.path ?? '';
  const currentInfo = folders.find((entry) => entry.path === currentFolder);
  const imagesQuery = useQuery({
    ...libraryImagesQueryOptions(currentFolder),
    enabled: !!currentFolder,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });
  const images = imagesQuery.data ?? [];

  useEffect(() => {
    setSelectedImage(null);
    setMoveFiles(null);
    setCreateOpen(false);
    setManagementFolder(null);
    setGapFolder(null);
  }, [currentFolder]);

  const refreshAfterAction = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: libraryFoldersQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['library-images'] }),
      queryClient.invalidateQueries({ queryKey: ['inbox'] }),
      queryClient.invalidateQueries({ queryKey: ['duplicates'] }),
      queryClient.invalidateQueries({ queryKey: ['data'] }),
      queryClient.invalidateQueries({ queryKey: statusQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['activity'] }),
      queryClient.invalidateQueries({ queryKey: tagsQueryKey }),
    ]);
  };
  const undoBatch = (batch: number | null) => batch === null ? undefined : async () => {
    await undoActivity({ batch });
    await refreshAfterAction();
  };
  const navigateToFolder = async (folder: string) => {
    try {
      await queryClient.ensureQueryData(libraryImagesQueryOptions(folder));
      await navigate({ to: '/library', search: { folder } });
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const prefetchFolder = (folder: string) => {
    void queryClient.prefetchQuery(libraryImagesQueryOptions(folder));
  };

  const createMutation = useMutation({
    mutationFn: createLibraryFolder,
    onSuccess: async (result: FolderCreated) => {
      setCreateOpen(false);
      setCreateError(null);
      showToast(`Created ${result.folder}`);
      await refreshAfterAction();
      await navigateToFolder(result.folder);
    },
    onError: (error) => setCreateError(messageOf(error)),
  });
  const moveMutation = useMutation({
    mutationFn: assignFiles,
    onSuccess: async (result: FileActionResponse, request: AssignFilesRequest) => {
      setMoveFiles(null);
      setMoveError(null);
      useSelectionStore.getState().clear();
      const moved = result.done.filter((item) => item.kind === 'move').length;
      const duplicates = result.done.filter((item) => item.kind === 'duplicate').length;
      let message = `Moved ${plural(moved, 'image')} to ${request.folder}`;
      if (duplicates) message += `; ${plural(duplicates, 'duplicate')} sent to ${statusQuery.data?.settings.duplicates_folder ?? 'Duplicates'}`;
      if (result.error) showToast(`Stopped: ${result.error}`, { error: true });
      else showToast(message, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    },
    onError: (error) => {
      const message = messageOf(error);
      if (moveFiles) setMoveError(message);
      else showToast(message, { error: true });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteFiles,
    onSuccess: async (result) => {
      useSelectionStore.getState().clear();
      showToast(`Deleted ${plural(result.done.length, 'image')}`, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const folderChangeMutation = useMutation({ mutationFn: applyFolderChange });
  const gapMutation = useMutation({
    mutationFn: (request: { folder: string; mode: GapFillMode }) => fillLibraryGaps(request.folder, request.mode),
  });

  const selectedFiles = () => {
    const selected = useSelectionStore.getState().keys;
    return images.filter((image) => selected.has(image.path)).map(({ path, name }) => ({ path, name }));
  };
  const openMove = async (files: LibraryFile[]) => {
    if (!files.length) return;
    try {
      const tags = await queryClient.fetchQuery({ queryKey: tagsQueryKey, queryFn: getTags });
      setMoveError(null);
      setMoveTags(tags);
      setMoveFiles(files);
    } catch (error) {
      showToast(messageOf(error), { error: true });
    }
  };
  const deleteSelected = async (files: LibraryFile[]) => {
    if (!files.length) return;
    const name = files.length === 1 ? files[0].name : plural(files.length, 'image');
    const confirmed = await confirmDialog(
      `Delete ${name}? ${files.length === 1 ? 'It goes' : 'They go'} to the trash and can be undone.`,
      'Delete',
      true,
    );
    if (confirmed) deleteMutation.mutate(files.map((file) => file.path));
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
  const openDeleteImage = (image: LibraryImage) => {
    setSelectedImage(null);
    void deleteSelected([{ path: image.path, name: image.name }]);
  };
  const openMoveImage = (image: LibraryImage) => {
    setSelectedImage(null);
    void openMove([{ path: image.path, name: image.name }]);
  };
  const startImageDrag = (event: DragEvent<HTMLDivElement>, item: GridItem) => {
    const selection = useSelectionStore.getState().keys;
    const files = selection.has(item.key)
      ? images.filter((image) => selection.has(image.path))
      : images.filter((image) => image.path === item.key);
    draggedFiles.current = files.map(({ path, name }) => ({ path, name }));
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(LIBRARY_IMAGE_DRAG_TYPE, 'images');
  };
  const dropImagesOnFolder = async (event: DragEvent<HTMLButtonElement>, folder: string) => {
    event.preventDefault();
    setDropTarget(null);
    const files = draggedFiles.current;
    draggedFiles.current = [];
    const filesToMove = files.filter((file) => file.path.slice(0, file.path.lastIndexOf('/')) !== folder);
    if (!filesToMove.length) return;

    const names = filesToMove.length === 1 ? filesToMove[0].name : plural(filesToMove.length, 'image');
    const confirmed = await confirmDialog(
      `Move ${names} to ${folder}? ${filesToMove.length === 1 ? 'It will' : 'They will'} be renamed using the destination folder’s prefix and your current numbering setting. Exact duplicates may be sent to Duplicates. You can undo the move.`,
      'Move & rename',
    );
    if (confirmed) moveMutation.mutate({ paths: filesToMove.map((file) => file.path), folder });
  };

  const allKeys = images.map((image) => image.path);
  const gridItems: GridItem[] = images.map((image) => ({
    key: image.path,
    hash: image.hash,
    thumbVersion: image.hash ? thumbVersions[image.hash] ?? 0 : 0,
    name: image.name,
    sub: imageSources(image).map((source) => source.site).join(', '),
    onOpen: () => setSelectedImage(image),
  }));
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const image of images) {
      const source = imageSources(image)[0];
      const label = source ? source.site : 'Unknown';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) =>
      a === 'Unknown' ? -1 : b === 'Unknown' ? 1 : a.localeCompare(b)
    );
  }, [images]);

  useLayoutEffect(() => {
    if (!imagesQuery.data) return;
    const valid = new Set(images.map((image) => image.path));
    const current = useSelectionStore.getState();
    const keys = new Set([...current.keys].filter((key) => valid.has(key)));
    if (keys.size !== current.keys.size || (current.last !== null && !valid.has(current.last))) {
      useSelectionStore.setState({
        keys,
        last: current.last !== null && valid.has(current.last) ? current.last : null,
      });
    }
  }, [images, imagesQuery.data]);

  useLayoutEffect(() => {
    const setActions = useHotkeysStore.getState().setActions;
    setActions({
      assign: () => { void openMove(selectedFiles()); },
      remove: () => { void deleteSelected(selectedFiles()); },
      all: () => flushSync(() => useSelectionStore.getState().addMany(allKeys)),
    });
    return () => setActions({});
  }, [images]);

  const queryError = foldersQuery.error ?? statusQuery.error ?? imagesQuery.error;
  if (queryError) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(queryError)}</p>
        <button className="btn" onClick={() => { void foldersQuery.refetch(); void statusQuery.refetch(); void imagesQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!foldersQuery.data || !statusQuery.data || (currentFolder && !imagesQuery.data)) {
    return <div className="page"><p className="muted">Loading…</p></div>;
  }

  const folderChangeDone = async (request: FolderChangeRequest, result: FileActionResponse) => {
    const message = request.kind === 'prefix'
      ? `Prefix changed for ${request.folder}`
      : request.kind === 'rename' ? `Renamed ${request.from}` : `Merged ${request.from}`;
    flushSync(() => {
      setManagementFolder(null);
      setManagementError(null);
    });
    const next = request.kind === 'prefix' ? request.folder : request.to;
    await navigateToFolder(next);
    await refreshAfterAction();
    showToast(message, result.done.length ? { undo: undoBatch(result.batch) } : undefined);
  };
  const fillGaps = async (mode: GapFillMode) => {
    if (!gapFolder) return;
    setGapError(null);
    try {
      const result = await gapMutation.mutateAsync({ folder: gapFolder, mode });
      if (result.error) throw new Error(result.error);
      setGapFolder(null);
      showToast(`Renamed ${plural(result.done.length, 'file')} in ${gapFolder}`, { undo: undoBatch(result.batch) });
      await refreshAfterAction();
    } catch (error) {
      setGapError(messageOf(error));
    }
  };

  if (!folders.length) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>Library</h1>
          <span className="spacer" />
          <button className="btn primary" type="button" onClick={() => { setCreateError(null); setCreateOpen(true); }}>New folder</button>
        </div>
        <div className="empty"><b>No folders yet</b>Folders appear here when images are sorted into them.</div>
        {createOpen ? (
          <CreateFolderSheet
            defaultPath=""
            pending={createMutation.isPending}
            error={createError}
            onClose={() => setCreateOpen(false)}
            onCreate={(folder) => createMutation.mutate(folder)}
          />
        ) : null}
      </div>
    );
  }

  const gapsLabel = currentInfo?.gaps.length
    ? currentInfo.gaps.length > 6
      ? `${currentInfo.gaps.length} (${currentInfo.gaps.slice(0, 6).join(', ')}, …)`
      : `${currentInfo.gaps.length} (${currentInfo.gaps.join(', ')})`
    : '';
  const sourceSummary = sourceCounts.length ? (
    <span className="source-counts" role="group" aria-label="Images by source">
      <span className="source-count-label">Sources</span>
      {sourceCounts.map(([source, count]) => (
        <span className="source-count" key={source}><b>{source}</b>{count}</span>
      ))}
    </span>
  ) : null;

  return (
    <div className="page">
      <div className="lib">
        <nav className="tree" aria-label="Folders">
          {folders.map((folder) => {
            const depth = folder.path.split('/').length - 1;
            return (
              <button
                key={folder.path}
                className={`${folder.path === currentFolder ? 'on' : ''}${dropTarget === folder.path ? ' drop-target' : ''}`}
                aria-current={folder.path === currentFolder ? 'true' : undefined}
                style={{ paddingLeft: 8 + depth * 14 }}
                onDragEnter={(event) => {
                  if (draggedFiles.current.length) setDropTarget(folder.path);
                }}
                onDragOver={(event) => {
                  if (!draggedFiles.current.length) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropTarget(folder.path);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={(event) => { void dropImagesOnFolder(event, folder.path); }}
                onPointerEnter={() => prefetchFolder(folder.path)}
                onFocus={() => prefetchFolder(folder.path)}
                onClick={() => { void navigateToFolder(folder.path); }}
              >
                <span>{folder.name}</span>
                <span className="count">{folder.count}</span>
              </button>
            );
          })}
        </nav>
        <div className="lib-main">
          <div className="page-head">
            <h1>{currentInfo?.name ?? basename(currentFolder)}</h1>
            <span className="spacer" />
            <div className="row">
              <button className="btn" type="button" onClick={() => { setCreateError(null); setCreateOpen(true); }}>New folder</button>
              {currentInfo ? (
                <button className="btn" type="button" onClick={() => {
                  setManagementError(null);
                  setManagementKey((key) => key + 1);
                  setManagementFolder(currentInfo);
                }}>
                  Manage folder…
                </button>
              ) : null}
              {currentInfo?.gaps.length ? (
                <button className="btn" type="button" onClick={() => { setGapError(null); setGapFolder(currentFolder); }}>
                  Close gaps…
                </button>
              ) : null}
            </div>
          </div>
          <div className="crumbs">
            {currentFolder.split('/').map((segment, index, segments) => {
              const path = segments.slice(0, index + 1).join('/');
              return (
                <Fragment key={path}>
                  {index ? <span>/</span> : null}
                  <button
                    type="button"
                    onPointerEnter={() => prefetchFolder(path)}
                    onFocus={() => prefetchFolder(path)}
                    onClick={() => {
                      if (folders.some((entry) => entry.path === path)) void navigateToFolder(path);
                    }}
                  >{segment}</button>
                </Fragment>
              );
            })}
          </div>
          {currentInfo ? (
            <div className="facts">
              <span>Prefix <b>{currentInfo.prefix}</b></span>
              <span>Next number <b>{currentInfo.next_number}</b></span>
              <span>Images <b>{images.length}</b></span>
              {gapsLabel ? <span>Gaps <b>{gapsLabel}</b></span> : null}
              {sourceSummary}
            </div>
          ) : null}
          {images.length === 0 ? <div className="empty"><b>No images in this folder</b></div> : null}
          <SelectionBar
            allKeys={allKeys}
            actions={[
              { label: 'Move to folder…', className: 'primary', onClick: () => { void openMove(selectedFiles()); } },
              { label: 'Rebuild thumbnails', onClick: () => { void rebuildThumbnails(images.filter((image) => selectionKeys.has(image.path)).map((image) => image.hash)); } },
              { label: 'Delete', className: 'danger', onClick: () => { void deleteSelected(selectedFiles()); } },
            ]}
          />
          {images.length ? (
            <ImageGrid
              key={currentFolder}
              items={gridItems}
              onDragStart={startImageDrag}
              onDragEnd={() => {
                draggedFiles.current = [];
                setDropTarget(null);
              }}
            />
          ) : null}
        </div>
      </div>
      {selectedImage ? (
        <ImageDetail
          key={selectedImage.path}
          image={selectedImage}
          folder={currentFolder}
          pending={deleteMutation.isPending || moveMutation.isPending}
          onClose={() => setSelectedImage(null)}
          onMove={() => openMoveImage(selectedImage)}
          onDelete={() => openDeleteImage(selectedImage)}
          onRebuild={(hash) => { void rebuildThumbnails([hash]); }}
        />
      ) : null}
      {moveFiles ? (
        <MoveSheet
          files={moveFiles}
          folders={folders}
          tags={moveTags}
          duplicateFolder={statusQuery.data.settings.duplicates_folder}
          pending={moveMutation.isPending}
          error={moveError}
          onClose={() => {
            if (moveMutation.isPending) return;
            setMoveFiles(null);
            setMoveError(null);
          }}
          onSubmit={(request) => {
            setMoveError(null);
            moveMutation.mutate(request);
          }}
        />
      ) : null}
      {createOpen ? (
        <CreateFolderSheet
          defaultPath={currentFolder ? `${currentFolder}/` : ''}
          pending={createMutation.isPending}
          error={createError}
          onClose={() => {
            if (!createMutation.isPending) setCreateOpen(false);
          }}
          onCreate={(folder) => createMutation.mutate(folder)}
        />
      ) : null}
      {managementFolder ? (
        <FolderManagementSheet
          key={managementKey}
          folder={managementFolder}
          folders={folders}
          pending={folderChangeMutation.isPending}
          error={managementError}
          onClose={() => {
            if (!folderChangeMutation.isPending) setManagementFolder(null);
          }}
          onApply={(request) => folderChangeMutation.mutateAsync(request)}
          onApplied={async (request, result) => {
            setManagementError(null);
            await folderChangeDone(request, result);
          }}
        />
      ) : null}
      {gapFolder ? (
        <GapFillSheet
          folder={gapFolder}
          pending={gapMutation.isPending}
          error={gapError}
          onClose={() => {
            if (!gapMutation.isPending) setGapFolder(null);
          }}
          onApply={(mode) => { void fillGaps(mode); }}
        />
      ) : null}
    </div>
  );
}
