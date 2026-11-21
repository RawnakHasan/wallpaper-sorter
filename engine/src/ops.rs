//! What the web UI asks of the library: lists (inbox, folders, images, duplicates) and actions
//! (assign to a folder, delete, close gaps, edit a record). Every action goes through a plan and the log,
//! so it can be undone.

use crate::exec::Report;
use crate::index::rel_inside;
use crate::origins::Origin;
use crate::pipeline::{name_of, Outcome, Pipeline};
use crate::scan::library_snapshot;
use crate::util::unix_now;
use serde::Serialize;
use sorter_core::numbering::{gaps, next_number, parse_numbered};
use sorter_core::{
    classify, classify_with_hints, expand_home, plan_gap_fill, plan_new_file, Action, Config, Dest,
    GapMode, MatchCandidate, Plan, PlanOptions, Rename, Rule, Site, Source,
};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

fn renamed_folder_path(path: &str, from: &str, to: &str) -> Option<String> {
    if path == from {
        Some(to.to_string())
    } else {
        path.strip_prefix(&(from.to_string() + "/"))
            .map(|rest| format!("{to}/{rest}"))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InboxItem {
    /// Absolute path.
    pub path: String,
    pub name: String,
    /// "no_match", "conflict", or "ready" (a tag now matches; the next scan will sort it).
    pub reason: String,
    pub matched: Vec<String>,
    pub candidates: Vec<MatchCandidate>,
    /// "library" for a loose file in the library folder, else the intake folder it is in.
    pub intake: String,
    pub size: u64,
    pub modified: u64,
    pub origin: Option<Origin>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FolderInfo {
    pub path: String,
    pub name: String,
    pub prefix: String,
    pub count: usize,
    pub next_number: u64,
    pub gaps: Vec<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageInfo {
    pub name: String,
    pub path: String,
    pub number: Option<u64>,
    pub size: u64,
    pub hash: Option<String>,
    pub origin: Option<Origin>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DuplicateItem {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub hash: Option<String>,
    pub duplicate_of: Option<String>,
}

fn invalid(msg: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg.into())
}

/// A folder inside the library: relative, no "..", nothing hidden.
pub fn check_folder(folder: &str) -> io::Result<()> {
    let p = Path::new(folder);
    if folder.is_empty() || p.is_absolute() {
        return Err(invalid("folder must be a path inside the library"));
    }
    for c in p.components() {
        match c {
            Component::Normal(n) if !n.to_string_lossy().starts_with('.') => {}
            _ => return Err(invalid("folder must be a plain path inside the library")),
        }
    }
    Ok(())
}

fn mtime_secs(m: &fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl Pipeline {
    pub fn set_config(&mut self, cfg: Config) {
        self.cfg = cfg;
    }

    pub fn intake_dirs(&self) -> Vec<PathBuf> {
        self.cfg
            .intake
            .iter()
            .map(|i| expand_home(&i.path))
            .collect()
    }

    /// Absolute path for a path the UI sent: relative paths are inside the library. It must lie inside the
    /// library or an intake folder, and contain no "..".
    pub fn resolve(&self, p: &str) -> io::Result<PathBuf> {
        let path = if Path::new(p).is_absolute() {
            PathBuf::from(p)
        } else {
            self.root.join(p)
        };
        if path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(invalid("path must not contain .."));
        }
        let inside =
            path.starts_with(&self.root) || self.intake_dirs().iter().any(|d| path.starts_with(d));
        if !inside {
            return Err(invalid(
                "path is outside the library and the intake folders",
            ));
        }
        Ok(path)
    }

    fn is_image(&self, name: &str) -> bool {
        classify(name, &self.cfg).dest != Dest::Ignore
    }

    /// Images waiting to be sorted: loose in the library folder, or in an intake folder.
    pub fn inbox(&self) -> io::Result<Vec<InboxItem>> {
        let mut found: Vec<(PathBuf, String)> = Vec::new();
        for e in fs::read_dir(&self.root)?.flatten() {
            if e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                found.push((e.path(), "library".to_string()));
            }
        }
        for dir in self.intake_dirs() {
            let mut stack = vec![dir.clone()];
            while let Some(d) = stack.pop() {
                let Ok(rd) = fs::read_dir(&d) else { continue };
                for e in rd.flatten() {
                    match e.file_type() {
                        Ok(t) if t.is_dir() => stack.push(e.path()),
                        Ok(t) if t.is_file() => {
                            found.push((e.path(), dir.to_string_lossy().to_string()))
                        }
                        _ => {}
                    }
                }
            }
        }
        let mut items = Vec::new();
        for (path, intake) in found {
            let name = name_of(&path);
            if name.starts_with('.') || !self.is_image(&name) {
                continue;
            }
            let origin = match rel_inside(&self.root, &path) {
                Some(rel) => self
                    .index
                    .get(&rel)
                    .and_then(|e| self.origins.get(&e.hash))
                    .cloned(),
                None => self.origins.get_by_path(&path.to_string_lossy()).cloned(),
            };
            let hints = origin
                .as_ref()
                .map(|record| record.tags.as_slice())
                .unwrap_or_default();
            let d = classify_with_hints(&name, &self.cfg, hints);
            let reason = match (&d.dest, d.rule) {
                (Dest::Folder(_), _) => "ready",
                (_, Rule::Conflict) => "conflict",
                _ => "no_match",
            };
            let meta = fs::metadata(&path).ok();
            items.push(InboxItem {
                path: path.to_string_lossy().to_string(),
                name,
                reason: reason.to_string(),
                matched: d.matched,
                candidates: d.candidates,
                intake,
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                modified: meta.as_ref().map(mtime_secs).unwrap_or(0),
                origin,
            });
        }
        items.sort_by(|a, b| (a.modified, &a.name).cmp(&(b.modified, &b.name)));
        Ok(items)
    }

    pub fn folders(&self) -> io::Result<Vec<FolderInfo>> {
        let snap = library_snapshot(&self.root)?;
        let exts = &self.cfg.settings.image_extensions;
        Ok(snap
            .folders
            .iter()
            .map(|(path, files)| {
                let prefix = self.cfg.prefix_for(path);
                FolderInfo {
                    path: path.clone(),
                    name: path.rsplit('/').next().unwrap_or(path).to_string(),
                    count: files.len(),
                    next_number: next_number(files, &prefix, exts),
                    gaps: gaps(files, &prefix, exts),
                    prefix,
                }
            })
            .collect())
    }

    pub fn images(&self, folder: &str) -> io::Result<Vec<ImageInfo>> {
        check_folder(folder)?;
        let dir = self.root.join(folder);
        let prefix = self.cfg.prefix_for(folder);
        let exts = &self.cfg.settings.image_extensions;
        let mut out = Vec::new();
        for e in fs::read_dir(&dir)?.flatten() {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let name = name_of(&e.path());
            if name.starts_with('.') || !self.is_image(&name) {
                continue;
            }
            let rel = format!("{folder}/{name}");
            let hash = self.index.get(&rel).map(|i| i.hash.clone());
            out.push(ImageInfo {
                number: parse_numbered(&name, &prefix, exts).map(|(n, _)| n),
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                origin: hash.as_ref().and_then(|h| self.origins.get(h)).cloned(),
                hash,
                path: rel,
                name,
            });
        }
        out.sort_by(|a, b| {
            (a.number.is_none(), a.number, &a.name).cmp(&(b.number.is_none(), b.number, &b.name))
        });
        Ok(out)
    }

    pub fn duplicates(&self) -> io::Result<Vec<DuplicateItem>> {
        let folder = self.cfg.settings.duplicates_folder.clone();
        let dir = self.root.join(&folder);
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for e in fs::read_dir(&dir)?.flatten() {
            if !e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let name = name_of(&e.path());
            let rel = format!("{folder}/{name}");
            let abs = self.root.join(&rel).to_string_lossy().to_string();
            let duplicate_of = self
                .log
                .entries()
                .iter()
                .rev()
                .find(|l| l.to == abs && l.note.starts_with("duplicate of "))
                .map(|l| l.note.trim_start_matches("duplicate of ").to_string());
            out.push(DuplicateItem {
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                hash: self.index.get(&rel).map(|i| i.hash.clone()),
                path: rel,
                name,
                duplicate_of,
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// The name a new file with extension `ext` would get in `folder` right now.
    pub fn preview_name(&self, folder: &str, ext: &str) -> io::Result<String> {
        check_folder(folder)?;
        let snap = library_snapshot(&self.root)?;
        let files = snap.folders.get(folder).cloned().unwrap_or_default();
        let prefix = self.cfg.prefix_for(folder);
        plan_new_file(
            &files,
            &prefix,
            ext,
            self.cfg.settings.gap_mode,
            &self.cfg.settings.image_extensions,
        )
        .map(|p| p.name)
        .map_err(|e| invalid(e.to_string()))
    }

    /// Put these files in `folder` (created if needed), numbered like any other arrival. Copies of files we
    /// already hold still go to Duplicates.
    pub fn assign(&mut self, files: &[PathBuf], folder: &str) -> io::Result<Outcome> {
        check_folder(folder)?;
        if folder.split('/').next() == Some(self.cfg.settings.duplicates_folder.as_str()) {
            return Err(invalid("the Duplicates folder is not a place to sort into"));
        }
        self.process_with(
            files,
            &PlanOptions {
                forced_dest: Some(folder.to_string()),
                skip_duplicate_check: false,
            },
        )
    }

    /// Creates an empty destination folder. There is no image action to undo here; folder rename,
    /// merge and prefix changes below are all logged as file batches.
    pub fn create_folder(&self, folder: &str) -> io::Result<()> {
        check_folder(folder)?;
        if folder == self.cfg.settings.duplicates_folder
            || folder.starts_with(&(self.cfg.settings.duplicates_folder.clone() + "/"))
        {
            return Err(invalid("the Duplicates folder is managed by the sorter"));
        }
        let dir = self.root.join(folder);
        if dir.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("{folder} already exists"),
            ));
        }
        fs::create_dir_all(dir)
    }

    /// Preview a directory rename. The directory tree is preserved; every file move is recorded so
    /// the entire rename can be undone. Existing destination files are reported and left alone.
    pub fn rename_folder_preview(&self, from: &str, to: &str) -> io::Result<Plan> {
        self.check_folder_change(from, to)?;
        if self.root.join(to).exists() {
            return Ok(Plan {
                actions: vec![Action::Leave {
                    path: from.to_string(),
                    reason: sorter_core::LeaveReason::Problem(format!("{to} already exists")),
                }],
            });
        }
        Ok(Plan {
            actions: vec![Action::Rename {
                from: from.to_string(),
                to: to.to_string(),
            }],
        })
    }

    pub fn rename_folder(&mut self, from: &str, to: &str) -> io::Result<Outcome> {
        let plan = self.rename_folder_preview(from, to)?;
        self.run_plan(plan, HashMap::new())
    }

    /// Prefix entries to add when `from` becomes `to`.  The old configuration is the source of
    /// truth: after the paths are rewritten, pin a prefix only where deriving it from the new
    /// path would change the number scheme of a folder that contains images.
    pub fn rename_folder_prefix_pins(
        &self,
        from: &str,
        to: &str,
    ) -> io::Result<Vec<(String, String)>> {
        self.check_folder_change(from, to)?;
        let mut renamed = self.cfg.clone();
        for tag in &mut renamed.tags {
            if let Some(path) = renamed_folder_path(&tag.dest, from, to) {
                tag.dest = path;
            }
        }
        for folder in &mut renamed.folders {
            if let Some(path) = renamed_folder_path(&folder.path, from, to) {
                folder.path = path;
            }
        }

        let mut paths = BTreeSet::new();
        paths.insert(from.to_string());
        for file in self.folder_files(from)? {
            let rel = rel_inside(&self.root, &file).expect("folder file is inside the library");
            if let Some(parent) = Path::new(&rel).parent() {
                paths.insert(parent.to_string_lossy().to_string());
            }
        }
        Ok(paths
            .into_iter()
            .filter_map(|old_path| {
                let new_path = renamed_folder_path(&old_path, from, to)?;
                let old_prefix = self.cfg.prefix_for(&old_path);
                (old_prefix != renamed.prefix_for(&new_path)).then_some((new_path, old_prefix))
            })
            .collect())
    }

    /// Preview merging a source folder (and its children) into a destination folder. The normal
    /// planner allocates destination numbers and recognises exact copies, so collisions never
    /// overwrite and duplicate content goes to Duplicates.
    pub fn merge_folder_preview(&self, from: &str, to: &str) -> io::Result<Plan> {
        self.check_folder_change(from, to)?;
        let files = self.folder_files(from)?;
        Ok(self
            .prepare_with(
                &files,
                &PlanOptions {
                    forced_dest: Some(to.to_string()),
                    skip_duplicate_check: false,
                },
            )?
            .1)
    }

    pub fn merge_folder(&mut self, from: &str, to: &str) -> io::Result<Outcome> {
        let files = self.folder_files(from)?;
        let out = self.process_with(
            &files,
            &PlanOptions {
                forced_dest: Some(to.to_string()),
                skip_duplicate_check: false,
            },
        )?;
        self.remove_empty_folders(from)?;
        Ok(out)
    }

    fn remove_empty_folders(&self, folder: &str) -> io::Result<()> {
        fn prune(dir: &Path) -> io::Result<()> {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || !entry.file_type()?.is_dir() {
                    continue;
                }
                prune(&entry.path())?;
                match fs::remove_dir(entry.path()) {
                    Ok(()) => {}
                    Err(e)
                        if e.raw_os_error() == Some(39) || e.kind() == io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e),
                }
            }
            Ok(())
        }
        let root = self.root.join(folder);
        prune(&root)?;
        match fs::remove_dir(root) {
            Ok(()) => Ok(()),
            Err(e) if e.raw_os_error() == Some(39) || e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Preview changing a folder's numbering prefix. Only files which already follow the folder's
    /// numbered scheme are renamed; other files remain untouched for the user to review or re-sort.
    pub fn prefix_change_preview(&self, folder: &str, prefix: &str) -> io::Result<Plan> {
        check_folder(folder)?;
        let prefix = self.valid_prefix(prefix)?;
        let dir = self.root.join(folder);
        if !dir.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{folder} is not a folder"),
            ));
        }
        let old_prefix = self.cfg.prefix_for(folder);
        let mut existing = BTreeSet::new();
        let mut numbered = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = name_of(&entry.path());
            existing.insert(name.clone());
            if let Some((number, ext)) =
                parse_numbered(&name, &old_prefix, &self.cfg.settings.image_extensions)
            {
                numbered.push((name, format!("{prefix} {number}.{ext}")));
            }
        }
        let moving: BTreeSet<String> = numbered.iter().map(|(from, _)| from.clone()).collect();
        let mut targets = BTreeSet::new();
        let actions = numbered
            .into_iter()
            .filter(|(from, to)| from != to)
            .map(|(from, to)| {
                if !targets.insert(to.clone()) || (existing.contains(&to) && !moving.contains(&to))
                {
                    Action::Leave {
                        path: format!("{folder}/{from}"),
                        reason: sorter_core::LeaveReason::Problem(format!(
                            "{folder}/{to} already exists"
                        )),
                    }
                } else {
                    Action::Rename {
                        from: format!("{folder}/{from}"),
                        to: format!("{folder}/{to}"),
                    }
                }
            })
            .collect();
        Ok(Plan { actions })
    }

    pub fn change_prefix(&mut self, folder: &str, prefix: &str) -> io::Result<Outcome> {
        let plan = self.prefix_change_preview(folder, prefix)?;
        self.run_plan(plan, HashMap::new())
    }

    fn valid_prefix(&self, prefix: &str) -> io::Result<String> {
        let prefix = prefix.trim();
        if prefix.is_empty() || prefix.contains('/') || prefix.contains('\\') {
            return Err(invalid("prefix must be non-empty and contain no slash"));
        }
        Ok(prefix.to_string())
    }

    fn check_folder_change(&self, from: &str, to: &str) -> io::Result<()> {
        check_folder(from)?;
        check_folder(to)?;
        if from == to {
            return Err(invalid("source and destination folders are the same"));
        }
        if from == self.cfg.settings.duplicates_folder
            || from.starts_with(&(self.cfg.settings.duplicates_folder.clone() + "/"))
            || to == self.cfg.settings.duplicates_folder
            || to.starts_with(&(self.cfg.settings.duplicates_folder.clone() + "/"))
        {
            return Err(invalid("the Duplicates folder is managed by the sorter"));
        }
        if to.starts_with(&(from.to_string() + "/")) {
            return Err(invalid("a folder cannot be moved into itself"));
        }
        if !self.root.join(from).is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{from} is not a folder"),
            ));
        }
        Ok(())
    }

    fn folder_files(&self, folder: &str) -> io::Result<Vec<PathBuf>> {
        let mut files = Vec::new();
        let mut stack = vec![self.root.join(folder)];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let kind = entry.file_type()?;
                if kind.is_dir() {
                    stack.push(entry.path());
                } else if kind.is_file() && self.is_image(&name) {
                    files.push(entry.path());
                }
            }
        }
        files.sort();
        Ok(files)
    }

    /// The plan for applying the current tags to images that are already in the library. `scope` is
    /// either the whole library or one folder and all of its children. This only reads the files;
    /// use [`Pipeline::resort`] to apply a freshly computed plan.
    pub fn resort_preview(&mut self, scope: Option<&str>) -> io::Result<Plan> {
        let files = self.resort_files(scope)?;
        // Hash and record every source before planning it. In particular, this makes a file that is
        // moved between folders keep its origin record rather than acquiring a new one from its
        // numbered destination name.
        self.reconcile()?;
        Ok(self.prepare_with(&files, &PlanOptions::default())?.1)
    }

    /// Re-apply the current tags to existing images. The plan is deliberately built again instead
    /// of accepting a plan from the caller: a preview can become stale while the watcher is working.
    /// All resulting moves and renames share one log batch and can therefore be undone together.
    pub fn resort(&mut self, scope: Option<&str>) -> io::Result<Outcome> {
        let files = self.resort_files(scope)?;
        self.reconcile()?;
        let (meta, plan) = self.prepare_with(&files, &PlanOptions::default())?;
        self.run_plan(plan, meta)
    }

    fn resort_files(&self, scope: Option<&str>) -> io::Result<Vec<PathBuf>> {
        let dir = match scope {
            Some(folder) => {
                check_folder(folder)?;
                if folder == self.cfg.settings.duplicates_folder
                    || folder.starts_with(&(self.cfg.settings.duplicates_folder.clone() + "/"))
                {
                    return Err(invalid("the Duplicates folder cannot be re-sorted"));
                }
                self.root.join(folder)
            }
            None => self.root.clone(),
        };
        if !dir.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{} is not a folder", dir.display()),
            ));
        }

        let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
        let mut stack = vec![dir];
        while let Some(current) = stack.pop() {
            for entry in fs::read_dir(&current)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let kind = entry.file_type()?;
                if kind.is_dir() {
                    // The duplicate copies are retained as evidence and are never candidates for
                    // re-sorting, including when the whole library is selected.
                    if current == self.root && name == self.cfg.settings.duplicates_folder {
                        continue;
                    }
                    stack.push(entry.path());
                } else if kind.is_file() && self.is_image(&name) {
                    let modified = entry
                        .metadata()
                        .and_then(|m| m.modified())
                        .unwrap_or(SystemTime::UNIX_EPOCH);
                    found.push((modified, entry.path()));
                }
            }
        }
        // Number allocation follows the oldest images first. A path tie-break keeps the preview
        // deterministic on file systems whose timestamps have coarse resolution.
        found.sort_by(|(a_time, a_path), (b_time, b_path)| {
            a_time.cmp(b_time).then_with(|| a_path.cmp(b_path))
        });
        Ok(found.into_iter().map(|(_, path)| path).collect())
    }

    /// "Delete" moves files to `.sorter/trash` (inside the library, hidden), so it can be undone.
    pub fn delete(&mut self, files: &[PathBuf]) -> io::Result<Outcome> {
        let (meta, _) = self.meta_for(files);
        let stamp = unix_now();
        let actions = files
            .iter()
            .enumerate()
            .filter(|(_, f)| {
                fs::symlink_metadata(f)
                    .map(|m| m.is_file())
                    .unwrap_or(false)
            })
            .map(|(i, f)| Action::Move {
                from: f.to_string_lossy().to_string(),
                to: format!(".sorter/trash/{stamp}-{i}/{}", name_of(f)),
                rule: Rule::Deleted,
                matched: vec![],
            })
            .collect();
        self.run_plan(Plan { actions }, meta)
    }

    /// Permanently removes what is in the trash. Returns how many files went.
    pub fn empty_trash(&mut self) -> io::Result<usize> {
        let dir = self.root.join(".sorter/trash");
        if !dir.is_dir() {
            return Ok(0);
        }
        let mut n = 0;
        let mut stack = vec![dir.clone()];
        while let Some(d) = stack.pop() {
            for e in fs::read_dir(&d)?.flatten() {
                if e.file_type()?.is_dir() {
                    stack.push(e.path());
                } else {
                    n += 1;
                }
            }
        }
        fs::remove_dir_all(&dir)?;
        Ok(n)
    }

    /// The renames that would close the gaps in `folder` (modes `LastIntoGap` and `Renumber`).
    pub fn gap_fill_preview(&self, folder: &str, mode: GapMode) -> io::Result<Vec<Rename>> {
        check_folder(folder)?;
        let snap = library_snapshot(&self.root)?;
        let files = snap.folders.get(folder).cloned().unwrap_or_default();
        plan_gap_fill(
            &files,
            &self.cfg.prefix_for(folder),
            &self.cfg.settings.image_extensions,
            mode,
        )
        .map_err(|e| invalid(e.to_string()))
    }

    pub fn fill_gaps(&mut self, folder: &str, mode: GapMode) -> io::Result<Outcome> {
        let renames = self.gap_fill_preview(folder, mode)?;
        let actions = renames
            .into_iter()
            .map(|r| Action::Rename {
                from: format!("{folder}/{}", r.from),
                to: format!("{folder}/{}", r.to),
            })
            .collect();
        self.run_plan(Plan { actions }, HashMap::new())
    }

    /// Sets the source of a record by hand (for images whose origin could not be read from the name).
    pub fn edit_origin(&mut self, hash: &str, site: Site, id: &str) -> io::Result<bool> {
        let Some(mut o) = self.origins.get(hash).cloned() else {
            return Ok(false);
        };
        let src = Source::manual(site, id);
        if o.sources.is_empty() {
            o.sources.push(src);
        } else {
            o.sources[0] = src;
        }
        self.origins.upsert(o);
        self.origins.save()?;
        Ok(true)
    }

    /// Updates source metadata fetched for an existing origin and returns its current path.
    pub fn update_origin_metadata(
        &mut self,
        hash: &str,
        source: Source,
        tags: Vec<String>,
        rating: String,
    ) -> io::Result<Option<PathBuf>> {
        let Some(mut origin) = self.origins.get(hash).cloned() else {
            return Ok(None);
        };
        if origin.sources.is_empty() {
            origin.sources.push(source);
        } else {
            origin.sources[0] = source;
        }
        origin.tags = tags;
        origin.rating = Some(rating);
        let path = Path::new(&origin.path);
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(path)
        };
        self.origins.upsert(origin);
        self.origins.save()?;
        Ok(Some(path))
    }

    /// Saves metadata before a fetched file is handed to the normal planning pipeline.
    pub fn remember_fetch(
        &mut self,
        hash: &str,
        path: &str,
        name: &str,
        source: Source,
        tags: Vec<String>,
        rating: String,
    ) -> io::Result<()> {
        if let Some(mut origin) = self.origins.get(hash).cloned() {
            for tag in tags {
                if !origin
                    .tags
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(&tag))
                {
                    origin.tags.push(tag);
                }
            }
            if origin.rating.is_none() {
                origin.rating = Some(rating);
            }
            self.origins.upsert(origin);
        } else {
            let dims = imagesize::size(self.root.join(path)).ok();
            self.origins.upsert(Origin {
                hash: hash.to_string(),
                path: path.to_string(),
                original_name: name.to_string(),
                sources: vec![source.clone()],
                added: unix_now(),
                note: format!("fetched from {}", source.site.label()),
                width: dims.as_ref().map(|d| d.width as u32).unwrap_or(0),
                height: dims.as_ref().map(|d| d.height as u32).unwrap_or(0),
                tags,
                rating: Some(rating),
            });
        }
        self.origins.add_source(hash, source);
        self.origins.save()
    }

    /// Updates a newly fetched record after its staged file is safely moved into the library.
    pub fn relocate_fetch_origin(
        &mut self,
        hash: &str,
        staged_path: &str,
        library_path: &str,
    ) -> io::Result<()> {
        let Some(mut origin) = self.origins.get(hash).cloned() else {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "fetched origin record is missing",
            ));
        };
        if origin.path == staged_path {
            origin.path = library_path.to_string();
            self.origins.upsert(origin);
            self.origins.save()?;
        }
        Ok(())
    }

    /// Restore one duplicate as a new numbered image in a normal library folder.
    pub fn restore_duplicate(&mut self, file: &Path, folder: &str) -> io::Result<Outcome> {
        self.restore_duplicates(std::slice::from_ref(&file.to_path_buf()), folder)
    }

    /// Restore selected duplicate files as new numbered images, bypassing duplicate detection once.
    pub fn restore_duplicates(&mut self, files: &[PathBuf], folder: &str) -> io::Result<Outcome> {
        check_folder(folder)?;
        if folder == self.cfg.settings.duplicates_folder
            || folder.starts_with(&(self.cfg.settings.duplicates_folder.clone() + "/"))
        {
            return Err(invalid(
                "the Duplicates folder is not a place to restore into",
            ));
        }
        let dup_dir = self.root.join(&self.cfg.settings.duplicates_folder);
        for file in files {
            let rel = rel_inside(&self.root, file)
                .ok_or_else(|| invalid("duplicate restore paths must be inside the library"))?;
            if file.parent() != Some(dup_dir.as_path())
                || !rel.starts_with(&(self.cfg.settings.duplicates_folder.clone() + "/"))
            {
                return Err(invalid(
                    "only direct files in the Duplicates folder can be restored",
                ));
            }
            if !file.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("{} is not a file", file.display()),
                ));
            }
        }
        self.process_with(
            files,
            &PlanOptions {
                forced_dest: Some(folder.to_string()),
                skip_duplicate_check: true,
            },
        )
    }
}

/// One line per file that changed, for the API.
pub fn summarize(report: &Report) -> Vec<(String, String)> {
    report
        .done
        .iter()
        .map(|e| (e.from.clone(), e.to.clone()))
        .collect()
}
