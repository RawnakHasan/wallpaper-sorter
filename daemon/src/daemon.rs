//! The run loop: watch the folders, wait for files to be finished, hand them to the pipeline.

use crate::debounce::Debouncer;
use crate::watcher::{wait_readable, DirWatcher, Event};
use serde::{Deserialize, Serialize};
use sorter_core::{expand_home, Config};
use sorter_engine::{
    file_stat, move_no_replace, write_atomic, Entry, ExecError, Kind, Outcome, Pipeline, UndoError,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub struct Options {
    /// A new file is sorted once nothing has happened to it, and its size has not changed, for this long.
    pub stable_for: Duration,
    /// An intake subfolder is removed once it has been empty for this long.
    pub cleanup_after: Duration,
    /// How often the housekeeping runs (empty folders, intake folders that were missing).
    pub cleanup_every: Duration,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            stable_for: Duration::from_millis(1000),
            cleanup_after: Duration::from_secs(600),
            cleanup_every: Duration::from_secs(60),
        }
    }
}

pub enum Notice {
    Processed(Outcome),
    Error(String),
}

struct IntakeDir {
    path: PathBuf,
    recursive: bool,
    remove_empty: bool,
    active: bool,
    last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct IntakeWatchStatus {
    pub path: PathBuf,
    pub recursive: bool,
    pub remove_empty_folders: bool,
    pub watching: bool,
    pub error: Option<String>,
}

/// What the watcher thread and the web server share.
pub struct Shared {
    pipeline: Mutex<Pipeline>,
    /// Files that an undo put back: they are left alone until they change.
    held: Mutex<HashMap<PathBuf, (u64, u64)>>,
    rescan: AtomicBool,
    wake: UnixStream,
    /// The config file the tags are edited in (None if the program was not started from one).
    pub config_path: Option<PathBuf>,
    config_edit: Mutex<()>,
    config_undo: Mutex<HashMap<u64, ConfigUndo>>,
    config_undo_path: PathBuf,
    intake_watch: Mutex<Vec<IntakeWatchStatus>>,
    config_mtime: Mutex<std::time::SystemTime>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConfigUndoKind {
    #[default]
    Snapshot,
    Rename,
    Merge,
    Prefix,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConfigUndo {
    before: String,
    after: String,
    #[serde(default)]
    kind: ConfigUndoKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    prefix: Option<String>,
}

impl Shared {
    pub fn lock(&self) -> MutexGuard<'_, Pipeline> {
        self.pipeline.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Wakes the watcher loop so it looks at what changed.
    pub fn wake(&self) {
        let _ = (&self.wake).write(&[1]);
    }

    /// Reload the config file after a hand edit or explicit reload request.
    pub fn reload_config(&self) -> Result<bool, String> {
        let Some(path) = self.config_path.as_deref() else {
            return Ok(false);
        };
        let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let cfg = Config::from_toml(&text).map_err(|e| format!("{}: {e}", path.display()))?;

        let _guard = self.config_edit.lock().unwrap_or_else(|e| e.into_inner());
        self.lock().set_config(cfg);
        let mtime = fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        *self.config_mtime.lock().unwrap_or_else(|e| e.into_inner()) = mtime;
        self.request_rescan();
        Ok(true)
    }

    pub fn reload_config_if_changed(&self) -> Result<bool, String> {
        let Some(path) = self.config_path.as_deref() else {
            return Ok(false);
        };
        let current = fs::metadata(path)
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let previous = *self.config_mtime.lock().unwrap_or_else(|e| e.into_inner());
        if current == previous {
            return Ok(false);
        }
        self.reload_config()
    }

    pub fn intake_watch_status(&self) -> Vec<IntakeWatchStatus> {
        self.intake_watch
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn set_intake_watch_status(&self, intake: &[IntakeDir]) {
        let status = intake
            .iter()
            .map(|dir| IntakeWatchStatus {
                path: dir.path.clone(),
                recursive: dir.recursive,
                remove_empty_folders: dir.remove_empty,
                watching: dir.active,
                error: dir.last_error.clone(),
            })
            .collect();
        *self.intake_watch.lock().unwrap_or_else(|e| e.into_inner()) = status;
    }

    /// Ask the watcher to look at everything again (files in the library folder and the intake folders).
    pub fn request_rescan(&self) {
        self.rescan.store(true, Ordering::SeqCst);
        self.wake();
    }

    fn hold(&self, entries: &[Entry]) {
        let mut held = self.held.lock().unwrap_or_else(|e| e.into_inner());
        for u in entries {
            let p = PathBuf::from(&u.to);
            if let Ok(fp) = file_stat(&p) {
                held.insert(p, fp);
            }
        }
    }

    fn restore_held(&self) {
        let entries: Vec<Entry> = self.lock().log.entries().to_vec();
        let mut held = self.held.lock().unwrap_or_else(|e| e.into_inner());
        let mut seen = HashSet::new();
        for u in entries.iter().rev() {
            if u.kind != Kind::Undo {
                continue;
            }
            let p = PathBuf::from(&u.to);
            if !seen.insert(p.clone()) {
                continue;
            }
            let (Some(size), Some(mtime_ns)) = (u.hold_size, u.hold_mtime_ns) else {
                continue;
            };
            if file_stat(&p).ok() == Some((size, mtime_ns)) {
                held.insert(p, (size, mtime_ns));
            }
        }
    }

    /// Undo a batch. The files that come back are not sorted again until they change.
    pub fn undo_batch(&self, batch: u64) -> Result<Vec<Entry>, UndoError> {
        self.check_config_undo(batch)?;
        let undone = self.lock().undo_batch(batch)?;
        self.hold(&undone);
        self.restore_config_undo(batch)?;
        Ok(undone)
    }

    pub fn undo_entry(&self, id: u64) -> Result<Entry, UndoError> {
        let batch = self
            .lock()
            .log
            .get(id)
            .map(|entry| entry.batch)
            .ok_or(UndoError::NotFound(id))?;
        self.check_config_undo(batch)?;
        let undone = self.lock().undo_entry(id)?;
        self.hold(std::slice::from_ref(&undone));
        let complete = {
            let pipeline = self.lock();
            pipeline
                .log
                .entries()
                .iter()
                .filter(|entry| entry.batch == batch && entry.kind != sorter_engine::Kind::Undo)
                .all(|entry| pipeline.log.is_undone(entry.id))
        };
        if complete {
            self.restore_config_undo(batch)?;
        }
        Ok(undone)
    }

    /// Changes the config file with `change` (which gets the current text and returns the new text),
    /// checks that the result still loads, saves it, and makes the running program use it.
    pub fn edit_config(
        &self,
        change: impl FnOnce(&str) -> Result<String, String>,
    ) -> Result<(), String> {
        let _guard = self.config_edit.lock().unwrap_or_else(|e| e.into_inner());
        let path = self
            .config_path
            .as_ref()
            .ok_or("the program was not started from a config file")?;
        let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let new_text = change(&text)?;
        let cfg = Config::from_toml(&new_text).map_err(|e| e.to_string())?;
        write_atomic(path, &new_text).map_err(|e| format!("{}: {e}", path.display()))?;
        self.lock().set_config(cfg);
        Ok(())
    }

    pub fn config_text(&self) -> Result<String, String> {
        let _guard = self.config_edit.lock().unwrap_or_else(|e| e.into_inner());
        let path = self
            .config_path
            .as_ref()
            .ok_or("the program was not started from a config file")?;
        fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
    }

    pub fn record_config_undo(
        &self,
        batch: u64,
        before: String,
        kind: ConfigUndoKind,
        from: Option<String>,
        to: Option<String>,
        prefix: Option<String>,
    ) -> Result<(), String> {
        let after = self.config_text()?;
        let mut undo = self.config_undo.lock().unwrap_or_else(|e| e.into_inner());
        undo.insert(
            batch,
            ConfigUndo {
                before,
                after,
                kind,
                from,
                to,
                prefix,
            },
        );
        let text = serde_json::to_string(&*undo).map_err(|e| e.to_string())?;
        write_atomic(&self.config_undo_path, &text).map_err(|e| e.to_string())
    }

    fn check_config_undo(&self, batch: u64) -> Result<(), UndoError> {
        let saved = self
            .config_undo
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&batch)
            .cloned();
        let Some(saved) = saved else { return Ok(()) };
        if saved.kind == ConfigUndoKind::Snapshot {
            let path = self
                .config_path
                .as_ref()
                .ok_or(UndoError::ConfigChangedAfterFolderChange)?;
            let _guard = self.config_edit.lock().unwrap_or_else(|e| e.into_inner());
            let current = fs::read_to_string(path).map_err(UndoError::Log)?;
            if current != saved.after {
                return Err(UndoError::ConfigChangedAfterFolderChange);
            }
        }
        Ok(())
    }

    fn restore_config_undo(&self, batch: u64) -> Result<(), UndoError> {
        let saved = self
            .config_undo
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&batch)
            .cloned();
        let Some(saved) = saved else { return Ok(()) };
        let path = self
            .config_path
            .as_ref()
            .ok_or(UndoError::NotUndoable(batch))?;
        let _guard = self.config_edit.lock().unwrap_or_else(|e| e.into_inner());
        let current = fs::read_to_string(path).map_err(UndoError::Log)?;
        let inverse = if current == saved.after {
            saved.before.clone()
        } else {
            match saved.kind {
                ConfigUndoKind::Rename => {
                    let (Some(from), Some(to)) = (saved.from.as_deref(), saved.to.as_deref())
                    else {
                        return Err(UndoError::NotUndoable(batch));
                    };
                    sorter_engine::cfgedit::undo_rename_folder(
                        &current,
                        &saved.before,
                        &saved.after,
                        from,
                        to,
                    )
                    .map_err(|e| UndoError::Log(io::Error::new(io::ErrorKind::InvalidData, e)))?
                }
                ConfigUndoKind::Merge => {
                    let (Some(from), Some(to)) = (saved.from.as_deref(), saved.to.as_deref())
                    else {
                        return Err(UndoError::NotUndoable(batch));
                    };
                    sorter_engine::cfgedit::undo_merge_folder(
                        &current,
                        &saved.before,
                        &saved.after,
                        from,
                        to,
                    )
                    .map_err(|e| UndoError::Log(io::Error::new(io::ErrorKind::InvalidData, e)))?
                }
                ConfigUndoKind::Prefix => {
                    let Some(folder) = saved.from.as_deref() else {
                        return Err(UndoError::NotUndoable(batch));
                    };
                    sorter_engine::cfgedit::undo_prefix_change(&current, &saved.before, folder)
                        .map_err(|e| {
                            UndoError::Log(io::Error::new(io::ErrorKind::InvalidData, e))
                        })?
                }
                ConfigUndoKind::Snapshot => saved.before.clone(),
            }
        };
        let cfg = Config::from_toml(&inverse)
            .map_err(|e| UndoError::Log(io::Error::new(io::ErrorKind::InvalidData, e)))?;
        write_atomic(path, &inverse).map_err(UndoError::Log)?;
        self.lock().set_config(cfg);
        let mut undo = self.config_undo.lock().unwrap_or_else(|e| e.into_inner());
        undo.remove(&batch);
        let text = serde_json::to_string(&*undo)
            .map_err(|e| UndoError::Log(io::Error::new(io::ErrorKind::InvalidData, e)))?;
        write_atomic(&self.config_undo_path, &text).map_err(UndoError::Log)
    }
}

pub struct Daemon {
    shared: Arc<Shared>,
    wake_rx: UnixStream,
    root: PathBuf,
    opts: Options,
    watcher: DirWatcher,
    deb: Debouncer,
    intake: Vec<IntakeDir>,
    next_tick: Instant,
}

fn is_image_name(name: &str, exts: &[String]) -> bool {
    if name.starts_with('.') {
        return false;
    }
    let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    exts.iter().any(|e| e.eq_ignore_ascii_case(ext))
}

fn mtime(p: &Path) -> std::time::SystemTime {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::UNIX_EPOCH)
}

impl Daemon {
    /// Opens the library, starts watching, and queues every image that is already waiting
    /// (loose in the library folder, or in an intake folder).
    pub fn start(root: PathBuf, cfg: Config, opts: Options) -> io::Result<Daemon> {
        Daemon::start_with(root, cfg, opts, None)
    }

