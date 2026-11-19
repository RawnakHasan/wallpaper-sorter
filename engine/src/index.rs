//! Content hashes of the files in the library, cached on disk so unchanged files are never read twice.

use crate::util::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexEntry {
    /// Relative to the library root, with '/' as separator.
    pub path: String,
    pub size: u64,
    pub mtime_ns: u64,
    pub hash: String,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct RefreshStats {
    pub hashed: usize,
    pub reused: usize,
    pub removed: usize,
    pub skipped: usize,
}

fn add_cached_subtree(
    entries: &BTreeMap<String, IndexEntry>,
    path: &str,
    paths: &mut BTreeSet<String>,
) {
    if entries.contains_key(path) {
        paths.insert(path.to_string());
    }
    let prefix = format!("{path}/");
    paths.extend(
        entries
            .keys()
            .filter(|entry_path| entry_path.starts_with(&prefix))
            .cloned(),
    );
}

/// BLAKE3 of the file's content, as lowercase hex.
pub fn hash_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    io::copy(&mut file, &mut hasher)?;
    Ok(hasher.finalize().to_hex().to_string())
}

/// (size in bytes, modification time in nanoseconds since the epoch)
pub fn file_stat(path: &Path) -> io::Result<(u64, u64)> {
    let meta = fs::metadata(path)?;
    let mtime = meta
        .modified()?
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    Ok((meta.len(), mtime))
}

pub fn rel_inside(root: &Path, p: &Path) -> Option<String> {
    p.strip_prefix(root).ok().map(|r| {
        r.components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/")
    })
}

pub struct Index {
    path: PathBuf,
    entries: BTreeMap<String, IndexEntry>,
}

