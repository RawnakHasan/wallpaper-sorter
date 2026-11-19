use sorter_core::{Config, MatchMode};
use sorter_engine::cfgedit::{
    add_folder, add_intake, add_tag, delete_tag, merge_folder, rename_folder, set_folder_prefix,
    set_gap_mode, update_intake, update_tag, TagSpec,
};
use std::fs;
use std::path::PathBuf;

fn starter() -> String {
    fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/tags.starter.toml"))
        .unwrap()
}

fn spec(kw: &[&str], dest: &str) -> TagSpec {
    TagSpec {
        keywords: kw.iter().map(|s| s.to_string()).collect(),
        dest: dest.to_string(),
        prefix: None,
        match_mode: MatchMode::Word,
        strict_words: vec![],
        generic: false,
    }
}

#[test]
fn adding_a_tag_keeps_comments_and_other_tags() {
    let text = starter();
    let before = Config::from_toml(&text).unwrap().tags.len();
    let mut s = spec(&["violet evergarden", "violet"], "Series/Violet Evergarden");
    s.prefix = Some("Violet".to_string());
    s.generic = false;
    let out = add_tag(&text, &s).unwrap();
    assert!(
        out.contains("# ---------- Wuthering Waves ----------"),
        "comments stay"
    );
    assert!(out.contains("[[intake]]"));
    let cfg = Config::from_toml(&out).unwrap();
    assert_eq!(cfg.tags.len(), before + 1);
    let t = cfg.tags.last().unwrap();
    assert_eq!(t.keywords, ["violet evergarden", "violet"]);
    assert_eq!(
        (t.dest.as_str(), t.prefix.as_deref()),
        ("Series/Violet Evergarden", Some("Violet"))
    );
    assert_eq!(cfg.prefix_for("Series/Violet Evergarden"), "Violet");
}

#[test]
fn optional_fields_round_trip() {
    let mut s = spec(&["robin"], "Honkai-Star-Rail/Robin");
    s.strict_words = vec!["honkai".to_string()];
    s.generic = true;
    s.match_mode = MatchMode::Substring;
    let cfg = Config::from_toml(&add_tag(&starter(), &s).unwrap()).unwrap();
    let t = cfg.tags.last().unwrap();
    assert_eq!(t.strict_words, ["honkai"]);
    assert!(t.generic);
    assert_eq!(t.match_mode, MatchMode::Substring);
}

#[test]
fn updating_a_tag_changes_only_that_tag() {
    let text = starter();
    let cfg = Config::from_toml(&text).unwrap();
    let i = cfg
        .tags
        .iter()
        .position(|t| t.keywords == ["chisa"])
        .unwrap();
    let mut s = spec(&["chisa", "kuchiba"], "Wuthering-Waves/Chisa");
    s.prefix = Some("Chisa K".to_string());
    let out = update_tag(&text, i, &s).unwrap();
    let after = Config::from_toml(&out).unwrap();
    assert_eq!(after.tags.len(), cfg.tags.len());
    assert_eq!(after.tags[i].keywords, ["chisa", "kuchiba"]);
    assert_eq!(after.tags[i].prefix.as_deref(), Some("Chisa K"));
    assert_eq!(after.tags[i + 1].keywords, cfg.tags[i + 1].keywords);
    // clearing the prefix again removes the key
    let cleared = update_tag(&out, i, &spec(&["chisa"], "Wuthering-Waves/Chisa")).unwrap();
    assert_eq!(Config::from_toml(&cleared).unwrap().tags[i].prefix, None);
}

#[test]
fn deleting_a_tag() {
    let text = starter();
    let cfg = Config::from_toml(&text).unwrap();
    let i = cfg
        .tags
        .iter()
        .position(|t| t.keywords == ["aemeath"])
        .unwrap();
    let out = delete_tag(&text, i).unwrap();
    let after = Config::from_toml(&out).unwrap();
    assert_eq!(after.tags.len(), cfg.tags.len() - 1);
    assert!(after.tags.iter().all(|t| t.keywords != ["aemeath"]));
    assert!(delete_tag(&text, 9999).is_err());
}

