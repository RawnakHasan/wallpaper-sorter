//! inotify: tells us when a file has been written or moved into a watched folder.
//! Only "finished writing" and "moved in" count; creating a file is not enough, because it is still empty.

use inotify::{EventMask, Inotify, WatchDescriptor, WatchMask};
use std::collections::HashMap;
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
}

struct Dir {
    path: PathBuf,
    recursive: bool,
}

pub struct DirWatcher {
    inotify: Inotify,
    dirs: HashMap<WatchDescriptor, Dir>,
}

fn file_mask() -> WatchMask {
    WatchMask::CLOSE_WRITE | WatchMask::MOVED_TO
}

impl DirWatcher {
    pub fn new() -> io::Result<DirWatcher> {
        Ok(DirWatcher { inotify: Inotify::init()?, dirs: HashMap::new() })
    }

    pub fn fd(&self) -> RawFd {
        self.inotify.as_raw_fd()
    }

    /// Starts watching `path` (and, if `recursive`, every folder below it, now and later).
    /// Returns the files that are already inside the folders it just started watching.
    pub fn add(&mut self, path: &Path, recursive: bool) -> io::Result<Vec<PathBuf>> {
        let mut found = Vec::new();
        self.add_dir(path, recursive, &mut found)?;
        Ok(found)
    }

    fn add_dir(&mut self, path: &Path, recursive: bool, found: &mut Vec<PathBuf>) -> io::Result<()> {
        let mask = if recursive { file_mask() | WatchMask::CREATE } else { file_mask() };
        let wd = self.inotify.watches().add(path, mask).map_err(|e| {
            io::Error::new(e.kind(), format!("cannot watch {}: {e} (is the inotify watch limit reached?)", path.display()))
        })?;
        self.dirs.insert(wd, Dir { path: path.to_path_buf(), recursive });
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() && recursive {
                self.add_dir(&entry.path(), true, found)?;
            } else if kind.is_file() {
                found.push(entry.path());
            }
        }
        Ok(())
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
                self.dirs.remove(&wd);
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
                    if self.add_dir(&path, true, &mut found).is_ok() {
                        out.extend(found.into_iter().map(Event::File));
                    }
                }
            } else if mask.intersects(EventMask::CLOSE_WRITE | EventMask::MOVED_TO) {
                out.push(Event::File(path));
            }
        }
        Ok(out)
    }
}

/// Waits until one of the descriptors has something to read, or the timeout passes.
pub fn wait_readable(fds: &[RawFd], timeout_ms: i32) {
    let mut pfds: Vec<libc::pollfd> = fds.iter().map(|&fd| libc::pollfd { fd, events: libc::POLLIN, revents: 0 }).collect();
    // A signal makes poll return early with an error, which is fine: the caller checks its stop flag.
    unsafe {
        libc::poll(pfds.as_mut_ptr(), pfds.len() as libc::nfds_t, timeout_ms);
    }
}
