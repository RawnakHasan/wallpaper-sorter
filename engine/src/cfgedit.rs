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
    items.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect()
}

fn fill(table: &mut Table, spec: &TagSpec) {
    table["keywords"] = value(str_array(&spec.keywords));
    table["dest"] = value(spec.dest.clone());
    match spec.prefix.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
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
    doc["tag"].as_array_of_tables_mut().ok_or_else(|| "`tag` in the config is not a list of [[tag]] tables".to_string())
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
    let t = tags.get_mut(index).ok_or_else(|| format!("no tag number {index}"))?;
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
