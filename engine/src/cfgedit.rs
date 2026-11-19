//! Editing the config file's tags without disturbing the rest of it (comments and layout stay).

use serde::Deserialize;
use sorter_core::MatchMode;
use toml_edit::{value, Array, ArrayOfTables, DocumentMut, Item, Table};

#[derive(Debug, Clone, Deserialize)]
pub struct TagSpec {
    pub keywords: Vec<String>,
    pub dest: String,
    #[serde(default)]
    pub prefix: Option<String>,
    #[serde(default, rename = "match")]
    pub match_mode: MatchMode,
    #[serde(default)]
    pub strict_words: Vec<String>,
    #[serde(default)]
    pub generic: bool,
}

fn validate(spec: &TagSpec) -> Result<(), String> {
    if spec.keywords.iter().all(|k| k.trim().is_empty()) {
        return Err("a tag needs at least one keyword".to_string());
    }
    crate::ops::check_folder(&spec.dest).map_err(|e| e.to_string())
}

fn str_array(items: &[String]) -> Array {
    items
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect()
}

fn fill(table: &mut Table, spec: &TagSpec) {
    table["keywords"] = value(str_array(&spec.keywords));
    table["dest"] = value(spec.dest.clone());
    match spec
        .prefix
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(p) => table["prefix"] = value(p),
        None => {
            table.remove("prefix");
        }
    }
    if spec.match_mode == MatchMode::Substring {
        table["match"] = value("substring");
    } else {
        table.remove("match");
    }
    if spec.strict_words.iter().any(|w| !w.trim().is_empty()) {
        table["strict_words"] = value(str_array(&spec.strict_words));
    } else {
        table.remove("strict_words");
    }
    if spec.generic {
        table["generic"] = value(true);
    } else {
        table.remove("generic");
    }
}

fn parse(text: &str) -> Result<DocumentMut, String> {
    text.parse::<DocumentMut>().map_err(|e| e.to_string())
}

fn tags_mut(doc: &mut DocumentMut) -> Result<&mut ArrayOfTables, String> {
    if doc.get("tag").is_none() {
        doc["tag"] = Item::ArrayOfTables(ArrayOfTables::new());
    }
    doc["tag"]
        .as_array_of_tables_mut()
        .ok_or_else(|| "`tag` in the config is not a list of [[tag]] tables".to_string())
}

fn folders_mut(doc: &mut DocumentMut) -> Result<&mut ArrayOfTables, String> {
    if doc.get("folder").is_none() {
        doc["folder"] = Item::ArrayOfTables(ArrayOfTables::new());
    }
    doc["folder"]
        .as_array_of_tables_mut()
        .ok_or_else(|| "`folder` in the config is not a list of [[folder]] tables".to_string())
}

fn valid_prefix(prefix: &str) -> Result<String, String> {
    let prefix = prefix.trim();
    if prefix.is_empty() {
        return Err("prefix cannot be empty".to_string());
    }
    if prefix.contains('/') || prefix.contains('\\') {
        return Err("prefix cannot contain a slash".to_string());
    }
    Ok(prefix.to_string())
}

fn set_folder_table(table: &mut Table, path: &str, prefix: Option<&str>) {
    table["path"] = value(path);
    match prefix {
        Some(prefix) => table["prefix"] = value(prefix),
        None => {
            table.remove("prefix");
        }
    }
}

/// Adds an explicit folder entry when it is not already present. Empty folders need this entry
/// only when they have a custom prefix; callers may still use it to make intent visible in config.
pub fn add_folder(text: &str, path: &str, prefix: Option<&str>) -> Result<String, String> {
    crate::ops::check_folder(path).map_err(|e| e.to_string())?;
    let prefix = prefix.map(valid_prefix).transpose()?;
    let mut doc = parse(text)?;
    let folders = folders_mut(&mut doc)?;
    if folders
        .iter()
        .any(|f| f.get("path").and_then(Item::as_str) == Some(path))
    {
        return Err(format!("folder {path} is already configured"));
    }
    let mut folder = Table::new();
    set_folder_table(&mut folder, path, prefix.as_deref());
    folders.push(folder);
    Ok(doc.to_string())
}

/// Sets (or creates) the stable numbering prefix for a folder.
pub fn set_folder_prefix(text: &str, path: &str, prefix: &str) -> Result<String, String> {
    crate::ops::check_folder(path).map_err(|e| e.to_string())?;
    let prefix = valid_prefix(prefix)?;
    let mut doc = parse(text)?;
    let folders = folders_mut(&mut doc)?;
    let index = {
        folders
            .iter()
            .position(|f| f.get("path").and_then(Item::as_str) == Some(path))
    };
    if let Some(index) = index {
        set_folder_table(
            folders.get_mut(index).expect("folder index exists"),
            path,
            Some(&prefix),
        );
    } else {
        let mut folder = Table::new();
        set_folder_table(&mut folder, path, Some(&prefix));
        folders.push(folder);
    }
    Ok(doc.to_string())
}

