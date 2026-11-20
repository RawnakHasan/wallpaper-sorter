import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '../../components/dialogs';
import { getStatus, statusQueryKey, updateSettings } from '../status/api';
import type { Status } from '../status/schemas';
import { useToastStore } from '../../stores/toast';
import { useThemeStore, type Theme } from '../../stores/theme';
import { emptyTrash, removeIntake, saveIntake } from './api';
import type { IntakeRequest } from './api';

const GAP_MODES = ['keep', 'lowest', 'last', 'renumber'] as const;
type GapMode = typeof GAP_MODES[number];
type IntakeEntry = Status['intake'][number];

const GAP_TEXT: Record<GapMode, string> = {
  keep: 'Keep gaps. The next number is the highest plus one. Nothing is renamed.',
  lowest: 'The next image takes the lowest free number. Nothing is renamed.',
  last: 'The last images are renamed into the gaps whenever an image arrives.',
  renumber: 'Everything is renumbered without gaps whenever an image arrives.',
};

const THEMES: Theme[] = ['system', 'dark', 'light'];

interface IntakeDraft {
  index: number | null;
  path: string;
  recursive: boolean;
  remove_empty_folders: boolean;
}

interface WatchedEntryProps {
  path: string;
  library?: boolean;
  watching?: boolean;
  exists?: boolean;
  recursive?: boolean;
  remove_empty_folders?: boolean;
  error?: string | null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function WatchedEntry({
  path,
  library = false,
  watching = false,
  exists = false,
  recursive = false,
  remove_empty_folders = false,
  error,
  onEdit,
  onRemove,
}: WatchedEntryProps & { onEdit?: () => void; onRemove?: () => void }) {
  return (
    <div className="watched-entry">
      <span className="m watched-path">{path}</span>
      <span className="watched-badges">
        {library ? <span className="badge good">library, top level</span> : (
          <span className={`badge ${watching ? 'good' : 'warn'}`}>
            {watching ? 'watching' : exists ? 'not watching' : 'folder not found yet'}
          </span>
        )}
        {!library && recursive ? <span className="badge">includes subfolders</span> : null}
        {!library && remove_empty_folders ? <span className="badge warn">removes empty folders</span> : null}
      </span>
      {!library ? (
        <span className="watched-actions">
          <button className="btn small" onClick={onEdit}>Edit</button>
          <button className="btn small danger" onClick={onRemove}>Remove</button>
        </span>
      ) : null}
      {error ? <p className="error watched-error">{error}</p> : null}
    </div>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const showToast = useToastStore((state) => state.show);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const statusQuery = useQuery({ queryKey: statusQueryKey, queryFn: getStatus });
  const [gapMode, setGapMode] = useState<GapMode | null>(null);
  const [intakeDraft, setIntakeDraft] = useState<IntakeDraft | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const intakeDialogRef = useRef<HTMLDialogElement>(null);
  const intakePathRef = useRef<HTMLInputElement>(null);
  const recursiveRef = useRef<HTMLInputElement>(null);
  const removeEmptyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!intakeDraft) return;
    const dialog = intakeDialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (!dialog.open) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [intakeDraft]);

  const refreshStatus = () => queryClient.invalidateQueries({ queryKey: statusQueryKey });
  const gapMutation = useMutation({
    mutationFn: (mode: GapMode) => updateSettings({ gap_mode: mode }),
    onSuccess: async () => {
      setGapMode(null);
      showToast('Saved');
      await refreshStatus();
    },
    onError: (error) => {
      setGapMode(null);
      showToast(messageOf(error), { error: true });
    },
  });
  const saveIntakeMutation = useMutation({
    mutationFn: ({ index, ...body }: IntakeDraft & IntakeRequest) => saveIntake(index, body),
    onSuccess: async () => {
      setIntakeDraft(null);
      showToast(intakeDraft?.index === null ? 'Intake folder added' : 'Intake folder updated');
      await refreshStatus();
    },
    onError: (error) => setIntakeError(messageOf(error)),
  });
  const removeIntakeMutation = useMutation({
    mutationFn: removeIntake,
    onSuccess: async () => {
      showToast('Intake folder removed');
      await refreshStatus();
    },
    onError: (error) => showToast(messageOf(error), { error: true }),
  });
  const emptyTrashMutation = useMutation({
    mutationFn: emptyTrash,
    onSuccess: (result) => showToast(`Removed ${result.removed} ${result.removed === 1 ? 'file' : 'files'}`),
    onError: (error) => showToast(messageOf(error), { error: true }),
  });

