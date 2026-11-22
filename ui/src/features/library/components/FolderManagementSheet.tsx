import { useRef, useState } from 'react';
import { confirmDialog } from '../../../components/dialogs';
import { useNativeDialog } from '../../../components/useNativeDialog';
import type { FileActionResponse } from '../../files/schemas';
import { getFolderChangePreview } from '../api';
import type { FolderChangeRequest, LibraryFolder } from '../schemas';
import type { ChangePreviewState, ChangePreviews } from '../types';
import { messageOf } from '../utils';
import { FolderChangeSection } from './FolderChangeSection';

interface FolderManagementSheetProps {
  folder: LibraryFolder;
  folders: LibraryFolder[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onApply: (request: FolderChangeRequest) => Promise<FileActionResponse>;
  onApplied: (request: FolderChangeRequest, result: FileActionResponse) => Promise<void>;
}

export function FolderManagementSheet({
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
  const [logo, setLogo] = useState<{ dataUrl: string; tint: boolean } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ws-folder-logos') || '{}');
      return saved?.[folder.path] ?? null;
    } catch {
      return null;
    }
  });
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useNativeDialog(dialogRef);
  const destinations = folders.filter((entry) => entry.path !== folder.path && !entry.path.startsWith(`${folder.path}/`));

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
    const label = state.request.kind === 'prefix'
      ? `Save the prefix “${state.request.prefix}”?`
      : state.request.kind === 'rename'
        ? `Rename ${state.request.from} to ${state.request.to}?`
        : `Merge ${state.request.from} into ${state.request.to}?`;
    const confirmed = await confirmDialog(
      `${label} ${preview.changes ? 'File changes are logged and can be undone.' : 'No files need renaming.'}`,
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

  const previewRename = () => {
    void previewChange({ kind: 'rename', from: folder.path, to: renameRef.current?.value.trim() ?? '' });
  };
  const previewMerge = () => {
    void previewChange({ kind: 'merge', from: folder.path, to: mergeRef.current?.value ?? '' });
  };
  const previewPrefix = () => {
    void previewChange({ kind: 'prefix', folder: folder.path, prefix: prefixRef.current?.value.trim() ?? '' });
  };

  const saveLogo = (next: { dataUrl: string; tint: boolean } | null) => {
    try {
      const saved = JSON.parse(localStorage.getItem('ws-folder-logos') || '{}');
      if (next) saved[folder.path] = next;
      else delete saved[folder.path];
      localStorage.setItem('ws-folder-logos', JSON.stringify(saved));
      setLogo(next);
      setLogoError(null);
      window.dispatchEvent(new CustomEvent('ws-folder-logo-changed', { detail: { path: folder.path } }));
    } catch {
      setLogoError('Could not save the folder logo in this browser.');
    }
  };

  const readLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(svg\+xml|png|jpeg|webp)$/.test(file.type) || file.size > 2 * 1024 * 1024) {
      setLogoError('Choose a PNG, JPG, WebP or SVG under 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogo({ dataUrl: reader.result, tint: logo?.tint ?? false });
        setLogoError(null);
      }
    };
    reader.readAsDataURL(file);
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
        <section className="folder-logo-section">
          <h3>Folder logo</h3>
          <p className="muted">Shown instead of the folder name in the sidebar and page title. PNG, JPG, WebP or SVG up to 2 MB.</p>
          <div className="folder-logo-preview">
            {logo ? (
              <img
                className={logo.tint ? 'folder-logo tint' : 'folder-logo'}
                src={logo.dataUrl}
                alt={`${folder.name} logo preview`}
              />
            ) : <span className="folder-logo-name">{folder.name}</span>}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
            hidden
            onChange={(event) => readLogo(event.target.files?.[0])}
          />
          <div className="row">
            <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Choose image or SVG…</button>
            <button className="btn danger" type="button" disabled={!logo} onClick={() => saveLogo(null)}>Remove logo</button>
          </div>
          {logo ? (
            <label className="check-row folder-logo-tint">
              <input
                type="checkbox"
                checked={logo.tint}
                onChange={(event) => setLogo({ ...logo, tint: event.target.checked })}
              />
              Match light and dark
            </label>
          ) : null}
          {logoError ? <p className="error" role="alert">{logoError}</p> : null}
          {logo ? (
            <button className="btn primary" type="button" onClick={() => saveLogo(logo)}>Save logo</button>
          ) : null}
        </section>
        <FolderChangeSection
          kind="rename"
          title="Rename"
          control={<input ref={renameRef} className="input wide" defaultValue={folder.path} aria-label="New folder path" />}
          allowNoFiles={false}
          pending={pending}
          state={previews.rename}
          onPreview={previewRename}
          onApply={() => { const state = previews.rename; if (state) void applyPreview(state); }}
        />
        <FolderChangeSection
          kind="merge"
          title="Merge into"
          control={(
            <select ref={mergeRef} className="select" aria-label="Merge destination" defaultValue={destinations[0]?.path ?? ''}>
              {destinations.map((entry) => <option key={entry.path} value={entry.path}>{entry.path}</option>)}
            </select>
          )}
          allowNoFiles={false}
          pending={pending}
          state={previews.merge}
          onPreview={previewMerge}
          onApply={() => { const state = previews.merge; if (state) void applyPreview(state); }}
        />
        <FolderChangeSection
          kind="prefix"
          title="Numbering prefix"
          control={<input ref={prefixRef} className="input wide" defaultValue={folder.prefix} aria-label="File prefix" />}
          allowNoFiles
          pending={pending}
          state={previews.prefix}
          onPreview={previewPrefix}
          onApply={() => { const state = previews.prefix; if (state) void applyPreview(state); }}
        />
        {applyError || error ? <p className="error" role="alert">{applyError ?? error}</p> : null}
      </div>
      <footer><button className="btn" type="button" disabled={pending} onClick={onClose}>Done</button></footer>
    </dialog>
  );
}
