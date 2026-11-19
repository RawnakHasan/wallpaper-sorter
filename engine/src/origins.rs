//! Permanent record of where each image came from, keyed by its content hash.

use crate::util::write_atomic;
use serde::{Deserialize, Serialize};
use sorter_core::Source;
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

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
            let contents = fs::read(&path)?;
            let mut corrupt = None;
            for (i, line) in contents.split(|byte| *byte == b'\n').enumerate() {
                if line.iter().all(u8::is_ascii_whitespace) {
                    continue;
                }
                match serde_json::from_slice::<Origin>(line) {
                    Ok(origin) => {
                        map.insert(origin.hash.clone(), origin);
                    }
                    Err(error) => {
                        corrupt = Some((i + 1, error));
                        break;
                    }
                }
            }
            if let Some((line, error)) = corrupt {
                let backup = preserve_corrupt_file(&path, &contents)?;
                eprintln!(
                    "warning: preserving corrupt origin records from {} (line {line}) at {}: {error}; starting with an empty store",
                    path.display(),
                    backup.display()
                );
                map.clear();
            }
        }
        Ok(OriginStore { path, map })
    }

    pub fn save(&self) -> io::Result<()> {
        let mut text = String::new();
        for o in self.map.values() {
            text.push_str(
                &serde_json::to_string(o)
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?,
            );
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
        for o in self.map.values_mut() {
            if o.path == old
                || o.path
                    .strip_prefix(old)
                    .map_or(false, |tail| tail.starts_with('/'))
            {
                o.path = format!("{new}{}", o.path.strip_prefix(old).unwrap_or_default());
            }
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

fn preserve_corrupt_file(path: &Path, contents: &[u8]) -> io::Result<PathBuf> {
    let mut base = path.as_os_str().to_os_string();
    base.push(".corrupt");
    let mut suffix = 0u64;
    loop {
        let mut name = base.clone();
        if suffix > 0 {
            name.push(format!(".{suffix}"));
        }
        let backup = PathBuf::from(name);
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&backup)
        {
            Ok(mut file) => {
                let result = file.write_all(contents).and_then(|()| file.sync_all());
                if let Err(error) = result {
                    drop(file);
                    let _ = fs::remove_file(&backup);
                    return Err(error);
                }
                return Ok(backup);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                suffix = suffix.checked_add(1).ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "no unused corrupt-backup name",
                    )
                })?;
            }
            Err(error) => return Err(error),
        }
    }
}
