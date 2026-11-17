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
    p.strip_prefix(root)
        .ok()
        .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/"))
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
                let e: IndexEntry = serde_json::from_str(&line).map_err(|e| {
                    io::Error::new(io::ErrorKind::InvalidData, format!("{}: line {}: {e}", path.display(), i + 1))
                })?;
                entries.insert(e.path.clone(), e);
            }
        }
        Ok(Index { path, entries })
    }

    pub fn save(&self) -> io::Result<()> {
        let mut text = String::new();
        for e in self.entries.values() {
            text.push_str(&serde_json::to_string(e).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?);
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
        if let Some(mut e) = self.entries.remove(old) {
            e.path = new.to_string();
            self.entries.insert(new.to_string(), e);
        }
    }

    pub fn paths_for_hash(&self, hash: &str) -> Vec<&str> {
        self.entries.values().filter(|e| e.hash == hash).map(|e| e.path.as_str()).collect()
    }

    /// hash -> path of the first file with that content, leaving out the Duplicates folder
    /// (the copies there must not count as the original).
    pub fn library_hashes(&self, duplicates_folder: &str) -> HashMap<String, String> {
        self.library_hashes_except(duplicates_folder, &BTreeSet::new())
    }

    /// Like `library_hashes`, but ignoring the given paths. Used when files that are already in the library
    /// are looked at again: a file must never count as the original of itself.
    pub fn library_hashes_except(&self, duplicates_folder: &str, except: &BTreeSet<String>) -> HashMap<String, String> {
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
        for e in self.entries.values().filter(|e| !e.path.starts_with(&dup_prefix)) {
            by_hash.entry(e.hash.as_str()).or_default().push(e.path.clone());
        }
        by_hash.into_iter().filter(|(_, v)| v.len() > 1).map(|(h, v)| (h.to_string(), v)).collect()
    }

    /// Walks the library (hidden folders are skipped), keeps the cached hash of every image whose size and
    /// modification time are unchanged, hashes the rest, and forgets files that are gone.
    pub fn refresh(&mut self, root: &Path, image_exts: &[String]) -> io::Result<RefreshStats> {
        let mut stats = RefreshStats::default();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let kind = entry.file_type()?;
                if kind.is_dir() {
                    stack.push(entry.path());
                    continue;
                }
                if !kind.is_file() {
                    continue;
                }
                let ext = name.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
                if !image_exts.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                    continue;
                }
                let rel = match rel_inside(root, &entry.path()) {
                    Some(r) => r,
                    None => continue,
                };
                let (size, mtime_ns) = file_stat(&entry.path())?;
                seen.insert(rel.clone());
                match self.entries.get(&rel) {
                    Some(old) if old.size == size && old.mtime_ns == mtime_ns => stats.reused += 1,
                    _ => {
                        let hash = hash_file(&entry.path())?;
                        self.entries.insert(rel.clone(), IndexEntry { path: rel, size, mtime_ns, hash });
                        stats.hashed += 1;
                    }
                }
            }
        }
        let gone: Vec<String> = self.entries.keys().filter(|k| !seen.contains(*k)).cloned().collect();
        stats.removed = gone.len();
        for g in gone {
            self.entries.remove(&g);
        }
        Ok(stats)
    }
}