fn descendant(path: &str, parent: &str) -> Option<String> {
    if path == parent {
        Some(String::new())
    } else {
        path.strip_prefix(&(parent.to_string() + "/"))
            .map(str::to_string)
    }
}

/// Moves tag and folder settings with a renamed folder, including all of its children. `prefix_pins`
/// are computed by the caller from the old, on-disk folder tree; keeping that filesystem inspection
/// out of this text editor makes the edit deterministic and preserves comments and layout.
pub fn rename_folder(
    text: &str,
    from: &str,
    to: &str,
    prefix_pins: &[(String, String)],
) -> Result<String, String> {
    crate::ops::check_folder(from).map_err(|e| e.to_string())?;
    crate::ops::check_folder(to).map_err(|e| e.to_string())?;
    if from == to {
        return Err("the new folder name is unchanged".to_string());
    }
    let mut doc = parse(text)?;
    for tag in tags_mut(&mut doc)?.iter_mut() {
        let Some(dest) = tag.get("dest").and_then(Item::as_str) else {
            continue;
        };
        if let Some(rest) = descendant(dest, from) {
            tag["dest"] = value(if rest.is_empty() {
                to.to_string()
            } else {
                format!("{to}/{rest}")
            });
        }
    }
    let folders = folders_mut(&mut doc)?;
    for folder in folders.iter_mut() {
        let Some(path) = folder.get("path").and_then(Item::as_str) else {
            continue;
        };
        if let Some(rest) = descendant(path, from) {
            folder["path"] = value(if rest.is_empty() {
                to.to_string()
            } else {
                format!("{to}/{rest}")
            });
        }
    }
    for (path, prefix) in prefix_pins {
        let index = folders
            .iter_mut()
            .position(|folder| folder.get("path").and_then(Item::as_str) == Some(path));
        if let Some(index) = index {
            set_folder_table(
                folders.get_mut(index).expect("folder index exists"),
                path,
                Some(prefix),
            );
        } else {
            let mut folder = Table::new();
            set_folder_table(&mut folder, path, Some(prefix));
            folders.push(folder);
        }
    }
    Ok(doc.to_string())
}

/// Points every tag and folder setting under `from` at `to`, because a merge flattens its files
/// into the destination folder.
pub fn merge_folder(text: &str, from: &str, to: &str) -> Result<String, String> {
    crate::ops::check_folder(from).map_err(|e| e.to_string())?;
    crate::ops::check_folder(to).map_err(|e| e.to_string())?;
    if from == to {
        return Err("source and destination folders are the same".to_string());
    }
    let mut doc = parse(text)?;
    for tag in tags_mut(&mut doc)?.iter_mut() {
        if tag
            .get("dest")
            .and_then(Item::as_str)
            .and_then(|path| descendant(path, from))
            .is_some()
        {
            tag["dest"] = value(to);
        }
    }
    let folders = folders_mut(&mut doc)?;
    let remove: Vec<usize> = folders
        .iter()
        .enumerate()
        .filter_map(|(i, f)| {
            f.get("path")
                .and_then(Item::as_str)
                .and_then(|path| descendant(path, from))
                .map(|_| i)
        })
        .collect();
    for i in remove.into_iter().rev() {
        folders.remove(i);
    }
    Ok(doc.to_string())
}

pub fn add_tag(text: &str, spec: &TagSpec) -> Result<String, String> {
    validate(spec)?;
    let mut doc = parse(text)?;
    let mut t = Table::new();
    fill(&mut t, spec);
    tags_mut(&mut doc)?.push(t);
    Ok(doc.to_string())
}

pub fn update_tag(text: &str, index: usize, spec: &TagSpec) -> Result<String, String> {
    validate(spec)?;
    let mut doc = parse(text)?;
    let tags = tags_mut(&mut doc)?;
    let t = tags
        .get_mut(index)
        .ok_or_else(|| format!("no tag number {index}"))?;
    fill(t, spec);
    Ok(doc.to_string())
}

pub fn delete_tag(text: &str, index: usize) -> Result<String, String> {
    let mut doc = parse(text)?;
    let tags = tags_mut(&mut doc)?;
    if index >= tags.len() {
        return Err(format!("no tag number {index}"));
    }
    tags.remove(index);
    Ok(doc.to_string())
}

/// Sets `[settings] gap_mode`.
pub fn set_gap_mode(text: &str, mode: &str) -> Result<String, String> {
    if !["keep", "lowest", "last", "renumber"].contains(&mode) {
        return Err(format!("unknown gap mode {mode}"));
    }
    let mut doc = parse(text)?;
    if doc.get("settings").is_none() {
        doc["settings"] = Item::Table(Table::new());
    }
    doc["settings"]["gap_mode"] = value(mode);
    Ok(doc.to_string())
}

