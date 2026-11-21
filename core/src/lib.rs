//! Pure logic for Wallpaper Sorter. Nothing in this crate touches the file system:
//! it turns a filename and a config into a decision, so it can be tested with plain data.

pub mod config;
pub mod matcher;
pub mod numbering;
pub mod origin;
pub mod paths;
pub mod plan;

pub use config::{
    Config, Folder, Intake, MatchMode, ServerCfg, Settings, Tag, WALLPAPER_PATH_ARGUMENT,
};
pub use matcher::{classify, classify_with_hints, Decision, Dest, MatchCandidate, Rule};
pub use numbering::{plan_gap_fill, plan_new_file, GapMode, NewFilePlan, NumberingError, Rename};
pub use origin::{parse_source, url_for, Site, Source};
pub use paths::expand_home;
pub use plan::{
    build_plan, build_plan_with, unique_name, Action, Incoming, LeaveReason, Library, Plan,
    PlanOptions,
};