impl Index {
    pub fn open(path: impl Into<PathBuf>) -> io::Result<Index> {
        let path = path.into();
        let mut entries = BTreeMap::new();
        if path.exists() {
            for (i, line) in BufReader::new(File::open(&path)?).lines().enumerate() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<IndexEntry>(&line) {
                    Ok(entry) => {
                        entries.insert(entry.path.clone(), entry);
                    }
                    Err(error) => {
                        eprintln!(
                            "warning: discarding corrupt hash index {} at line {}: {error}; it will be rebuilt",
                            path.display(),
                            i + 1
                        );
                        entries.clear();
                        break;
                    }
                }
            }
        }
        Ok(Index { path, entries })
    }

    pub fn save(&self) -> io::Result<()> {
        let mut text = String::new();
        for e in self.entries.values() {
            text.push_str(
                &serde_json::to_string(e)
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?,
            );
            text.push('\n');
        }
        write_atomic(&self.path, &text)
    }

    pub fn get(&self, path: &str) -> Option<&IndexEntry> {
        self.entries.get(path)
    }

    pub fn entries(&self) -> impl Iterator<Item = &IndexEntry> {
        self.entries.values()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn insert(&mut self, e: IndexEntry) {
        self.entries.insert(e.path.clone(), e);
    }

    pub fn remove(&mut self, path: &str) {
        self.entries.remove(path);
    }

    pub fn rename(&mut self, old: &str, new: &str) {
        let moved: Vec<IndexEntry> = self
            .entries
            .values()
            .filter(|e| {
                e.path == old
                    || e.path
                        .strip_prefix(old)
                        .map_or(false, |tail| tail.starts_with('/'))
            })
            .cloned()
            .collect();
        for mut e in moved {
            self.entries.remove(&e.path);
            e.path = format!("{new}{}", e.path.strip_prefix(old).unwrap_or_default());
            self.entries.insert(e.path.clone(), e);
        }
    }

    pub fn paths_for_hash(&self, hash: &str) -> Vec<&str> {
        self.entries
            .values()
            .filter(|e| e.hash == hash)
            .map(|e| e.path.as_str())
            .collect()
    }

    /// hash -> path of the first file with that content, leaving out the Duplicates folder
    /// (the copies there must not count as the original).
    pub fn library_hashes(&self, duplicates_folder: &str) -> HashMap<String, String> {
        self.library_hashes_except(duplicates_folder, &BTreeSet::new())
    }

    /// Like `library_hashes`, but ignoring the given paths. Used when files that are already in the library
    /// are looked at again: a file must never count as the original of itself.
    pub fn library_hashes_except(
        &self,
        duplicates_folder: &str,
        except: &BTreeSet<String>,
    ) -> HashMap<String, String> {
        let dup_prefix = format!("{duplicates_folder}/");
        let mut out = HashMap::new();
        for e in self.entries.values() {
            if e.path.starts_with(&dup_prefix) || except.contains(&e.path) {
                continue;
            }
            out.entry(e.hash.clone()).or_insert_with(|| e.path.clone());
        }
        out
    }

    /// Groups of paths (outside the Duplicates folder) that hold identical content.
    pub fn existing_duplicates(&self, duplicates_folder: &str) -> Vec<(String, Vec<String>)> {
        let dup_prefix = format!("{duplicates_folder}/");
        let mut by_hash: BTreeMap<&str, Vec<String>> = BTreeMap::new();
        for e in self
            .entries
            .values()
            .filter(|e| !e.path.starts_with(&dup_prefix))
        {
            by_hash
                .entry(e.hash.as_str())
                .or_default()
                .push(e.path.clone());
        }
        by_hash
            .into_iter()
            .filter(|(_, v)| v.len() > 1)
            .map(|(h, v)| (h.to_string(), v))
            .collect()
    }

    /// Walks the library (hidden folders are skipped), keeps the cached hash of every image whose size and
    /// modification time are unchanged, hashes the rest, and forgets files that are gone.
    pub fn refresh(&mut self, root: &Path, image_exts: &[String]) -> io::Result<RefreshStats> {
        let mut stats = RefreshStats::default();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut missing: BTreeSet<String> = BTreeSet::new();
        let mut incomplete = false;
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let directory = match fs::read_dir(&dir) {
                Ok(directory) => directory,
                Err(error) if dir == root => return Err(error),
                Err(error) => {
                    stats.skipped += 1;
                    if let Some(relative) = rel_inside(root, &dir) {
                        if error.kind() == io::ErrorKind::NotFound {
                            add_cached_subtree(&self.entries, &relative, &mut missing);
                        } else {
                            add_cached_subtree(&self.entries, &relative, &mut seen);
                        }
                    }
                    continue;
                }
            };
            for entry_result in directory {
                let entry = match entry_result {
                    Ok(entry) => entry,
                    Err(_) => {
                        stats.skipped += 1;
                        incomplete = true;
                        continue;
                    }
                };
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let path = entry.path();
                let relative = match rel_inside(root, &path) {
                    Some(relative) => relative,
                    None => continue,
                };
                let kind = match entry.file_type() {
                    Ok(kind) => kind,
                    Err(error) => {
                        stats.skipped += 1;
                        if error.kind() == io::ErrorKind::NotFound {
                            add_cached_subtree(&self.entries, &relative, &mut missing);
                        } else {
                            add_cached_subtree(&self.entries, &relative, &mut seen);
                        }
                        continue;
                    }
                };
                if kind.is_dir() {
                    stack.push(path);
                    continue;
                }
                let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
                if !image_exts.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                    continue;
                }
                if kind.is_symlink() {
                    stats.skipped += 1;
                    missing.insert(relative);
                    continue;
                }
                if !kind.is_file() {
                    continue;
                }
                let (size, mtime_ns) = match file_stat(&path) {
                    Ok(stat) => stat,
                    Err(error) => {
                        stats.skipped += 1;
                        if error.kind() == io::ErrorKind::NotFound {
                            missing.insert(relative);
                        } else {
                            seen.insert(relative);
                        }
                        continue;
                    }
                };
                match self.entries.get(&relative) {
                    Some(old) if old.size == size && old.mtime_ns == mtime_ns => {
                        seen.insert(relative);
                        stats.reused += 1;
                    }
                    _ => match hash_file(&path) {
                        Ok(hash) => {
                            seen.insert(relative.clone());
                            self.entries.insert(
                                relative.clone(),
                                IndexEntry {
                                    path: relative,
                                    size,
                                    mtime_ns,
                                    hash,
                                },
                            );
                            stats.hashed += 1;
                        }
                        Err(error) => {
                            stats.skipped += 1;
                            if error.kind() == io::ErrorKind::NotFound {
                                missing.insert(relative);
                            } else {
                                seen.insert(relative);
                            }
                        }
                    },
                }
            }
        }
        let gone: Vec<String> = if incomplete {
            missing
                .into_iter()
                .filter(|path| self.entries.contains_key(path))
                .collect()
        } else {
            self.entries
                .keys()
                .filter(|path| missing.contains(*path) || !seen.contains(*path))
                .cloned()
                .collect()
        };
        stats.removed = gone.len();
        for g in gone {
            self.entries.remove(&g);
        }
        Ok(stats)
    }
}