  if (statusQuery.error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(statusQuery.error)}</p>
        <button className="btn" onClick={() => { void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!statusQuery.data) return <div className="page"><p className="muted">Loading…</p></div>;

  const status = statusQuery.data;
  const selectedGap = gapMode ?? status.settings.gap_mode;
  const closeIntakeDialog = () => {
    if (saveIntakeMutation.isPending) return;
    setIntakeDraft(null);
    setIntakeError(null);
  };
  const openIntakeDialog = (intake?: IntakeEntry) => {
    setIntakeError(null);
    setIntakeDraft({
      index: intake?.index ?? null,
      path: intake?.path ?? '',
      recursive: intake?.recursive ?? true,
      remove_empty_folders: intake?.remove_empty_folders ?? false,
    });
  };
  const submitIntake = () => {
    if (!intakeDraft) return;
    const request: IntakeDraft & IntakeRequest = {
      ...intakeDraft,
      path: (intakePathRef.current?.value ?? intakeDraft.path).trim(),
      recursive: recursiveRef.current?.checked ?? intakeDraft.recursive,
      remove_empty_folders: removeEmptyRef.current?.checked ?? intakeDraft.remove_empty_folders,
    };
    if (!request.path) {
      setIntakeError('Folder path is required.');
      return;
    }
    setIntakeError(null);
    saveIntakeMutation.mutate(request);
  };
  const removeWatchedFolder = async (intake: IntakeEntry) => {
    const confirmed = await confirmDialog(`Stop watching ${intake.path}?`, 'Remove', true);
    if (confirmed) removeIntakeMutation.mutate(intake.index);
  };
  const clearTrash = async () => {
    const confirmed = await confirmDialog(
      'Permanently remove everything in the trash? This cannot be undone.',
      'Remove for good',
      true,
    );
    if (confirmed) emptyTrashMutation.mutate();
  };
  const onGapModeChange = (value: string) => {
    const mode = GAP_MODES.find((candidate) => candidate === value);
    if (!mode) {
      showToast('Invalid numbering option', { error: true });
      return;
    }
    setGapMode(mode);
    gapMutation.mutate(mode);
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1><span className="sub">version {status.version}</span></div>
      <div className="panel">
        <h2>Numbering</h2>
        <div className="field">
          <label htmlFor="settings-gap-mode">Gaps in the numbering</label>
          <select
            id="settings-gap-mode"
            className="select"
            aria-label="Gaps in the numbering"
            value={selectedGap}
            disabled={gapMutation.isPending}
            onChange={(event) => onGapModeChange(event.currentTarget.value)}
          >
            <option value="keep">Keep gaps</option>
            <option value="lowest">Fill with the next image</option>
            <option value="last">Move the last image into the gap</option>
            <option value="renumber">Renumber everything</option>
          </select>
          <div className="muted">{GAP_TEXT[selectedGap]}</div>
        </div>
      </div>
      <div className="panel watched-folders">
        <h2>Watched folders</h2>
        <div className="watched-list">
          <WatchedEntry path={status.library} library />
          {status.intake.map((intake) => (
            <WatchedEntry
              key={intake.path}
              {...intake}
              onEdit={() => openIntakeDialog(intake)}
              onRemove={() => { void removeWatchedFolder(intake); }}
            />
          ))}
        </div>
        <div className="watched-footer">
          <button className="btn small" onClick={() => openIntakeDialog()}>Add folder</button>
        </div>
      </div>
      <div className="panel">
        <h2>Images</h2>
        <div className="row">{status.settings.image_extensions.map((extension) => <span className="tagchip" key={extension}>{extension}</span>)}</div>
        <p className="faint">Copies of images you already have go to the “{status.settings.duplicates_folder}” folder.</p>
      </div>
      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg" role="group" aria-label="Theme">
          {THEMES.map((value) => (
            <button key={value} className={theme === value ? 'on' : ''} onClick={() => setTheme(value)}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>Trash</h2>
        <p className="muted">Deleted images wait in a hidden folder inside the library until you empty it.</p>
        <button className="btn danger" disabled={emptyTrashMutation.isPending} onClick={() => { void clearTrash(); }}>Empty trash</button>
      </div>
      <div className="panel">
        <h2>This page</h2>
        <p className="muted">Served from <span className="m">{window.location.host}</span> on this computer only.</p>
      </div>
      {intakeDraft ? (
        <dialog
          ref={intakeDialogRef}
          className="sheet"
          aria-label={intakeDraft.index === null ? 'Add intake folder' : 'Edit intake folder'}
          onCancel={(event) => {
            event.preventDefault();
            closeIntakeDialog();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeIntakeDialog();
          }}
        >
          <header>
            <h2>{intakeDraft.index === null ? 'Add intake folder' : 'Edit intake folder'}</h2>
            <button className="btn small icon-btn" type="button" aria-label="Close" title="Close" onClick={closeIntakeDialog}>×</button>
          </header>
          <div className="content">
            <div className="field">
              <label htmlFor="intake-folder-path">Folder path</label>
              <input
                ref={intakePathRef}
                id="intake-folder-path"
                className="input wide"
                defaultValue={intakeDraft.path}
                aria-label="Intake folder path"
                placeholder="/absolute/path/to/downloads"
              />
            </div>
            <div className="field">
              <div className="check-row">
                <input ref={recursiveRef} type="checkbox" id="intake-recursive" defaultChecked={intakeDraft.recursive} />
                <label htmlFor="intake-recursive">Include subfolders</label>
              </div>
            </div>
            <div className="field">
              <div className="check-row">
                <input ref={removeEmptyRef} type="checkbox" id="intake-remove-empty" defaultChecked={intakeDraft.remove_empty_folders} />
                <label htmlFor="intake-remove-empty">Remove empty subfolders</label>
              </div>
              <span className="faint">Off by default. Hidden folders are never removed.</span>
            </div>
            {intakeError ? <p className="error" role="alert">{intakeError}</p> : null}
          </div>
          <footer>
            <button className="btn" type="button" onClick={closeIntakeDialog}>Cancel</button>
            <button className="btn primary" type="button" disabled={saveIntakeMutation.isPending} onClick={submitIntake}>Save</button>
          </footer>
        </dialog>
      ) : null}
    </div>
  );
}
