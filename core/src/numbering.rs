//! File numbering: "<Prefix> <number>.<extension>", the next number for a folder,
//! and the optional gap-filling modes. Pure logic: it works on lists of file names.

use serde::Deserialize;
use std::collections::BTreeSet;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, serde::Serialize)]
pub enum GapMode {
    /// Next number is the highest plus one; gaps stay (default).
    #[default]
    #[serde(rename = "keep")]
    Keep,
    /// The next file takes the lowest free number; nothing is renamed.
    #[serde(rename = "lowest")]
    LowestFree,
    /// The highest-numbered files are renamed into the gaps, then the next file is highest plus one.
    #[serde(rename = "last")]
    LastIntoGap,
    /// Everything is renumbered 1 to N, then the next file is N plus one.
    #[serde(rename = "renumber")]
    Renumber,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rename {
    pub from: String,
    pub to: String,
}

/// Renames to perform (in this order, which never overwrites a file) and the name for the new file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewFilePlan {
    pub renames: Vec<Rename>,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NumberingError {
    /// Two files share this number (for example "Chisa 1.jpg" and "Chisa 1.png"); fix that first.
    DuplicateNumber(u64),
}

impl fmt::Display for NumberingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            NumberingError::DuplicateNumber(n) => write!(f, "duplicate number {n}"),
        }
    }
}

impl std::error::Error for NumberingError {}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Numbered {
    name: String,
    n: u64,
    ext: String,
}

pub fn format_name(prefix: &str, n: u64, ext: &str) -> String {
    format!("{prefix} {n}.{ext}")
}

/// Number and extension of "<prefix> <digits>.<ext>", or None if the name does not follow the pattern.
/// The prefix is matched ignoring ASCII case, leading zeros are accepted, and the extension must be
/// one of the image extensions.
pub fn parse_numbered(file_name: &str, prefix: &str, exts: &[String]) -> Option<(u64, String)> {
    let lower = file_name.to_ascii_lowercase();
    let after_prefix = lower.strip_prefix(prefix.to_ascii_lowercase().as_str())?;
    let rest_lower = after_prefix.strip_prefix(' ')?;
    let rest = &file_name[file_name.len() - rest_lower.len()..];
    let (num, ext) = rest.rsplit_once('.')?;
    if num.is_empty() || !num.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if !exts.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
        return None;
    }
    Some((num.parse().ok()?, ext.to_string()))
}

fn numbered_files(existing: &[String], prefix: &str, exts: &[String]) -> Vec<Numbered> {
    existing
        .iter()
        .filter_map(|name| {
            parse_numbered(name, prefix, exts).map(|(n, ext)| Numbered { name: name.clone(), n, ext })
        })
        .collect()
}

fn used_numbers(files: &[Numbered]) -> BTreeSet<u64> {
    files.iter().map(|f| f.n).collect()
}

/// Missing numbers between 1 and the highest number.
pub fn gaps(existing: &[String], prefix: &str, exts: &[String]) -> Vec<u64> {
    let used = used_numbers(&numbered_files(existing, prefix, exts));
    let max = used.iter().next_back().copied().unwrap_or(0);
    (1..=max).filter(|n| !used.contains(n)).collect()
}

/// Highest number plus one (1 for an empty folder).
pub fn next_number(existing: &[String], prefix: &str, exts: &[String]) -> u64 {
    numbered_files(existing, prefix, exts).iter().map(|f| f.n).max().unwrap_or(0) + 1
}

fn lowest_free(files: &[Numbered]) -> u64 {
    let used = used_numbers(files);
    (1..).find(|n| !used.contains(n)).unwrap_or(1)
}

fn fill_last_into_gaps(files: &mut [Numbered], prefix: &str) -> Vec<Rename> {
    let mut out = Vec::new();
    loop {
        let used = used_numbers(files);
        let max = match used.iter().next_back() {
            Some(&m) => m,
            None => break,
        };
        let gap = match (1..=max).find(|n| !used.contains(n)) {
            Some(g) => g,
            None => break,
        };
        let idx = files
            .iter()
            .enumerate()
            .max_by(|a, b| (a.1.n, &a.1.name).cmp(&(b.1.n, &b.1.name)))
            .map(|(i, _)| i)
            .expect("files is not empty here");
        let to = format_name(prefix, gap, &files[idx].ext);
        out.push(Rename { from: files[idx].name.clone(), to: to.clone() });
        files[idx].n = gap;
        files[idx].name = to;
    }
    out
}

fn renumber_all(files: &mut [Numbered], prefix: &str) -> Result<Vec<Rename>, NumberingError> {
    let mut seen = BTreeSet::new();
    for f in files.iter() {
        if !seen.insert(f.n) {
            return Err(NumberingError::DuplicateNumber(f.n));
        }
    }
    files.sort_by_key(|f| f.n);
    let mut out = Vec::new();
    for (i, f) in files.iter_mut().enumerate() {
        let n = (i + 1) as u64;
        let to = format_name(prefix, n, &f.ext);
        if to != f.name {
            out.push(Rename { from: f.name.clone(), to: to.clone() });
        }
        f.n = n;
        f.name = to;
    }
    Ok(out)
}

/// The renames that close the gaps in a folder (modes LastIntoGap and Renumber; the other modes rename nothing).
/// Applied in the order given, they never overwrite a file.
pub fn plan_gap_fill(
    existing: &[String],
    prefix: &str,
    exts: &[String],
    mode: GapMode,
) -> Result<Vec<Rename>, NumberingError> {
    let mut files = numbered_files(existing, prefix, exts);
    match mode {
        GapMode::LastIntoGap => Ok(fill_last_into_gaps(&mut files, prefix)),
        GapMode::Renumber => renumber_all(&mut files, prefix),
        GapMode::Keep | GapMode::LowestFree => Ok(Vec::new()),
    }
}

/// What to do when a new file with extension `ext` arrives in a folder that holds `existing` file names.
pub fn plan_new_file(
    existing: &[String],
    prefix: &str,
    ext: &str,
    mode: GapMode,
    exts: &[String],
) -> Result<NewFilePlan, NumberingError> {
    let mut files = numbered_files(existing, prefix, exts);
    let renames = match mode {
        GapMode::Keep | GapMode::LowestFree => Vec::new(),
        GapMode::LastIntoGap => fill_last_into_gaps(&mut files, prefix),
        GapMode::Renumber => renumber_all(&mut files, prefix)?,
    };
    let n = match mode {
        GapMode::LowestFree => lowest_free(&files),
        _ => files.iter().map(|f| f.n).max().unwrap_or(0) + 1,
    };
    Ok(NewFilePlan { renames, name: format_name(prefix, n, ext) })
}
