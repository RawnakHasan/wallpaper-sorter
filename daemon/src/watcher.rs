//! inotify: tells us when a file has been written or moved into a watched folder.
//! Only "finished writing" and "moved in" count; creating a file is not enough, because it is still empty.

use inotify::{EventMask, Inotify, WatchDescriptor, WatchMask};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::os::fd::{AsRawFd, RawFd};
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq, Eq)]
pub enum Event {
    /// A file was finished or moved in.
    File(PathBuf),
    /// The kernel dropped events; everything should be looked at again.
    Overflow,
    /// A watched directory was removed or its watch was otherwise lost.
    WatchLost(PathBuf),
}

struct Dir {
    path: PathBuf,
    recursive: bool,
}

pub struct DirWatcher {
    inotify: Inotify,
    dirs: HashMap<WatchDescriptor, Dir>,
    errors: Vec<(PathBuf, String)>,
}

fn file_mask() -> WatchMask {
    WatchMask::CLOSE_WRITE | WatchMask::MOVED_TO
}

impl DirWatcher {
    pub fn new() -> io::Result<DirWatcher> {
        Ok(DirWatcher {
            inotify: Inotify::init()?,
            dirs: HashMap::new(),
            errors: Vec::new(),
        })
    }

    pub fn fd(&self) -> RawFd {
        self.inotify.as_raw_fd()
    }

    /// Starts watching `path` (and, if `recursive`, every folder below it, now and later).
    /// Returns the files that are already inside the folders it just started watching.
    pub fn add(&mut self, path: &Path, recursive: bool) -> io::Result<Vec<PathBuf>> {
        self.errors.clear();
        let mut found = Vec::new();
        let existing: HashSet<WatchDescriptor> = self.dirs.keys().cloned().collect();
        match self.add_dir(path, recursive, path, &mut found) {
            Ok(()) => Ok(found),
            Err(error) => {
                let added: Vec<WatchDescriptor> = self
                    .dirs
                    .keys()
                    .filter(|wd| !existing.contains(*wd))
                    .cloned()
                    .collect();
                for wd in added {
                    let _ = self.inotify.watches().remove(wd.clone());
                    self.dirs.remove(&wd);
                }
                Err(error)
            }
        }
    }

    fn add_dir(
        &mut self,
        path: &Path,
        recursive: bool,
        root: &Path,
        found: &mut Vec<PathBuf>,
    ) -> io::Result<()> {
        let mask = if recursive {
            file_mask() | WatchMask::CREATE
        } else {
            file_mask()
        };
        let wd = match self.inotify.watches().add(path, mask) {
            Ok(wd) => wd,
            Err(error) => {
                let error = io::Error::new(
                    error.kind(),
                    format!(
                        "cannot watch {}: {error} (is the inotify watch limit reached?)",
                        path.display()
                    ),
                );
                if path == root {
                    return Err(error);
                }
                self.errors.push((path.to_path_buf(), error.to_string()));
                return Ok(());
            }
        };
        self.dirs.insert(
            wd.clone(),
            Dir {
                path: path.to_path_buf(),
                recursive,
            },
        );
        let entries = match fs::read_dir(path) {
            Ok(entries) => entries,
            Err(error) if path == root => {
                let _ = self.inotify.watches().remove(wd.clone());
                self.dirs.remove(&wd);
                return Err(error);
            }
            Err(error) => {
                self.errors.push((
                    path.to_path_buf(),
                    format!("cannot scan watched subfolder {}: {error}", path.display()),
                ));
                return Ok(());
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    self.errors.push((
                        path.to_path_buf(),
                        format!(
                            "cannot read an entry in watched folder {}: {error}",
                            path.display()
                        ),
                    ));
                    continue;
                }
            };
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(error) => {
                    self.errors.push((
                        entry.path(),
                        format!(
                            "cannot inspect watched entry {}: {error}",
                            entry.path().display()
                        ),
                    ));
                    continue;
                }
            };
            if kind.is_dir() && recursive {
                self.add_dir(&entry.path(), true, root, found)?;
            } else if kind.is_file() {
                found.push(entry.path());
            }
        }
        Ok(())
    }

    pub fn take_errors(&mut self) -> Vec<(PathBuf, String)> {
        std::mem::take(&mut self.errors)
    }

    /// Everything that has happened since the last call. Does not wait.
    pub fn read(&mut self) -> io::Result<Vec<Event>> {
        let mut raw: Vec<(WatchDescriptor, EventMask, Option<OsString>)> = Vec::new();
        let mut buffer = [0u8; 8192];
        loop {
            match self.inotify.read_events(&mut buffer) {
                Ok(events) => {
                    let before = raw.len();
                    for e in events {
                        raw.push((e.wd, e.mask, e.name.map(|n| n.to_os_string())));
                    }
                    if raw.len() == before {
                        break;
                    }
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                Err(e) => return Err(e),
            }
        }

        let mut out = Vec::new();
        for (wd, mask, name) in raw {
            if mask.contains(EventMask::Q_OVERFLOW) {
                out.push(Event::Overflow);
                continue;
            }
            if mask.contains(EventMask::IGNORED) {
                if let Some(dir) = self.dirs.remove(&wd) {
                    out.push(Event::WatchLost(dir.path));
                }
                continue;
            }
            let (dir_path, recursive) = match self.dirs.get(&wd) {
                Some(d) => (d.path.clone(), d.recursive),
                None => continue,
            };
            let Some(name) = name else { continue };
            let path = dir_path.join(name);
            if mask.contains(EventMask::ISDIR) {
                if recursive && mask.intersects(EventMask::CREATE | EventMask::MOVED_TO) {
                    // A new folder: watch it, and report files that landed in it before the watch existed.
                    let mut found = Vec::new();
                    match self.add_dir(&path, true, &path, &mut found) {
                        Ok(()) => out.extend(found.into_iter().map(Event::File)),
                        Err(error) => self.errors.push((path, error.to_string())),
                    }
                }
            } else if mask.intersects(EventMask::CLOSE_WRITE | EventMask::MOVED_TO) {
                out.push(Event::File(path));
            }
        }
        Ok(out)
    }

    pub fn clear(&mut self) {
        let descriptors: Vec<WatchDescriptor> = self.dirs.keys().cloned().collect();
        for wd in descriptors {
            let _ = self.inotify.watches().remove(wd.clone());
            self.dirs.remove(&wd);
        }
    }
}

/// Waits until one of the descriptors has something to read, or the timeout passes.
pub fn wait_readable(fds: &[RawFd], timeout_ms: i32) {
    let mut pfds: Vec<libc::pollfd> = fds
        .iter()
        .map(|&fd| libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        })
        .collect();
    // A signal makes poll return early with an error, which is fine: the caller checks its stop flag.
    unsafe {
        libc::poll(pfds.as_mut_ptr(), pfds.len() as libc::nfds_t, timeout_ms);
    }
}
