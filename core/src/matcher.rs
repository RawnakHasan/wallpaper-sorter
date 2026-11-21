//! The matching rules, agreed in the design notes and mirrored by spec/ref_matcher.py.

use crate::config::{Config, MatchMode, Tag};
use serde::Serialize;
use std::collections::BTreeSet;

const STOP: [&str; 11] = [
    "and",
    "more",
    "by",
    "drawn",
    "full",
    "com",
    "konachan",
    "yande",
    "re",
    "wallhaven",
    "original",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Dest {
    /// Sort into this folder (relative to the library).
    Folder(String),
    /// Leave it for the user (no match, or a conflict).
    Inbox,
    /// Not an image: do nothing.
    Ignore,
}

impl Dest {
    pub fn label(&self) -> String {
        match self {
            Dest::Folder(f) => f.clone(),
            Dest::Inbox => "INBOX".to_string(),
            Dest::Ignore => "IGNORE".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    OneFolder,
    DeepestWins,
    SpecificBeatsGeneric,
    SharedParent,
    Conflict,
    NoMatch,
    NotAnImage,
    /// The user chose the folder.
    Assigned,
    /// The user deleted it (moved to the trash folder).
    Deleted,
}

impl Rule {
    pub fn label(self) -> &'static str {
        match self {
            Rule::OneFolder => "One folder",
            Rule::DeepestWins => "Deepest folder wins",
            Rule::SpecificBeatsGeneric => "Specific beats generic",
            Rule::SharedParent => "Shared parent",
            Rule::Conflict => "Conflict",
            Rule::NoMatch => "No match",
            Rule::NotAnImage => "Not an image",
            Rule::Assigned => "Assigned",
            Rule::Deleted => "Deleted",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub dest: Dest,
    pub rule: Rule,
    /// The keyword that matched for each tag that took part.
    pub matched: Vec<String>,
    /// Deepest unrelated folders that matched, with the phrases that triggered them.
    pub candidates: Vec<MatchCandidate>,
    /// Why a generic tag was ignored, if it was (for display only).
    pub ignored: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MatchCandidate {
    pub folder: String,
    pub matched: Vec<String>,
}

fn decision(dest: Dest, rule: Rule, matched: Vec<String>, ignored: String) -> Decision {
    decision_with_candidates(dest, rule, matched, ignored, Vec::new())
}

fn decision_with_candidates(
    dest: Dest,
    rule: Rule,
    matched: Vec<String>,
    ignored: String,
    candidates: Vec<MatchCandidate>,
) -> Decision {
    Decision {
        dest,
        rule,
        matched,
        candidates,
        ignored,
    }
}

fn flush_hex(run: &mut String, out: &mut String) {
    if run.chars().count() >= 16 {
        out.push(' ');
    } else {
        out.push_str(run);
    }
    run.clear();
}

/// Words of a string: long hex runs dropped, camelCase split, lowercased,
/// then runs of letters and runs of digits become separate words.
pub fn words(s: &str) -> Vec<String> {
    let mut cleaned = String::with_capacity(s.len());
    let mut run = String::new();
    for ch in s.chars() {
        if ch.is_ascii_hexdigit() {
            run.push(ch);
        } else {
            flush_hex(&mut run, &mut cleaned);
            cleaned.push(ch);
        }
    }
    flush_hex(&mut run, &mut cleaned);

    let chars: Vec<char> = cleaned.chars().collect();
    let mut spaced = String::with_capacity(cleaned.len() + 8);
    for (i, &c) in chars.iter().enumerate() {
        spaced.push(c);
        if c.is_ascii_lowercase() && chars.get(i + 1).map_or(false, |n| n.is_ascii_uppercase()) {
            spaced.push(' ');
        }
    }

    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_is_digit = false;
    for ch in spaced.chars().flat_map(|c| c.to_lowercase()) {
        let letter = ch.is_ascii_lowercase();
        let digit = ch.is_ascii_digit();
        if !letter && !digit {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        if !cur.is_empty() && cur_is_digit != digit {
            out.push(std::mem::take(&mut cur));
        }
        cur_is_digit = digit;
        cur.push(ch);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Splits a path or filename into (stem, lowercase extension). The extension is the part
/// after the last dot when it is 2 to 4 letters or digits; otherwise there is none.
pub fn split_name(filename: &str) -> (&str, String) {
    let base = filename.rsplit('/').next().unwrap_or(filename);
    if let Some(dot) = base.rfind('.') {
        let ext = &base[dot + 1..];
        if (2..=4).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            return (&base[..dot], ext.to_ascii_lowercase());
        }
    }
    (base, String::new())
}

/// The words of a filename stem after removing site noise.
pub fn tokens(stem: &str) -> Vec<String> {
    let mut s = stem;
    // Wallhaven ids carry no words.
    if let (Some(head), Some(id)) = (s.get(..10), s.get(10..16)) {
        if head.eq_ignore_ascii_case("wallhaven-") && id.chars().all(|c| c.is_ascii_alphanumeric())
        {
            s = &s[16..];
        }
    }
    // Danbooru: everything from "drawn_by_" on is the artist and a hash.
    let lower = s.to_ascii_lowercase();
    if let Some(idx) = lower.find("drawn_by_") {
        let cut = if idx > 0 && s.as_bytes()[idx - 1] == b'_' {
            idx - 1
        } else {
            idx
        };
        s = &s[..cut];
    }
    words(s)
        .into_iter()
        .filter(|w| {
            !(w.len() >= 5 && w.chars().all(|c| c.is_ascii_digit())) && !STOP.contains(&w.as_str())
        })
        .collect()
}

fn hit(tk: &[String], keyword: &str, mode: MatchMode) -> bool {
    let k = words(keyword);
    if k.is_empty() {
        return false;
    }
    match mode {
        MatchMode::Substring => {
            if k.len() == 1 {
                tk.iter().any(|t| t.contains(k[0].as_str()))
            } else {
                tk.join(" ").contains(&k.join(" "))
            }
        }
        MatchMode::Word => tk.len() >= k.len() && tk.windows(k.len()).any(|w| w == k.as_slice()),
    }
}

/// Decide what to do with one filename.
pub fn classify(filename: &str, cfg: &Config) -> Decision {
    classify_with_hints(filename, cfg, &[])
}

/// Decide what to do with a filename and metadata hint phrases. Hints participate in tag
/// matching, but the generic-tag word limit is based only on filename words.
pub fn classify_with_hints(filename: &str, cfg: &Config, hints: &[String]) -> Decision {
    let (stem, ext) = split_name(filename);
    if !cfg
        .settings
        .image_extensions
        .iter()
        .any(|e| e.eq_ignore_ascii_case(&ext))
    {
        return decision(Dest::Ignore, Rule::NotAnImage, vec![], String::new());
    }
    let tk = tokens(stem);
    let hint_tokens: Vec<Vec<String>> = hints.iter().map(|hint| words(hint)).collect();
    let hits = |input: &[String], keyword: &str, mode: MatchMode| {
        hit(input, keyword, mode) || hint_tokens.iter().any(|words| hit(words, keyword, mode))
    };

    let mut specific: Vec<(&Tag, String)> = Vec::new();
    let mut generic: Vec<(&Tag, String)> = Vec::new();
    for t in &cfg.tags {
        let kw = match t.keywords.iter().find(|kw| hits(&tk, kw, t.match_mode)) {
            Some(kw) => kw.clone(),
            None => continue,
        };
        if !t.strict_words.is_empty()
            && !t.strict_words.iter().any(|w| hits(&tk, w, MatchMode::Word))
        {
            continue;
        }
        if t.generic {
            generic.push((t, kw));
        } else {
            specific.push((t, kw));
        }
    }

    let join = |v: &[(&Tag, String)]| {
        v.iter()
            .map(|(_, k)| k.as_str())
            .collect::<Vec<_>>()
            .join(";")
    };
    let max_words = cfg.settings.generic_max_words;
    let mut ignored = String::new();
    let base: Vec<(&Tag, String)> = if !specific.is_empty() {
        if !generic.is_empty() {
            ignored = format!("generic ignored: {}", join(&generic));
        }
        specific
    } else if !generic.is_empty() && tk.len() <= max_words {
        generic
    } else if !generic.is_empty() {
        let note = format!(
            "generic ignored ({} words, limit {}): {}",
            tk.len(),
            max_words,
            join(&generic)
        );
        return decision(Dest::Inbox, Rule::NoMatch, vec![], note);
    } else {
        return decision(Dest::Inbox, Rule::NoMatch, vec![], String::new());
    };

    let names: Vec<String> = base.iter().map(|(_, k)| k.clone()).collect();
    let dests: BTreeSet<&str> = base.iter().map(|(t, _)| t.dest.as_str()).collect();
    let depth = |d: &str| d.split('/').count();
    let mx = dests.iter().map(|d| depth(d)).max().unwrap_or(0);
    let top: Vec<&str> = dests.iter().copied().filter(|d| depth(d) == mx).collect();

    if top.len() == 1 {
        let rule = if dests.len() > 1 {
            Rule::DeepestWins
        } else if !ignored.is_empty() {
            Rule::SpecificBeatsGeneric
        } else {
            Rule::OneFolder
        };
        return decision(Dest::Folder(top[0].to_string()), rule, names, ignored);
    }

    let parts: Vec<Vec<&str>> = top.iter().map(|d| d.split('/').collect()).collect();
    let mut common: Vec<&str> = Vec::new();
    for i in 0..mx {
        let first = parts[0][i];
        if parts.iter().all(|p| p[i] == first) {
            common.push(first);
        } else {
            break;
        }
    }
    if common.is_empty() {
        let candidates = top
            .iter()
            .map(|folder| MatchCandidate {
                folder: (*folder).to_string(),
                matched: base
                    .iter()
                    .filter(|(tag, _)| tag.dest == *folder)
                    .map(|(_, keyword)| keyword.clone())
                    .collect(),
            })
            .collect();
        decision_with_candidates(Dest::Inbox, Rule::Conflict, names, ignored, candidates)
    } else {
        decision(
            Dest::Folder(common.join("/")),
            Rule::SharedParent,
            names,
            ignored,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_split_digits_and_camel_case() {
        assert_eq!(words("Chisa1"), ["chisa", "1"]);
        assert_eq!(words("ChisaWallpaper"), ["chisa", "wallpaper"]);
        assert_eq!(
            words("sparkle_(honkai:_star_rail)"),
            ["sparkle", "honkai", "star", "rail"]
        );
    }

    #[test]
    fn long_hex_runs_are_dropped() {
        assert!(words("1b3006020fef5585363280d7d5722beecb199e58").is_empty());
    }

    #[test]
    fn extension_rules() {
        assert_eq!(
            split_name("a/b/Chisa 1.PNG"),
            ("Chisa 1", "png".to_string())
        );
        assert_eq!(split_name("x.png.part"), ("x.png", "part".to_string()));
        assert_eq!(split_name("noext").1, "");
    }

    #[test]
    fn danbooru_artist_is_cut() {
        let t =
            tokens("__robin_honkai_and_1_more_drawn_by_chisa__66b60ada665db2ba13e3aec46e6b756a");
        assert_eq!(t, ["robin", "honkai", "1"]);
    }
}
