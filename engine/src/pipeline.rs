//! Everything the daemon does with a batch of arriving files: hash, plan, apply, and keep the hash index
//! and the origin records up to date. The folder watcher will call `process`.

use crate::exec::{apply, Report};
use crate::index::{file_stat, hash_file, rel_inside, Index, IndexEntry, RefreshStats};
use crate::log::{Entry, Kind, Log};
use crate::origins::{Origin, OriginStore};
use crate::scan::library_snapshot;
use crate::undo::{undo_batch, undo_entry, UndoError};
use crate::util::unix_now;
use sorter_core::{build_plan_with, classify, parse_source, Config, Dest, Incoming, Plan, PlanOptions};
use std::collections::{BTreeSet, HashMap};
use std::io;
use std::path::{Path, PathBuf};

pub struct Pipeline {
    pub root: PathBuf,
    pub cfg: Config,
    pub index: Index,
    pub origins: OriginStore,
    pub log: Log,
    /// What the last refresh of the hash cache did (opening and undo both refresh).
    pub last_refresh: RefreshStats,
}

pub struct Outcome {
    pub plan: Plan,
    pub report: Report,
}

pub(crate) struct FileMeta {
    pub(crate) hash: String,
    pub(crate) name: String,
    pub(crate) parent: String,
    pub(crate) dims: (u32, u32),
}

