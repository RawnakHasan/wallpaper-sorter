import { WatchedEntry } from './components/WatchedEntry';
import { IntakeSheet } from './components/IntakeSheet';
import { FetchSettings } from './components/FetchSettings';
import { WallpaperApplySettings } from './components/WallpaperApplySettings';
import { useSettingsPage } from './hooks/useSettingsPage';
import { gapText, messageOf, themes } from './utils';

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
        <h2>Appearance</h2>
        <div className="seg" role="group" aria-label="Theme">
          {themes.map((value) => (
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
