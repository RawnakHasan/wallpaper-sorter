//! Append-only log of everything the sorter did, one JSON object per line.

use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Move,
    Rename,
    Duplicate,
    Undo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: u64,
    /// Entries written by one call to `apply` (or one undo) share a batch number.
    pub batch: u64,
    /// Seconds since the Unix epoch.
    pub time: u64,
    pub kind: Kind,
    /// Absolute path before the action, and after it.
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub note: String,
    /// For an undo entry: the id of the entry it reverses.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undoes: Option<u64>,
}

pub struct Log {
    path: PathBuf,
    entries: Vec<Entry>,
}

impl Log {
    /// Opens the log, reading what is already in it. A missing file is an empty log.
    pub fn open(path: impl Into<PathBuf>) -> io::Result<Log> {
        let path = path.into();
        let mut entries = Vec::new();
        if path.exists() {
            for (i, line) in BufReader::new(File::open(&path)?).lines().enumerate() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let entry: Entry = serde_json::from_str(&line).map_err(|e| {
                    io::Error::new(io::ErrorKind::InvalidData, format!("{}: line {}: {e}", path.display(), i + 1))
                })?;
                entries.push(entry);
            }
        }
        Ok(Log { path, entries })
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn get(&self, id: u64) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn next_batch(&self) -> u64 {
        self.entries.iter().map(|e| e.batch).max().unwrap_or(0) + 1
    }

    pub fn is_undone(&self, id: u64) -> bool {
        self.entries.iter().any(|e| e.undoes == Some(id))
    }

    pub fn append(
        &mut self,
        kind: Kind,
        batch: u64,
        from: &str,
        to: &str,
        note: &str,
        undoes: Option<u64>,
    ) -> io::Result<Entry> {
        let entry = Entry {
            id: self.entries.iter().map(|e| e.id).max().unwrap_or(0) + 1,
            batch,
            time: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            kind,
            from: from.to_string(),
            to: to.to_string(),
            note: note.to_string(),
            undoes,
        };
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let line = serde_json::to_string(&entry).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        writeln!(file, "{line}")?;
        file.sync_data()?;
        self.entries.push(entry.clone());
        Ok(entry)
    }
}