pub(crate) fn name_of(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

pub(crate) fn dims_of(p: &Path) -> (u32, u32) {
    imagesize::size(p).map(|s| (s.width as u32, s.height as u32)).unwrap_or((0, 0))
}

impl Pipeline {
    /// Opens (or starts) the stores under `<root>/.sorter`, refreshes the hash cache, and gives every
    /// existing file that has no origin record one built from its current name.
    pub fn open(root: impl Into<PathBuf>, cfg: Config) -> io::Result<Pipeline> {
        let root = root.into();
        let dir = root.join(".sorter");
        let mut p = Pipeline {
            index: Index::open(dir.join("index.jsonl"))?,
            origins: OriginStore::open(dir.join("origins.jsonl"))?,
            log: Log::open(dir.join("log.jsonl"))?,
            last_refresh: RefreshStats::default(),
            root,
            cfg,
        };
        p.reconcile()?;
        Ok(p)
    }

    /// Brings the hash cache and the origin records in line with what is on disk now: new files are hashed,
    /// vanished ones forgotten, files without a record get one, and a record whose file moved (for example
    /// by hand in the file manager) follows it, because the content hash is the identity.
    pub fn reconcile(&mut self) -> io::Result<RefreshStats> {
        let stats = self.index.refresh(&self.root, &self.cfg.settings.image_extensions)?;
        self.last_refresh = stats;
        let dup_prefix = format!("{}/", self.cfg.settings.duplicates_folder);
        let now = unix_now();

        let entries: Vec<IndexEntry> = self.index.entries().cloned().collect();
        for e in &entries {
            if self.origins.get(&e.hash).is_some() {
                continue;
            }
            let abs = self.root.join(&e.path);
            let parent = abs.parent().map(name_of).unwrap_or_default();
            let name = name_of(&abs);
            let (w, h) = dims_of(&abs);
            self.origins.upsert(Origin {
                hash: e.hash.clone(),
                path: e.path.clone(),
                sources: vec![parse_source(&name, &parent)],
                original_name: name,
                added: now,
                note: "existing file".to_string(),
                width: w,
                height: h,
            });
        }

        let records: Vec<Origin> = self.origins.all().cloned().collect();
        for o in records {
            let paths = self.index.paths_for_hash(&o.hash);
            if paths.is_empty() || paths.iter().any(|p| *p == o.path) {
                continue;
            }
            let best = paths.iter().find(|p| !p.starts_with(&dup_prefix)).or(paths.first()).map(|p| p.to_string());
            if let Some(best) = best {
                self.origins.set_path_for_hash(&o.hash, &best);
            }
        }
        self.index.save()?;
        self.origins.save()?;
        Ok(stats)
    }

    /// Hash (reusing the cache for files already in the library) and describe each file.
    pub(crate) fn meta_for(&self, files: &[PathBuf]) -> (HashMap<String, FileMeta>, Vec<Incoming>) {
        let mut meta = HashMap::new();
        let mut incoming = Vec::new();
        for f in files {
            let path = f.to_string_lossy().to_string();
            let name = name_of(f);
            let parent = f.parent().map(name_of).unwrap_or_default();
            let mut hash = None;
            if classify(&name, &self.cfg).dest != Dest::Ignore {
                if let Some(h) = self.hash_of(f) {
                    meta.insert(path.clone(), FileMeta { hash: h.clone(), name, parent, dims: dims_of(f) });
                    hash = Some(h);
                }
            }
            incoming.push(Incoming { path, hash });
        }
        (meta, incoming)
    }

    fn hash_of(&self, f: &Path) -> Option<String> {
        if let (Some(rel), Ok((size, mtime_ns))) = (rel_inside(&self.root, f), file_stat(f)) {
            if let Some(e) = self.index.get(&rel) {
                if e.size == size && e.mtime_ns == mtime_ns {
                    return Some(e.hash.clone());
                }
            }
        }
        hash_file(f).ok()
    }

    pub(crate) fn prepare_with(&self, files: &[PathBuf], opts: &PlanOptions) -> io::Result<(HashMap<String, FileMeta>, Plan)> {
        let (meta, incoming) = self.meta_for(files);
        let mut library = library_snapshot(&self.root)?;
        // Files that are already inside the library (loose ones in the root, or ones being moved) are being looked
        // at again: they must not count as the original of themselves.
        let own: BTreeSet<String> = files.iter().filter_map(|f| rel_inside(&self.root, f)).collect();
        library.hashes = self.index.library_hashes_except(&self.cfg.settings.duplicates_folder, &own);
        Ok((meta, build_plan_with(&self.cfg, &library, &incoming, opts)))
    }

    /// What `process` would do with these files, without doing it.
    pub fn dry_run(&self, files: &[PathBuf]) -> io::Result<Plan> {
        Ok(self.prepare_with(files, &PlanOptions::default())?.1)
    }

    /// Sort a batch of files that just arrived (from the library root or from an intake folder).
    pub fn process(&mut self, files: &[PathBuf]) -> io::Result<Outcome> {
        self.process_with(files, &PlanOptions::default())
    }

    pub(crate) fn process_with(&mut self, files: &[PathBuf], opts: &PlanOptions) -> io::Result<Outcome> {
        let (meta, plan) = self.prepare_with(files, opts)?;
        self.run_plan(plan, meta)
    }

    /// Applies a plan and brings the index and the records up to date.
    pub(crate) fn run_plan(&mut self, plan: Plan, meta: HashMap<String, FileMeta>) -> io::Result<Outcome> {
        let report = apply(&plan, &self.root, &mut self.log);
        self.record(&report, &meta)?;
        Ok(Outcome { plan, report })
    }

    fn index_file(&mut self, rel: &str, abs: &Path, hash: &str) {
        if let Ok((size, mtime_ns)) = file_stat(abs) {
            self.index.insert(IndexEntry { path: rel.to_string(), size, mtime_ns, hash: hash.to_string() });
        }
    }

    pub(crate) fn record(&mut self, report: &Report, meta: &HashMap<String, FileMeta>) -> io::Result<()> {
        let now = unix_now();

        // Files that were left where they are still get a record (and an index entry if they are in the library).
        for (path, reason) in &report.left {
            let Some(m) = meta.get(path) else { continue };
            let abs = PathBuf::from(path);
            let inside = rel_inside(&self.root, &abs);
            if let Some(rel) = &inside {
                self.index_file(rel, &abs, &m.hash);
            }
            if self.origins.get(&m.hash).is_none() {
                self.origins.upsert(Origin {
                    hash: m.hash.clone(),
                    path: inside.unwrap_or_else(|| path.clone()),
                    original_name: m.name.clone(),
                    sources: vec![parse_source(&m.name, &m.parent)],
                    added: now,
                    note: format!("waiting in the Inbox ({})", leave_note(reason)),
                    width: m.dims.0,
                    height: m.dims.1,
                });
            }
        }

        for e in &report.done {
            match e.kind {
                Kind::Move => {
                    let Some(m) = meta.get(&e.from) else { continue };
                    let to_abs = PathBuf::from(&e.to);
                    let to_rel = rel_inside(&self.root, &to_abs).unwrap_or_else(|| e.to.clone());
                    if let Some(from_rel) = rel_inside(&self.root, Path::new(&e.from)) {
                        self.index.remove(&from_rel);
                    }
                    if to_rel.starts_with(".sorter/") {
                        // Deleted: the file sits in the trash folder, which is not part of the library.
                        if let Some(mut o) = self.origins.get(&m.hash).cloned() {
                            o.path = to_rel;
                            o.note = e.note.clone();
                            self.origins.upsert(o);
                        }
                        continue;
                    }
                    self.index_file(&to_rel, &to_abs, &m.hash);
                    let src = parse_source(&m.name, &m.parent);
                    match self.origins.get(&m.hash).cloned() {
                        Some(mut o) => {
                            o.path = to_rel;
                            o.note = e.note.clone();
                            self.origins.upsert(o);
                            self.origins.add_source(&m.hash, src);
                        }
                        None => self.origins.upsert(Origin {
                            hash: m.hash.clone(),
                            path: to_rel,
                            original_name: m.name.clone(),
                            sources: vec![src],
                            added: now,
                            note: e.note.clone(),
                            width: m.dims.0,
                            height: m.dims.1,
                        }),
                    }
                }
                Kind::Rename => {
                    let (Some(a), Some(b)) = (
                        rel_inside(&self.root, Path::new(&e.from)),
                        rel_inside(&self.root, Path::new(&e.to)),
                    ) else {
                        continue;
                    };
                    self.index.rename(&a, &b);
                    self.origins.set_path(&a, &b);
                }
                Kind::Duplicate => {
                    let Some(m) = meta.get(&e.from) else { continue };
                    let to_abs = PathBuf::from(&e.to);
                    if let Some(from_rel) = rel_inside(&self.root, Path::new(&e.from)) {
                        self.index.remove(&from_rel);
                    }
                    if let Some(to_rel) = rel_inside(&self.root, &to_abs) {
                        self.index_file(&to_rel, &to_abs, &m.hash);
                    }
                    self.origins.add_source(&m.hash, parse_source(&m.name, &m.parent));
                }
                Kind::Undo => {}
            }
        }
        self.index.save()?;
        self.origins.save()
    }

    /// Undo one logged action, then bring the records back in line with the disk.
    pub fn undo_entry(&mut self, id: u64) -> Result<Entry, UndoError> {
        let u = undo_entry(&mut self.log, id)?;
        if let Some(old) = rel_inside(&self.root, Path::new(&u.from)) {
            let new = rel_inside(&self.root, Path::new(&u.to)).unwrap_or_else(|| u.to.clone());
            self.origins.set_path(&old, &new);
        }
        self.reconcile().map_err(UndoError::Log)?;
        Ok(u)
    }

    /// Undo a whole batch, then bring the records back in line with the disk.
    pub fn undo_batch(&mut self, batch: u64) -> Result<Vec<Entry>, UndoError> {
        let undone = undo_batch(&mut self.log, batch)?;
        for u in &undone {
            if let Some(old) = rel_inside(&self.root, Path::new(&u.from)) {
                let new = rel_inside(&self.root, Path::new(&u.to)).unwrap_or_else(|| u.to.clone());
                self.origins.set_path(&old, &new);
            }
        }
        self.reconcile().map_err(UndoError::Log)?;
        Ok(undone)
    }
}

fn leave_note(reason: &sorter_core::LeaveReason) -> String {
    match reason {
        sorter_core::LeaveReason::NoMatch => "no match".to_string(),
        sorter_core::LeaveReason::Conflict(t) => format!("conflict: {}", t.join(";")),
        sorter_core::LeaveReason::Problem(p) => format!("problem: {p}"),
    }
}
