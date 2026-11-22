import { useState } from 'react';
import { WatchedEntry } from './components/WatchedEntry';
import { IntakeSheet } from './components/IntakeSheet';
import { FetchSettings } from './components/FetchSettings';
import { WallpaperApplySettings } from './components/WallpaperApplySettings';
import { useSettingsPage } from './hooks/useSettingsPage';
import { gapText, messageOf, themes } from './utils';
import { useMotionStore } from '../../stores/motion';
import { useToastStore } from '../../stores/toast';

export function SettingsPage() {
  const {
    statusQuery,
    status,
    theme,
    setTheme,
    selectedGap,
    gapMutation,
    intakeDraft,
    intakeError,
    saveIntakeMutation,
    emptyTrashMutation,
    closeIntakeDialog,
    openIntakeDialog,
    saveIntakeDraft,
    removeWatchedFolder,
    clearTrash,
    onGapModeChange,
  } = useSettingsPage();
  const motionEnabled = useMotionStore((state) => state.enabled);
  const setMotionEnabled = useMotionStore((state) => state.setEnabled);
  const [monitorResolution, setMonitorResolution] = useState(() => {
    try {
      return localStorage.getItem('ws-monitor-resolution') || '2560×1440';
    } catch {
      return '2560×1440';
    }
  });
  const [gitPreferences, setGitPreferences] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('ws-git-preferences') || '{}');
      return {
        repository: typeof saved.repository === 'string' ? saved.repository : '',
        remote: typeof saved.remote === 'string' ? saved.remote : 'origin',
        branch: typeof saved.branch === 'string' ? saved.branch : 'main',
        excludeTrash: saved.excludeTrash !== false,
      };
    } catch {
      return { repository: '', remote: 'origin', branch: 'main', excludeTrash: true };
    }
  });

  if (statusQuery.error) {
    return (
      <div className="page">
        <p className="error" role="alert">{messageOf(statusQuery.error)}</p>
        <button className="btn" onClick={() => { void statusQuery.refetch(); }}>Try again</button>
      </div>
    );
  }
  if (!status) return <div className="page"><p className="muted">Loading…</p></div>;

  return (
    <div className="page settings-page">
      <div className="page-head"><h1>Settings</h1><span className="sub">version {status.version}</span></div>
      <div className="settings-masonry">
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
          <div className="muted">{gapText[selectedGap]}</div>
        </div>
      </div>
      <div className="panel watched-folders">
        <h2>Watched folders</h2>
        <div className="watched-list">
          <WatchedEntry path={status.library} library />
          {status.intake.map((intake) => (
            <WatchedEntry
              key={intake.path}
              intake={intake}
              path={intake.path}
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
      <FetchSettings settings={status.settings} />
      <WallpaperApplySettings settings={status.settings} />
      <div className="panel">
        <div className="settings-panel-heading">
          <h2>Display</h2>
          <span className="auto-save">Saves instantly</span>
        </div>
        <p className="muted">Used by “Fits my monitor” in the Library.</p>
        <label htmlFor="monitor-resolution">Monitor resolution</label>
        <input
          id="monitor-resolution"
          className="input wide mono"
          value={monitorResolution}
          onChange={(event) => {
            const value = event.target.value;
            setMonitorResolution(value);
            try {
              localStorage.setItem('ws-monitor-resolution', value);
            } catch {
              // Display preference is optional.
            }
          }}
        />
      </div>
      <div className="panel">
        <div className="settings-panel-heading">
          <h2>Git</h2>
        </div>
        <p className="muted">Used by the Git page. Pushes use system git and SSH keys; no password is stored here.</p>
        <div className="field">
          <label htmlFor="git-repository">Repository folder</label>
          <input
            id="git-repository"
            className="input wide mono"
            value={gitPreferences.repository}
            placeholder={status.library}
            onChange={(event) => setGitPreferences((current) => ({ ...current, repository: event.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="git-remote">Remote URL</label>
          <input
            id="git-remote"
            className="input wide mono"
            value={gitPreferences.remote}
            onChange={(event) => setGitPreferences((current) => ({ ...current, remote: event.target.value }))}
            placeholder="origin"
          />
        </div>
        <div className="field">
          <label htmlFor="git-branch">Branch</label>
          <input
            id="git-branch"
            className="input wide mono"
            value={gitPreferences.branch}
            onChange={(event) => setGitPreferences((current) => ({ ...current, branch: event.target.value }))}
          />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={gitPreferences.excludeTrash}
            onChange={(event) => setGitPreferences((current) => ({ ...current, excludeTrash: event.target.checked }))}
          />
          Leave out Trash and Duplicates
        </label>
        <button
          className="button button-primary"
          type="button"
          onClick={() => {
            try {
              localStorage.setItem('ws-git-preferences', JSON.stringify(gitPreferences));
              useToastStore.getState().show('Git settings saved');
            } catch {
              useToastStore.getState().show('Could not save Git settings', { error: true });
            }
          }}
        >
          Save Git settings
        </button>
      </div>
      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg" role="group" aria-label="Theme">
          {themes.map((value) => (
            <button key={value} className={theme === value ? 'on' : ''} onClick={() => setTheme(value)}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <div className="settings-switch-row">
          <span>
            Animations
            <small>Entrances, panel slides and row transitions.</small>
          </span>
          <button
            className="switch-control"
            role="switch"
            aria-label="Animations"
            aria-checked={motionEnabled}
            type="button"
            onClick={() => setMotionEnabled(!motionEnabled)}
          >
            <span className="switch-thumb" />
          </button>
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
      </div>
      {intakeDraft ? (
        <IntakeSheet
          draft={intakeDraft}
          pending={saveIntakeMutation.isPending}
          error={intakeError}
          onClose={closeIntakeDialog}
          onSave={saveIntakeDraft}
        />
      ) : null}
    </div>
  );
}
