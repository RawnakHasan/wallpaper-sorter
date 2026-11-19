//! Applying a plan to the disk. Nothing is ever overwritten: a move whose target exists fails.

use crate::log::{Entry, Kind, Log};
use sorter_core::{Action, LeaveReason, Plan};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum ExecError {
    SourceMissing(PathBuf),
    TargetExists(PathBuf),
    Io { path: PathBuf, source: io::Error },
}

impl ExecError {
    pub(crate) fn io(path: &Path, source: io::Error) -> ExecError {
        ExecError::Io {
            path: path.to_path_buf(),
            source,
        }
    }
}

impl fmt::Display for ExecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExecError::SourceMissing(p) => write!(f, "{} is gone", p.display()),
            ExecError::TargetExists(p) => write!(f, "{} already exists", p.display()),
            ExecError::Io { path, source } => write!(f, "{}: {source}", path.display()),
        }
    }
}

impl std::error::Error for ExecError {}

/// Moves a file without replacing anything. Creates missing folders. Falls back to copy,
/// check size, delete when the move crosses drives.
pub fn move_no_replace(from: &Path, to: &Path) -> Result<(), ExecError> {
    if fs::symlink_metadata(from).is_err() {
        return Err(ExecError::SourceMissing(from.to_path_buf()));
    }
    if fs::symlink_metadata(to).is_ok() {
        return Err(ExecError::TargetExists(to.to_path_buf()));
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| ExecError::io(parent, e))?;
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        // 18 is EXDEV on Linux: source and target are on different drives.
        Err(e) if e.raw_os_error() == Some(18) => {
            let copied = fs::copy(from, to).map_err(|e| ExecError::io(to, e))?;
            let size = fs::metadata(from)
                .map_err(|e| ExecError::io(from, e))?
                .len();
            if copied != size {
                let _ = fs::remove_file(to);
                return Err(ExecError::io(
                    to,
                    io::Error::new(io::ErrorKind::Other, "copy size mismatch"),
                ));
            }
            fs::remove_file(from).map_err(|e| ExecError::io(from, e))
        }
        Err(e) => Err(ExecError::io(from, e)),
    }
}

#[derive(Debug, Default)]
pub struct Report {
    pub batch: u64,
    /// What was done, as written to the log.
    pub done: Vec<Entry>,
    /// Sources that had vanished by the time we got to them.
    pub skipped: Vec<String>,
    /// Files the plan left alone, with the reason.
    pub left: Vec<(String, LeaveReason)>,
    /// The error that stopped the batch, if any. Everything before it is done and logged.
    pub error: Option<ExecError>,
}

/// Applies the plan in order and logs each step. Stops at the first error.
pub fn apply(plan: &Plan, root: &Path, log: &mut Log) -> Report {
    let mut report = Report {
        batch: log.next_batch(),
        ..Default::default()
    };
    for action in &plan.actions {
        let (kind, from, to, note) = match action {
            Action::Ignore { .. } => continue,
            Action::Leave { path, reason } => {
                report.left.push((path.clone(), reason.clone()));
                continue;
            }
            Action::Move {
                from,
                to,
                rule,
                matched,
            } => (
                Kind::Move,
                PathBuf::from(from),
                root.join(to),
                format!("{}; tags: {}", rule.label(), matched.join(";")),
            ),
            Action::Rename { from, to } => {
                (Kind::Rename, root.join(from), root.join(to), String::new())
            }
            Action::ToDuplicates {
                from,
                to,
                duplicate_of,
            } => (
                Kind::Duplicate,
                PathBuf::from(from),
                root.join(to),
                format!("duplicate of {duplicate_of}"),
            ),
        };
        match move_no_replace(&from, &to) {
            Ok(()) => match log.append(
                kind,
                report.batch,
                &from.to_string_lossy(),
                &to.to_string_lossy(),
                &note,
                None,
                None,
            ) {
                Ok(entry) => report.done.push(entry),
                Err(e) => {
                    report.error = Some(ExecError::io(&to, e));
                    break;
                }
            },
            Err(ExecError::SourceMissing(p)) => {
                report.skipped.push(p.to_string_lossy().to_string())
            }
            Err(e) => {
                report.error = Some(e);
                break;
            }
        }
    }
    report
}