pub fn undo_rename_folder(
    text: &str,
    before: &str,
    after: &str,
    from: &str,
    to: &str,
) -> Result<String, String> {
    let before_doc = parse(before)?;
    let after_doc = parse(after)?;
    let mut doc = parse(text)?;

    let before_folders = before_doc
        .get("folder")
        .and_then(Item::as_array_of_tables)
        .cloned();
    let after_folders = after_doc
        .get("folder")
        .and_then(Item::as_array_of_tables)
        .cloned();
    if let (Some(before_folders), Some(after_folders)) = (before_folders, after_folders) {
        let changed: Vec<String> = after_folders
            .iter()
            .enumerate()
            .filter_map(|(i, folder)| {
                let path = folder.get("path")?.as_str()?;
                let old_path = before_folders.get(i)?.get("path")?.as_str()?;
                (old_path == from || old_path.starts_with(&(from.to_string() + "/")))
                    .then_some(path.to_string())
            })
            .collect();
        if let Ok(folders) = folders_mut(&mut doc) {
            for path in changed {
                if let Some(folder) = folders
                    .iter_mut()
                    .find(|folder| folder.get("path").and_then(Item::as_str) == Some(path.as_str()))
                {
                    let rest = path.strip_prefix(to).unwrap_or("");
                    let old = if rest.is_empty() {
                        from.to_string()
                    } else {
                        format!("{from}/{}", rest.trim_start_matches('/'))
                    };
                    folder["path"] = value(old);
                }
            }
        }
    }

    let before_tags = before_doc
        .get("tag")
        .and_then(Item::as_array_of_tables)
        .cloned();
    let after_tags = after_doc
        .get("tag")
        .and_then(Item::as_array_of_tables)
        .cloned();
    if let (Some(before_tags), Some(after_tags)) = (before_tags, after_tags) {
        let changed: Vec<String> = after_tags
            .iter()
            .enumerate()
            .filter_map(|(i, tag)| {
                let dest = tag.get("dest")?.as_str()?;
                let old_dest = before_tags.get(i)?.get("dest")?.as_str()?;
                (old_dest == from || old_dest.starts_with(&(from.to_string() + "/")))
                    .then_some(dest.to_string())
            })
            .collect();
        if let Ok(tags) = tags_mut(&mut doc) {
            for dest in changed {
                if let Some(tag) = tags
                    .iter_mut()
                    .find(|tag| tag.get("dest").and_then(Item::as_str) == Some(dest.as_str()))
                {
                    let rest = dest.strip_prefix(to).unwrap_or("");
                    let old = if rest.is_empty() {
                        from.to_string()
                    } else {
                        format!("{from}/{}", rest.trim_start_matches('/'))
                    };
                    tag["dest"] = value(old);
                }
            }
        }
    }

    Ok(doc.to_string())
}

pub fn undo_merge_folder(
    text: &str,
    before: &str,
    after: &str,
    from: &str,
    to: &str,
) -> Result<String, String> {
    let before_doc = parse(before)?;
    let after_doc = parse(after)?;
    let mut doc = parse(text)?;

    if let (Some(before_tags), Some(after_tags)) = (
        before_doc.get("tag").and_then(Item::as_array_of_tables),
        after_doc.get("tag").and_then(Item::as_array_of_tables),
    ) {
        let changed: Vec<(String, String)> = before_tags
            .iter()
            .enumerate()
            .filter_map(|(i, tag)| {
                let old_dest = tag.get("dest")?.as_str()?;
                let new_dest = after_tags.get(i)?.get("dest")?.as_str()?;
                ((old_dest == from || old_dest.starts_with(&(from.to_string() + "/")))
                    && (new_dest == to || new_dest.starts_with(&(to.to_string() + "/"))))
                .then(|| (new_dest.to_string(), old_dest.to_string()))
            })
            .collect();
        if let Ok(tags) = tags_mut(&mut doc) {
            for tag in tags.iter_mut() {
                let Some(dest) = tag.get("dest").and_then(Item::as_str).map(str::to_string) else {
                    continue;
                };
                if let Some((_, old_dest)) = changed.iter().find(|(new_dest, _)| *new_dest == dest)
                {
                    tag["dest"] = value(old_dest);
                }
            }
        }
    }

    if let Some(before_folders) = before_doc.get("folder").and_then(Item::as_array_of_tables) {
        let old_paths: Vec<String> = before_folders
            .iter()
            .filter_map(|folder| {
                let path = folder.get("path")?.as_str()?;
                (path == from || path.starts_with(&(from.to_string() + "/")))
                    .then(|| path.to_string())
            })
            .collect();
        if let Ok(folders) = folders_mut(&mut doc) {
            for path in old_paths {
                if !folders
                    .iter()
                    .any(|folder| folder.get("path").and_then(Item::as_str) == Some(path.as_str()))
                {
                    let mut table = Table::new();
                    table["path"] = value(path);
                    folders.push(table);
                }
            }
        }
    }

    Ok(doc.to_string())
}

pub fn undo_prefix_change(text: &str, before: &str, folder: &str) -> Result<String, String> {
    let cfg = sorter_core::Config::from_toml(before).map_err(|e| e.to_string())?;
    set_folder_prefix(text, folder, &cfg.prefix_for(folder))
}
