//! The plan: a list of actions worked out from the config, a snapshot of the library and the files
//! that just arrived. Building a plan touches nothing on disk; the engine crate applies it.

use crate::config::Config;
use crate::matcher::{classify, Decision, Dest, Rule};
use crate::numbering::{parse_numbered, plan_new_file};
use std::collections::{BTreeMap, HashMap};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeaveReason {
    NoMatch,
    /// Tags from different folders clashed; the keywords that matched.
    Conflict(Vec<String>),
    /// Something stopped us from sorting it (for example two files share a number).
    Problem(String),
}

/// Paths in `from` of Move and ToDuplicates are where the file is now (as the watcher saw it);
/// every other path is relative to the library root and uses '/' as separator.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Move {
        from: String,
        to: String,
        rule: Rule,
        matched: Vec<String>,
    },
    Rename {
        from: String,
        to: String,
    },
    ToDuplicates {
        from: String,
        to: String,
        duplicate_of: String,
    },
    Leave {
        path: String,
        reason: LeaveReason,
    },
    Ignore {
        path: String,
    },
}

impl fmt::Display for Action {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Action::Move { from, to, .. } => write!(f, "move: {from} -> {to}"),
            Action::Rename { from, to } => write!(f, "rename: {from} -> {to}"),
            Action::ToDuplicates {
                from,
                to,
                duplicate_of,
            } => write!(f, "dup: {from} -> {to} (of {duplicate_of})"),
            Action::Leave { path, reason } => match reason {
                LeaveReason::NoMatch => write!(f, "leave: {path} (no match)"),
                LeaveReason::Conflict(tags) => {
                    write!(f, "leave: {path} (conflict: {})", tags.join(";"))
                }
                LeaveReason::Problem(p) => write!(f, "leave: {path} (problem: {p})"),
            },
            Action::Ignore { path } => write!(f, "ignore: {path}"),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Plan {
    pub actions: Vec<Action>,
}

impl Plan {
    pub fn describe(&self) -> Vec<String> {
        self.actions.iter().map(|a| a.to_string()).collect()
    }
}

/// What the library looks like right now.
#[derive(Debug, Clone, Default)]
pub struct Library {
    /// Folder (relative to the library root) -> file names inside it.
    pub folders: BTreeMap<String, Vec<String>>,
    /// Content hash -> where the file with that content is (library-relative, or the path of an unsorted file).
    pub hashes: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct Incoming {
    pub path: String,
    /// Exact library-relative path when this file is inside the library.
    pub library_path: Option<String>,
    /// Content hash, if known. Without it the file cannot be recognised as a duplicate.
    pub hash: Option<String>,
}

fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// `name` if it is free, otherwise "stem (2).ext", "stem (3).ext" and so on.
pub fn unique_name(existing: &[String], name: &str) -> String {
    if !existing.iter().any(|e| e == name) {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|candidate| !existing.iter().any(|e| e == candidate))
        .expect("an unused name exists")
}

#[derive(Debug, Clone, Default)]
pub struct PlanOptions {
    /// Put every image in this folder instead of looking at its name (the user picked the folder).
    pub forced_dest: Option<String>,
    /// Restore explicitly selected duplicates as separate new library images.
    pub skip_duplicate_check: bool,
}

/// Work out what to do with the files that just arrived, in the order given.
pub fn build_plan(cfg: &Config, library: &Library, incoming: &[Incoming]) -> Plan {
    build_plan_with(cfg, library, incoming, &PlanOptions::default())
}

pub fn build_plan_with(
    cfg: &Config,
    library: &Library,
    incoming: &[Incoming],
    opts: &PlanOptions,
) -> Plan {
    let mut folders = library.folders.clone();
    let mut hashes = library.hashes.clone();
    let dup_folder = cfg.settings.duplicates_folder.clone();
    let mut actions = Vec::new();

    // Re-sort inputs inside the library reserve their own numbered destination before any
    // duplicate matching. This lets a later loose copy identify the numbered file as original.
    for inc in incoming {
        let name = file_name(&inc.path);
        let Some(library_path) = inc.library_path.as_deref() else {
            continue;
        };
        let decision = classify(name, cfg);
        let Dest::Folder(dest) = &decision.dest else {
            continue;
        };
        let prefix = cfg.prefix_for(dest);
        if library_path == format!("{dest}/{name}")
            && parse_numbered(name, &prefix, &cfg.settings.image_extensions).is_some()
        {
            if let Some(hash) = &inc.hash {
                hashes.insert(hash.clone(), library_path.to_string());
            }
        }
    }

    for inc in incoming {
        let name = file_name(&inc.path);
        let decision = classify(name, cfg);
        let exact_library_path = inc.library_path.as_deref().unwrap_or(&inc.path);
        if decision.dest == Dest::Ignore {
            actions.push(Action::Ignore {
                path: inc.path.clone(),
            });
            continue;
        }

        // Duplicates are checked before matching: a copy of anything we already hold goes to Duplicates.
        if !opts.skip_duplicate_check {
            if let Some(original) = inc.hash.as_ref().and_then(|h| hashes.get(h)).cloned() {
                if exact_library_path != original {
                    let in_dups = folders.entry(dup_folder.clone()).or_default();
                    let unique = unique_name(in_dups, name);
                    in_dups.push(unique.clone());
                    actions.push(Action::ToDuplicates {
                        from: inc.path.clone(),
                        to: format!("{dup_folder}/{unique}"),
                        duplicate_of: original,
                    });
                    continue;
                }
            }
        }

        let decision = match &opts.forced_dest {
            Some(f) => Decision {
                dest: Dest::Folder(f.clone()),
                rule: Rule::Assigned,
                matched: vec![],
                ignored: String::new(),
            },
            None => decision,
        };

        match decision.dest {
            Dest::Ignore => unreachable!("handled above"),
            Dest::Inbox => {
                if let Some(h) = &inc.hash {
                    hashes.insert(h.clone(), inc.path.clone());
                }
                let reason = if decision.rule == Rule::Conflict {
                    LeaveReason::Conflict(decision.matched.clone())
                } else {
                    LeaveReason::NoMatch
                };
                actions.push(Action::Leave {
                    path: inc.path.clone(),
                    reason,
                });
            }
            Dest::Folder(dest) => {
                // Extension exactly as saved (classify already checked that there is one).
                let ext = name.rsplit('.').next().unwrap_or("");
                let prefix = cfg.prefix_for(&dest);
                let files = folders.entry(dest.clone()).or_default();
                let destination = format!("{dest}/{name}");
                // Re-sort includes files that are already in the library.  A file which is
                // already in its destination and already has this folder's numbered name is
                // a reserved number, not an arrival: leave it in `files` and do not plan a
                // move.  The path suffix also covers the absolute paths supplied by engine.
                if exact_library_path == destination
                    && files.iter().any(|file| file == name)
                    && parse_numbered(name, &prefix, &cfg.settings.image_extensions).is_some()
                {
                    actions.push(Action::Ignore {
                        path: inc.path.clone(),
                    });
                    continue;
                }
                match plan_new_file(
                    files,
                    &prefix,
                    ext,
                    cfg.settings.gap_mode,
                    &cfg.settings.image_extensions,
                ) {
                    Ok(p) => {
                        for r in &p.renames {
                            let (old, new) =
                                (format!("{dest}/{}", r.from), format!("{dest}/{}", r.to));
                            for v in hashes.values_mut() {
                                if *v == old {
                                    *v = new.clone();
                                }
                            }
                            if let Some(f) = files.iter_mut().find(|f| **f == r.from) {
                                *f = r.to.clone();
                            }
                            actions.push(Action::Rename { from: old, to: new });
                        }
                        files.push(p.name.clone());
                        let to = format!("{dest}/{}", p.name);
                        if let Some(h) = &inc.hash {
                            hashes.insert(h.clone(), to.clone());
                        }
                        actions.push(Action::Move {
                            from: inc.path.clone(),
                            to,
                            rule: decision.rule,
                            matched: decision.matched.clone(),
                        });
                    }
                    Err(e) => actions.push(Action::Leave {
                        path: inc.path.clone(),
                        reason: LeaveReason::Problem(format!("{dest}: {e}")),
                    }),
                }
            }
        }
    }
    Plan { actions }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_names() {
        let existing = vec!["a.png".to_string(), "a (2).png".to_string()];
        assert_eq!(unique_name(&existing, "b.png"), "b.png");
        assert_eq!(unique_name(&existing, "a.png"), "a (3).png");
        assert_eq!(unique_name(&["noext".to_string()], "noext"), "noext (2)");
    }
}