    pub fn start_with(
        root: PathBuf,
        cfg: Config,
        opts: Options,
        config_path: Option<PathBuf>,
    ) -> io::Result<Daemon> {
        recover_fetch_temp(&root)?;
        let intake: Vec<IntakeDir> = cfg
            .intake
            .iter()
            .map(|i| IntakeDir {
                path: expand_home(&i.path),
                recursive: i.recursive,
                remove_empty: i.remove_empty_folders,
                active: false,
                last_error: None,
            })
            .collect();
        let pipeline = Pipeline::open(&root, cfg)?;
        let config_undo_path = root.join(".sorter/folder-config-undo.json");
        let config_undo = match fs::read_to_string(&config_undo_path) {
            Ok(text) => serde_json::from_str(&text)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => HashMap::new(),
            Err(e) => return Err(e),
        };
        let (wake_tx, wake_rx) = UnixStream::pair()?;
        wake_tx.set_nonblocking(true)?;
        wake_rx.set_nonblocking(true)?;
        let shared = Arc::new(Shared {
            pipeline: Mutex::new(pipeline),
            held: Mutex::new(HashMap::new()),
            rescan: AtomicBool::new(false),
            wake: wake_tx,
            config_path: config_path.clone(),
            config_edit: Mutex::new(()),
            config_undo: Mutex::new(config_undo),
            config_undo_path,
            intake_watch: Mutex::new(Vec::new()),
            config_mtime: Mutex::new(
                config_path
                    .as_deref()
                    .and_then(|p| fs::metadata(p).ok())
                    .and_then(|m| m.modified().ok())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            ),
        });
        shared.restore_held();
        let mut d = Daemon {
            shared,
            wake_rx,
            root,
            deb: Debouncer::new(opts.stable_for),
            next_tick: Instant::now() + opts.cleanup_every,
            opts,
            watcher: DirWatcher::new()?,
            intake,
        };
        let found = d.watcher.add(&d.root.clone(), false)?;
        d.queue_found(found);
        d.activate_intake();
        Ok(d)
    }

