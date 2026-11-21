//! The part of Wallpaper Sorter that touches the disk: scanning the library, applying a plan,
//! the append-only log, and undo. All decisions are made by `sorter-core`; this crate only does them.

pub mod cfgedit;
pub mod exec;
pub mod index;
pub mod log;
pub mod ops;
pub mod origins;
pub mod pipeline;
pub mod scan;
pub mod undo;
mod util;

pub use util::{unix_now, write_atomic};

pub use exec::{apply, move_no_replace, ExecError, Report};
pub use index::{file_stat, hash_file, rel_inside, Index, IndexEntry, RefreshStats};
pub use log::{Entry, Kind, Log};
pub use ops::{DuplicateItem, FolderInfo, ImageInfo, InboxItem};
pub use origins::{Origin, OriginStore};
pub use pipeline::{Outcome, Pipeline};
pub use scan::library_snapshot;
pub use undo::{undo_batch, undo_entry, UndoError};
