//! The run loop: watch the folders, wait for files to be finished, hand them to the pipeline.

use crate::debounce::Debouncer;
use crate::watcher::{wait_readable, DirWatcher, Event};
use serde::{Deserialize, Serialize};
use sorter_core::{expand_home, Config};
use sorter_engine::{file_stat, write_atomic, Entry, Outcome, Pipeline, UndoError};
use std::collections::HashMap;
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConfigUndo {
    before: String,
    after: String,
}

impl Shared {
    pub fn lock(&self) -> MutexGuard<'_, Pipeline> {
        self.pipeline.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Wakes the watcher loop so it looks at what changed.
    pub fn wake(&self) {
        let _ = (&self.wake).write(&[1]);
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

    pub fn record_config_undo(&self, batch: u64, before: String) -> Result<(), String> {
        let after = self.config_text()?;
        let mut undo = self.config_undo.lock().unwrap_or_else(|e| e.into_inner());
        undo.insert(batch, ConfigUndo { before, after });
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
        let path = self
            .config_path
            .as_ref()
            .ok_or(UndoError::NotUndoable(batch))?;
        let _guard = self.config_edit.lock().unwrap_or_else(|e| e.into_inner());
        let current = fs::read_to_string(path).map_err(UndoError::Log)?;
        if current != saved.after {
            return Err(UndoError::NotUndoable(batch));
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
        let cfg = Config::from_toml(&saved.before)
            .map_err(|e| UndoError::Log(io::Error::new(io::ErrorKind::InvalidData, e)))?;
        write_atomic(path, &saved.before).map_err(UndoError::Log)?;
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
        let intake: Vec<IntakeDir> = cfg
            .intake
            .iter()
            .map(|i| IntakeDir {
                path: expand_home(&i.path),
                recursive: i.recursive,
                remove_empty: i.remove_empty_folders,
                active: false,
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
            config_path,
            config_edit: Mutex::new(()),
            config_undo: Mutex::new(config_undo),
            config_undo_path,
        });
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
                    if let Ok(found) = self.watcher.add(&path, recursive) {
                        self.intake[i].active = true;
                        self.queue_found(found);
                    }
                }
            } else {
                self.intake[i].active = false;
            }
        }
    }

    /// Looks at everything again (after the kernel dropped events, or on request).
    pub fn rescan(&mut self) {
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
        for ev in self.watcher.read()? {
            match ev {
                Event::File(p) => self.on_file(p),
                Event::Overflow => self.rescan(),
            }
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
    pub fn run(&mut self, stop: &AtomicBool, on_notice: &mut dyn FnMut(Notice)) -> io::Result<()> {
        while !stop.load(Ordering::SeqCst) {
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
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
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
