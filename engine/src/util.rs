use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

/// Writes the whole file by writing a temporary file next to it and renaming it over the target,
/// so a crash never leaves a half-written file.
pub fn write_atomic(path: &Path, contents: &str) -> io::Result<()> {
    let target = if path.is_symlink() {
        fs::canonicalize(path)?
    } else {
        path.to_path_buf()
    };
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let file_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let mut tmp_name = file_name.to_os_string();
    tmp_name.push(format!(
        ".{}.tmp",
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let tmp = target.with_file_name(tmp_name);
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(contents.as_bytes())?;
        f.sync_data()?;
    }
    if let Err(error) = fs::rename(&tmp, &target) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}

pub fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);
