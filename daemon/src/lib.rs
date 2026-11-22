//! The folder watcher and the run loop around `sorter-engine`'s pipeline.

pub mod daemon;
pub mod debounce;
mod fetch;
pub mod git;
mod secrets;
pub mod thumbs;
pub mod watcher;
pub mod web;

pub use daemon::{describe, Daemon, Notice, Options, Shared};
pub use debounce::Debouncer;
pub use thumbs::Thumbs;
pub use web::{serve, WebServer};
