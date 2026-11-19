//! Looks at the library folder and builds the snapshot the planner works from.

use sorter_core::Library;
use std::fs;
use std::io;
use std::path::Path;

fn rel(root: &Path, dir: &Path) -> String {
    dir.strip_prefix(root)
        .map(|p| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

fn walk(root: &Path, dir: &Path, lib: &mut Library) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if dir == root => return Err(error),
        Err(_) => return Ok(()),
    };
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue; // .sorter and other hidden folders are not part of the library
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            lib.folders.entry(rel(root, &entry.path())).or_default();
            walk(root, &entry.path(), lib)?;
        } else if kind.is_file() && dir != root {
            lib.folders.entry(rel(root, dir)).or_default().push(name);
        }
    }
    Ok(())
}

/// Folders and the file names in them (files directly in the root are the unsorted ones and are not listed).
/// The hash index starts empty: hashing comes later.
pub fn library_snapshot(root: &Path) -> io::Result<Library> {
    let mut lib = Library::default();
    walk(root, root, &mut lib)?;
    for files in lib.folders.values_mut() {
        files.sort();
    }
    Ok(lib)
}