#[test]
fn bad_specs_are_refused() {
    let text = starter();
    assert!(add_tag(&text, &spec(&[], "Nature")).is_err());
    assert!(add_tag(&text, &spec(&["  "], "Nature")).is_err());
    assert!(add_tag(&text, &spec(&["x"], "")).is_err());
    assert!(add_tag(&text, &spec(&["x"], "../escape")).is_err());
    assert!(add_tag(&text, &spec(&["x"], "/abs")).is_err());
    assert!(update_tag(&text, 9999, &spec(&["x"], "Nature")).is_err());
}

#[test]
fn the_gap_mode_setting() {
    let out = set_gap_mode(&starter(), "last").unwrap();
    assert_eq!(
        format!("{:?}", Config::from_toml(&out).unwrap().settings.gap_mode),
        "LastIntoGap"
    );
    assert!(out.contains("image_extensions"), "other settings stay");
    assert!(set_gap_mode(&starter(), "whatever").is_err());
}

#[test]
fn folder_settings_keep_a_prefix_and_follow_renames_and_merges() {
    let text = add_folder(&starter(), "Series/Violet", Some("Violet")).unwrap();
    let text = set_folder_prefix(&text, "Series/Violet", "Violet Evergarden").unwrap();
    let cfg = Config::from_toml(&text).unwrap();
    assert_eq!(cfg.prefix_for("Series/Violet"), "Violet Evergarden");

    let text = add_tag(&text, &spec(&["violet"], "Series/Violet")).unwrap();
    let renamed = rename_folder(&text, "Series", "Anime", &[]).unwrap();
    let cfg = Config::from_toml(&renamed).unwrap();
    assert_eq!(cfg.tags.last().unwrap().dest, "Anime/Violet");
    assert_eq!(cfg.prefix_for("Anime/Violet"), "Violet Evergarden");

    let merged = merge_folder(&renamed, "Anime/Violet", "Series").unwrap();
    let cfg = Config::from_toml(&merged).unwrap();
    assert_eq!(cfg.tags.last().unwrap().dest, "Series");
    assert!(cfg.folders.iter().all(|f| f.path != "Anime/Violet"));
    assert!(add_folder(&starter(), "Nature", Some("bad/name")).is_err());
}

#[test]
fn folder_rename_adds_only_the_prefix_pins_computed_by_its_caller() {
    let renamed = rename_folder(
        &starter(),
        "Nature",
        "Landscapes",
        &[("Landscapes".to_string(), "Nature".to_string())],
    )
    .unwrap();
    let cfg = Config::from_toml(&renamed).unwrap();
    assert_eq!(cfg.prefix_for("Landscapes"), "Nature");
    assert!(renamed.contains("path = \"Landscapes\""));
    assert!(renamed.contains("prefix = \"Nature\""));

    let unchanged = rename_folder(&renamed, "Landscapes", "Nature-Scenes", &[]).unwrap();
    assert!(!unchanged.contains("path = \"Nature-Scenes\"\nprefix = \"Nature-Scenes\""));
}

#[test]
fn intake_paths_are_validated() {
    let text = "library = \"/tmp/wallpaper-sorter-test/library\"\nsetup_complete = true\n";
    assert!(add_intake(text, "/", true, false).is_err());
    assert!(add_intake(text, "/tmp", true, false).is_err());
    assert!(add_intake(text, "/tmp/wallpaper-sorter-test/library", true, false).is_err());
    assert!(add_intake(
        text,
        "/tmp/wallpaper-sorter-test/library/.sorter",
        true,
        false
    )
    .is_err());

    let out = add_intake(
        text,
        "/tmp/wallpaper-sorter-test/library/inbox",
        true,
        false,
    )
    .unwrap();
    let cfg = Config::from_toml(&out).unwrap();
    assert_eq!(cfg.intake.len(), 1);
    assert_eq!(cfg.intake[0].remove_empty_folders, false);
    assert!(update_intake(&out, 0, "/", true, false).is_err());
}