    /// What the web server uses.
    pub fn handle(&self) -> Arc<Shared> {
        self.shared.clone()
    }

    pub fn pipeline(&self) -> MutexGuard<'_, Pipeline> {
        self.shared.lock()
    }

    fn exts(&self) -> Vec<String> {
        self.shared.lock().cfg.settings.image_extensions.clone()
    }

    fn queue_found(&mut self, files: Vec<PathBuf>) {
        let exts = self.exts();
        for f in files {
            let name = f
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if is_image_name(&name, &exts) {
                let mut held = self.shared.held.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(fp) = held.get(&f).copied() {
                    if file_stat(&f).ok() == Some(fp) {
                        continue;
                    }
                    held.remove(&f);
                }
                drop(held);
                self.deb.push_stable(f);
            }
        }
    }

    /// Starts watching every intake folder that exists and is not watched yet.
    fn activate_intake(&mut self) {
        for i in 0..self.intake.len() {
            let (path, recursive) = (self.intake[i].path.clone(), self.intake[i].recursive);
            if path.is_dir() {
                if !self.intake[i].active {
                    let result = self.watcher.add(&path, recursive);
                    let errors = self.watcher.take_errors();
                    match result {
                        Ok(found) => {
                            self.intake[i].active = true;
                            self.intake[i].last_error = None;
                            self.queue_found(found);
                        }
                        Err(error) => {
                            let message = error.to_string();
                            eprintln!("wallpaper-sorter: {message}");
                            self.intake[i].active = false;
                            self.intake[i].last_error = Some(message);
                        }
                    }
                    self.record_watcher_errors(errors);
                }
            } else {
                self.intake[i].active = false;
            }
        }
        self.shared.set_intake_watch_status(&self.intake);
    }

