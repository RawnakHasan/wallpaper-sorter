//! Append-only log of everything the sorter did, one JSON object per line.

use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
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
    /// Fingerprint of the restored file while it is being held.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold_size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold_mtime_ns: Option<u64>,
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
        let contents = match fs::read(&path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error),
        };
        let lines: Vec<&[u8]> = contents.split(|byte| *byte == b'\n').collect();
        let last_nonempty = lines
            .iter()
            .rposition(|line| !line.iter().all(u8::is_ascii_whitespace));
        let mut offset = 0usize;
        for (i, line) in lines.iter().enumerate() {
            if line.iter().all(u8::is_ascii_whitespace) {
                offset += line.len() + 1;
                continue;
            }
            match serde_json::from_slice::<Entry>(line) {
                Ok(entry) => entries.push(entry),
                Err(error) if Some(i) == last_nonempty => {
                    eprintln!(
                        "warning: truncating incomplete final log record in {}: {error}",
                        path.display()
                    );
                    let file = OpenOptions::new().write(true).open(&path)?;
                    file.set_len(offset as u64)?;
                    file.sync_data()?;
                    break;
                }
                Err(error) => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("{}: line {}: {error}", path.display(), i + 1),
                    ));
                }
            }
            offset += line.len() + 1;
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
        hold: Option<(u64, u64)>,
    ) -> io::Result<Entry> {
        let entry = Entry {
            id: self.entries.iter().map(|e| e.id).max().unwrap_or(0) + 1,
            batch,
            time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            kind,
            from: from.to_string(),
            to: to.to_string(),
            note: note.to_string(),
            undoes,
            hold_size: hold.map(|fp| fp.0),
            hold_mtime_ns: hold.map(|fp| fp.1),
        };
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let line = serde_json::to_string(&entry)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{line}")?;
        file.sync_data()?;
        self.entries.push(entry.clone());
        Ok(entry)
    }
}
