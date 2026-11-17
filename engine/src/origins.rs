//! Permanent record of where each image came from, keyed by its content hash.

use crate::util::write_atomic;
use serde::{Deserialize, Serialize};
use sorter_core::Source;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Origin {
    pub hash: String,
    /// Where the file is now: relative to the library root, or absolute if it is outside the library.
    pub path: String,
    /// The name it had when it arrived.
    pub original_name: String,
    /// Where it came from. More than one if the same image arrived from several sites.
    pub sources: Vec<Source>,
    /// Seconds since the epoch.
    pub added: u64,
    /// Why it is where it is (rule and tags), or a short remark.
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
}

pub struct OriginStore {
    path: PathBuf,
    map: BTreeMap<String, Origin>,
}

impl OriginStore {
    pub fn open(path: impl Into<PathBuf>) -> io::Result<OriginStore> {
        let path = path.into();
        let mut map = BTreeMap::new();
        if path.exists() {
            for (i, line) in BufReader::new(File::open(&path)?).lines().enumerate() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let o: Origin = serde_json::from_str(&line).map_err(|e| {
                    io::Error::new(io::ErrorKind::InvalidData, format!("{}: line {}: {e}", path.display(), i + 1))
                })?;
                map.insert(o.hash.clone(), o);
            }
        }
        Ok(OriginStore { path, map })
    }

    pub fn save(&self) -> io::Result<()> {
        let mut text = String::new();
        for o in self.map.values() {
            text.push_str(&serde_json::to_string(o).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?);
            text.push('\n');
        }
        write_atomic(&self.path, &text)
    }

    pub fn get(&self, hash: &str) -> Option<&Origin> {
        self.map.get(hash)
    }

    pub fn get_by_path(&self, path: &str) -> Option<&Origin> {
        self.map.values().find(|o| o.path == path)
    }

    pub fn all(&self) -> impl Iterator<Item = &Origin> {
        self.map.values()
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn upsert(&mut self, o: Origin) {
        self.map.insert(o.hash.clone(), o);
    }

    /// Updates the path of the record that currently has `old`.
    pub fn set_path(&mut self, old: &str, new: &str) {
        if let Some(o) = self.map.values_mut().find(|o| o.path == old) {
            o.path = new.to_string();
        }
    }

    pub fn set_path_for_hash(&mut self, hash: &str, new: &str) {
        if let Some(o) = self.map.get_mut(hash) {
            o.path = new.to_string();
        }
    }

    /// Adds a source unless the same site, id and page is already recorded. Unknown sources are not added.
    pub fn add_source(&mut self, hash: &str, src: Source) -> bool {
        if src.site == sorter_core::Site::Unknown {
            return false;
        }
        match self.map.get_mut(hash) {
            Some(o) if !o.sources.iter().any(|s| s.same_origin(&src)) => {
                o.sources.push(src);
                true
            }
            _ => false,
        }
    }
}