    fn record_watcher_errors(&mut self, errors: Vec<(PathBuf, String)>) {
        for (path, error) in errors {
            eprintln!("wallpaper-sorter: {error}");
            if let Some(intake) = self
                .intake
                .iter_mut()
                .filter(|intake| path.starts_with(&intake.path))
                .max_by_key(|intake| intake.path.components().count())
            {
                intake.last_error = Some(error);
            }
        }
    }

    /// Looks at everything again (after the kernel dropped events, or on request).
    pub fn rescan(&mut self) {
        // Intake configuration can change while the daemon is running. Rebuild the inotify
        // set from the current config instead of only reacting to already-open watches.
        self.watcher.clear();
        if let Ok(found) = self.watcher.add(&self.root.clone(), false) {
            self.queue_found(found);
        }
        let cfg_intake = self.shared.lock().cfg.intake.clone();
        self.intake = cfg_intake
            .iter()
            .map(|i| IntakeDir {
                path: expand_home(&i.path),
                recursive: i.recursive,
                remove_empty: i.remove_empty_folders,
                active: false,
                last_error: None,
            })
            .collect();
        self.activate_intake();

        let mut found = Vec::new();
        if let Ok(rd) = fs::read_dir(&self.root) {
            found.extend(
                rd.flatten()
                    .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                    .map(|e| e.path()),
            );
        }
        for i in &self.intake {
            collect_files(&i.path, i.recursive, &mut found);
        }
        self.queue_found(found);
    }

