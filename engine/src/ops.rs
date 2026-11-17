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
    classify, expand_home, plan_gap_fill, plan_new_file, Action, Config, Dest, GapMode, Plan, PlanOptions, Rename, Rule,
    Site, Source,
};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct InboxItem {
    /// Absolute path.
    pub path: String,
    pub name: String,
    /// "no_match", "conflict", or "ready" (a tag now matches; the next scan will sort it).
    pub reason: String,
    pub matched: Vec<String>,
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
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

impl Pipeline {
    pub fn set_config(&mut self, cfg: Config) {
        self.cfg = cfg;
    }

    pub fn intake_dirs(&self) -> Vec<PathBuf> {
        self.cfg.intake.iter().map(|i| expand_home(&i.path)).collect()
    }

    /// Absolute path for a path the UI sent: relative paths are inside the library. It must lie inside the
    /// library or an intake folder, and contain no "..".
    pub fn resolve(&self, p: &str) -> io::Result<PathBuf> {
        let path = if Path::new(p).is_absolute() { PathBuf::from(p) } else { self.root.join(p) };
        if path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(invalid("path must not contain .."));
        }
        let inside = path.starts_with(&self.root) || self.intake_dirs().iter().any(|d| path.starts_with(d));
        if !inside {
            return Err(invalid("path is outside the library and the intake folders"));
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
                        Ok(t) if t.is_file() => found.push((e.path(), dir.to_string_lossy().to_string())),
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
            let d = classify(&name, &self.cfg);
            let reason = match (&d.dest, d.rule) {
                (Dest::Folder(_), _) => "ready",
                (_, Rule::Conflict) => "conflict",
                _ => "no_match",
            };
            let origin = match rel_inside(&self.root, &path) {
                Some(rel) => self.index.get(&rel).and_then(|e| self.origins.get(&e.hash)).cloned(),
                None => self.origins.get_by_path(&path.to_string_lossy()).cloned(),
            };
            let meta = fs::metadata(&path).ok();
            items.push(InboxItem {
                path: path.to_string_lossy().to_string(),
                name,
                reason: reason.to_string(),
                matched: d.matched,
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
        out.sort_by(|a, b| (a.number.is_none(), a.number, &a.name).cmp(&(b.number.is_none(), b.number, &b.name)));
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
        plan_new_file(&files, &prefix, ext, self.cfg.settings.gap_mode, &self.cfg.settings.image_extensions)
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
        self.process_with(files, &PlanOptions { forced_dest: Some(folder.to_string()) })
    }

    /// "Delete" moves files to `.sorter/trash` (inside the library, hidden), so it can be undone.
    pub fn delete(&mut self, files: &[PathBuf]) -> io::Result<Outcome> {
        let (meta, _) = self.meta_for(files);
        let stamp = unix_now();
        let actions = files
            .iter()
            .enumerate()
            .filter(|(_, f)| fs::symlink_metadata(f).map(|m| m.is_file()).unwrap_or(false))
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
        plan_gap_fill(&files, &self.cfg.prefix_for(folder), &self.cfg.settings.image_extensions, mode)
            .map_err(|e| invalid(e.to_string()))
    }

    pub fn fill_gaps(&mut self, folder: &str, mode: GapMode) -> io::Result<Outcome> {
        let renames = self.gap_fill_preview(folder, mode)?;
        let actions = renames
            .into_iter()
            .map(|r| Action::Rename { from: format!("{folder}/{}", r.from), to: format!("{folder}/{}", r.to) })
            .collect();
        self.run_plan(Plan { actions }, HashMap::new())
    }

    /// Sets the source of a record by hand (for images whose origin could not be read from the name).
    pub fn edit_origin(&mut self, hash: &str, site: Site, id: &str) -> io::Result<bool> {
        let Some(mut o) = self.origins.get(hash).cloned() else { return Ok(false) };
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
}

/// One line per file that changed, for the API.
pub fn summarize(report: &Report) -> Vec<(String, String)> {
    report.done.iter().map(|e| (e.from.clone(), e.to.clone())).collect()
}
