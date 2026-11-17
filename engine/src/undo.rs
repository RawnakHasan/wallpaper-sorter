//! Undo: moves a file back where it came from. If that name is taken, the file comes back with a suffix.

use crate::exec::{move_no_replace, ExecError};
use crate::log::{Entry, Kind, Log};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum UndoError {
    NotFound(u64),
    AlreadyUndone(u64),
    /// Undo entries cannot be undone.
    NotUndoable(u64),
    /// The file is no longer where the log says it is (moved or deleted since).
    FileMovedSince(String),
    Exec(ExecError),
    Log(io::Error),
}

impl fmt::Display for UndoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UndoError::NotFound(id) => write!(f, "nothing in the log with id {id}"),
            UndoError::AlreadyUndone(id) => write!(f, "entry {id} was already undone"),
            UndoError::NotUndoable(id) => write!(f, "entry {id} cannot be undone"),
            UndoError::FileMovedSince(p) => write!(f, "file was moved since: {p}"),
            UndoError::Exec(e) => write!(f, "{e}"),
            UndoError::Log(e) => write!(f, "log: {e}"),
        }
    }
}

impl std::error::Error for UndoError {}

fn unique_path(original: &Path) -> PathBuf {
    let dir = original.parent().unwrap_or_else(|| Path::new(""));
    let name = original.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (name[..i].to_string(), name[i..].to_string()),
        _ => (name.clone(), String::new()),
    };
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|p| fs::symlink_metadata(p).is_err())
        .expect("an unused name exists")
}

fn undo_one(log: &mut Log, id: u64, batch: u64) -> Result<Entry, UndoError> {
    let entry = log.get(id).cloned().ok_or(UndoError::NotFound(id))?;
    if entry.kind == Kind::Undo {
        return Err(UndoError::NotUndoable(id));
    }
    if log.is_undone(id) {
        return Err(UndoError::AlreadyUndone(id));
    }
    let current = PathBuf::from(&entry.to);
    let original = PathBuf::from(&entry.from);
    if fs::symlink_metadata(&current).is_err() {
        return Err(UndoError::FileMovedSince(entry.to.clone()));
    }
    let target = if fs::symlink_metadata(&original).is_ok() { unique_path(&original) } else { original };
    move_no_replace(&current, &target).map_err(UndoError::Exec)?;
    log.append(
        Kind::Undo,
        batch,
        &entry.to,
        &target.to_string_lossy(),
        &format!("undo of {id}"),
        Some(id),
    )
    .map_err(UndoError::Log)
}

/// Undo one logged action.
pub fn undo_entry(log: &mut Log, id: u64) -> Result<Entry, UndoError> {
    let batch = log.next_batch();
    undo_one(log, id, batch)
}

/// Undo a whole batch, newest action first, so renames unwind safely. Stops at the first problem;
/// what was already undone stays undone and is logged.
pub fn undo_batch(log: &mut Log, batch_id: u64) -> Result<Vec<Entry>, UndoError> {
    if log.entries().iter().all(|e| e.batch != batch_id) {
        return Err(UndoError::NotFound(batch_id));
    }
    let ids: Vec<u64> = log
        .entries()
        .iter()
        .filter(|e| e.batch == batch_id && e.kind != Kind::Undo && !log.is_undone(e.id))
        .map(|e| e.id)
        .collect();
    let new_batch = log.next_batch();
    let mut out = Vec::new();
    for id in ids.into_iter().rev() {
        out.push(undo_one(log, id, new_batch)?);
    }
    Ok(out)
}