    fn on_file(&mut self, path: PathBuf) {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if !is_image_name(&name, &self.exts()) {
            return;
        }
        {
            let mut held = self.shared.held.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(fp) = held.get(&path).copied() {
                if file_stat(&path).ok() == Some(fp) {
                    return; // an undo put it back; leave it alone
                }
                held.remove(&path);
            }
        }
        let size = fs::metadata(&path).ok().map(|m| m.len());
        self.deb.event(path, Instant::now(), size);
    }

    /// The files that are waiting and finished right now (for a one-off run).
    pub fn take_waiting(&mut self) -> Vec<PathBuf> {
        let mut ready = self
            .deb
            .poll(Instant::now(), |p| fs::metadata(p).ok().map(|m| m.len()));
        ready.sort_by_key(|p| (mtime(p), p.clone()));
        ready
    }

    /// Waits up to `max_wait` for something to happen, then does whatever is due: sorting finished files,
    /// housekeeping. Returns what it did.
    pub fn step(&mut self, max_wait: Duration) -> io::Result<Vec<Notice>> {
        let now = Instant::now();
        let mut wait = max_wait.min(self.next_tick.saturating_duration_since(now));
        if let Some(d) = self.deb.next_wait(now) {
            wait = wait.min(d);
        }
        if wait > Duration::ZERO {
            wait_readable(
                &[self.watcher.fd(), self.wake_rx.as_raw_fd()],
                wait.as_millis().clamp(1, 60_000) as i32,
            );
        }
        let mut sink = [0u8; 64];
        while matches!((&self.wake_rx).read(&mut sink), Ok(n) if n > 0) {}
        if self.shared.rescan.swap(false, Ordering::SeqCst) {
            self.rescan();
        }
        let mut intake_watch_lost = false;
        for ev in self.watcher.read()? {
            match ev {
                Event::File(p) => self.on_file(p),
                Event::Overflow => self.rescan(),
                Event::WatchLost(path) if path == self.root => {
                    match self.watcher.add(&self.root.clone(), false) {
                        Ok(found) => self.queue_found(found),
                        Err(error) => eprintln!("wallpaper-sorter: {error}"),
                    }
                }
                Event::WatchLost(path) => {
                    for intake in &mut self.intake {
                        if path.starts_with(&intake.path) {
                            intake.active = false;
                            intake.last_error =
                                Some(format!("watch lost for {}; retrying", path.display()));
                            intake_watch_lost = true;
                        }
                    }
                }
            }
        }
        let watcher_errors = self.watcher.take_errors();
        self.record_watcher_errors(watcher_errors);
        if intake_watch_lost {
            self.activate_intake();
        } else {
            self.shared.set_intake_watch_status(&self.intake);
        }

        let mut notices = Vec::new();
        let ready = self.take_waiting();
        if !ready.is_empty() {
            let result = self.shared.lock().process(&ready);
            match result {
                Ok(outcome) => notices.push(Notice::Processed(outcome)),
                Err(e) => notices.push(Notice::Error(format!("sorting failed: {e}"))),
            }
        }
        if Instant::now() >= self.next_tick {
            match self.shared.reload_config_if_changed() {
                Ok(false) => {}
                Ok(true) => println!("wallpaper-sorter: reloaded config"),
                Err(error) => eprintln!("wallpaper-sorter: config not reloaded: {error}"),
            }
            self.activate_intake();
            for i in &self.intake {
                if i.remove_empty && i.recursive && i.path.is_dir() {
                    remove_empty_dirs(&i.path, self.opts.cleanup_after, true);
                }
            }
            self.next_tick = Instant::now() + self.opts.cleanup_every;
        }
        Ok(notices)
    }

