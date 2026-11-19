//! Applying a plan to the disk. Nothing is ever overwritten: a move whose target exists fails.

use crate::log::{Entry, Kind, Log};
use sorter_core::{Action, LeaveReason, Plan};
use std::ffi::CString;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::os::unix::ffi::OsStrExt;
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
    match rename_no_replace(from, to) {
        Ok(()) => Ok(()),
        Err(e) if e.raw_os_error() == Some(libc::EXDEV) => {
            copy_no_replace(from, to)?;
            fs::remove_file(from).map_err(|e| ExecError::io(from, e))
        }
        Err(e) if e.raw_os_error() == Some(libc::EEXIST) => {
            Err(ExecError::TargetExists(to.to_path_buf()))
        }
        Err(e) => Err(ExecError::io(from, e)),
    }
}

fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    let from = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "source path contains NUL"))?;
    let to = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "target path contains NUL"))?;
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if matches!(
        error.raw_os_error(),
        Some(libc::ENOSYS) | Some(libc::EINVAL)
    ) {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "filesystem or kernel does not support atomic no-replace rename",
        ));
    }
    Err(error)
}

fn copy_no_replace(from: &Path, to: &Path) -> Result<(), ExecError> {
    let mut source = File::open(from).map_err(|e| ExecError::io(from, e))?;
    let source_size = source.metadata().map_err(|e| ExecError::io(from, e))?.len();
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|e| {
            if e.kind() == io::ErrorKind::AlreadyExists {
                ExecError::TargetExists(to.to_path_buf())
            } else {
                ExecError::io(to, e)
            }
        })?;
    let copy_result = (|| {
        let copied = io::copy(&mut source, &mut target).map_err(|e| ExecError::io(to, e))?;
        target.sync_all().map_err(|e| ExecError::io(to, e))?;
        let target_size = target.metadata().map_err(|e| ExecError::io(to, e))?.len();
        if copied != source_size || target_size != source_size {
            return Err(ExecError::io(
                to,
                io::Error::new(io::ErrorKind::Other, "copy size mismatch"),
            ));
        }
        Ok(())
    })();
    if let Err(error) = copy_result {
        drop(target);
        let _ = fs::remove_file(to);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{copy_no_replace, ExecError};
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn copy_no_replace_preserves_an_existing_target() {
        let root = std::env::temp_dir().join(format!(
            "sorter-copy-no-replace-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.png");
        let target = root.join("target.png");
        fs::write(&source, b"source").unwrap();
        fs::write(&target, b"target").unwrap();

        assert!(matches!(
            copy_no_replace(&source, &target),
            Err(ExecError::TargetExists(path)) if path == target
        ));
        assert_eq!(fs::read(&source).unwrap(), b"source");
        assert_eq!(fs::read(&target).unwrap(), b"target");
        fs::remove_dir_all(root).unwrap();
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