    /// Runs until `stop` is set.
    pub fn run(
        &mut self,
        stop: &AtomicBool,
        reload: &AtomicBool,
        on_notice: &mut dyn FnMut(Notice),
    ) -> io::Result<()> {
        while !stop.load(Ordering::SeqCst) {
            if reload.swap(false, Ordering::SeqCst) {
                match self.shared.reload_config() {
                    Ok(true) => println!("wallpaper-sorter: reloaded config"),
                    Ok(false) => {}
                    Err(error) => eprintln!("wallpaper-sorter: config not reloaded: {error}"),
                }
            }
            for n in self.step(Duration::from_secs(5))? {
                on_notice(n);
            }
        }
        Ok(())
    }

    /// Undo a batch. The files that come back are not sorted again until they change.
    pub fn undo_batch(&mut self, batch: u64) -> Result<Vec<Entry>, UndoError> {
        self.shared.undo_batch(batch)
    }
}

fn recover_fetch_temp(root: &Path) -> io::Result<()> {
    let sorter_dir = root.join(".sorter");
    if !is_real_directory(&sorter_dir)? {
        return Ok(());
    }
    let temp_dir = sorter_dir.join("tmp");
    if !is_real_directory(&temp_dir)? {
        return Ok(());
    }
    let entries = fs::read_dir(&temp_dir)?;

    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.ends_with(".part") {
            fs::remove_file(entry.path())?;
            continue;
        }

        let base = root.join(name.as_ref());
        let mut suffix = 1u64;
        loop {
            let target = if suffix == 1 {
                base.clone()
            } else {
                let stem = base.file_stem().unwrap_or_default().to_string_lossy();
                let extension = base
                    .extension()
                    .map(|value| format!(".{}", value.to_string_lossy()))
                    .unwrap_or_default();
                base.with_file_name(format!("{stem} ({suffix}){extension}"))
            };
            match move_no_replace(&entry.path(), &target) {
                Ok(()) => break,
                Err(ExecError::TargetExists(_)) => suffix += 1,
                Err(error) => return Err(io::Error::new(io::ErrorKind::Other, error.to_string())),
            }
        }
    }
    Ok(())
}

fn is_real_directory(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(true),
        Ok(_) => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "fetch staging path must be a real directory",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn collect_files(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(kind) = e.file_type() else { continue };
        if kind.is_dir() && recursive {
            collect_files(&e.path(), true, out);
        } else if kind.is_file() {
            out.push(e.path());
        }
    }
}

/// Removes empty subfolders that have been untouched for `min_age` (never `dir` itself). The age check
/// keeps us from removing a folder that a download is about to write into.
fn remove_empty_dirs(dir: &Path, min_age: Duration, is_root: bool) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name();
        let hidden = name.to_string_lossy().starts_with('.');
        if !hidden && e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            remove_empty_dirs(&e.path(), min_age, false);
        }
    }
    if is_root {
        return;
    }
    let empty = fs::read_dir(dir)
        .map(|mut r| r.next().is_none())
        .unwrap_or(false);
    let old_enough = fs::metadata(dir)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .map_or(false, |age| age >= min_age);
    if empty && old_enough {
        let _ = fs::remove_dir(dir);
    }
}

/// One line per thing that happened, for the log.
pub fn describe(outcome: &Outcome, verbose: bool) -> Vec<String> {
    use sorter_core::Action;
    let mut lines = Vec::new();
    let mut left = 0;
    for a in &outcome.plan.actions {
        match a {
            Action::Leave { .. } => {
                left += 1;
                if verbose {
                    lines.push(a.to_string());
                }
            }
            Action::Ignore { .. } => {}
            _ => lines.push(a.to_string()),
        }
    }
    if left > 0 && !verbose {
        lines.push(format!(
            "left {left} file(s) in place (no match or a conflict)"
        ));
    }
    for s in &outcome.report.skipped {
        lines.push(format!("skipped (file is gone): {s}"));
    }
    if let Some(e) = &outcome.report.error {
        lines.push(format!("error: {e}"));
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::recover_fetch_temp;
    use std::fs;
    use std::io;
    use std::os::unix::fs::symlink;

    #[test]
    fn recovers_completed_fetches_without_overwriting_and_removes_partials() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "sorter-fetch-recovery-{}-{nonce}",
            std::process::id()
        ));
        let temp = root.join(".sorter/tmp");
        fs::create_dir_all(&temp).unwrap();
        fs::write(root.join("wallhaven-abc123.png"), "original").unwrap();
        fs::write(temp.join("wallhaven-abc123.png"), "recovered").unwrap();
        fs::write(temp.join("wallhaven-zzz999.png.part"), "partial").unwrap();

        recover_fetch_temp(&root).unwrap();

        assert_eq!(
            fs::read_to_string(root.join("wallhaven-abc123.png")).unwrap(),
            "original"
        );
        assert_eq!(
            fs::read_to_string(root.join("wallhaven-abc123 (2).png")).unwrap(),
            "recovered"
        );
        assert!(!temp.join("wallhaven-abc123.png").exists());
        assert!(!temp.join("wallhaven-zzz999.png.part").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_symlinked_fetch_temp_directory() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "sorter-fetch-recovery-symlink-{}-{nonce}",
            std::process::id()
        ));
        let outside = root.with_extension("outside");
        fs::create_dir_all(root.join(".sorter")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("sentinel.part"), "untouched").unwrap();
        symlink(&outside, root.join(".sorter/tmp")).unwrap();

        assert_eq!(
            recover_fetch_temp(&root).unwrap_err().kind(),
            io::ErrorKind::InvalidInput
        );
        assert_eq!(
            fs::read_to_string(outside.join("sentinel.part")).unwrap(),
            "untouched"
        );

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
