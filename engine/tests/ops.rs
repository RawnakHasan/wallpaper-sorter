//! The operations the web UI uses, on real temporary folders.

use sorter_core::{Config, GapMode, Intake, Site};
use sorter_engine::{hash_file, Pipeline};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Dirs {
    base: PathBuf,
    lib: PathBuf,
    dl: PathBuf,
}

impl Dirs {
    fn new() -> Dirs {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("sorter-ops-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (lib, dl) = (base.join("lib"), base.join("pixiv"));
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&dl).unwrap();
        Dirs { base, lib, dl }
    }
    fn cfg(&self) -> Config {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/tags.starter.toml");
        let mut c = Config::from_toml(&fs::read_to_string(path).unwrap()).unwrap();
        c.library = None;
        c.intake = vec![Intake { path: self.dl.to_string_lossy().to_string(), recursive: true, remove_empty_folders: true }];
        c
    }
}

impl Drop for Dirs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn png(tag: &str) -> Vec<u8> {
    let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
    v.extend(100u32.to_be_bytes());
    v.extend(50u32.to_be_bytes());
    v.extend([8, 2, 0, 0, 0]);
    v.extend(tag.bytes());
    v
}

fn put(path: &Path, tag: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, png(tag)).unwrap();
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    v.sort();
    v
}

#[test]
fn the_inbox_lists_loose_and_intake_files_with_reasons() {
    let d = Dirs::new();
    put(&d.lib.join("wallhaven-1q2le9.jpg"), "a");
    put(&d.lib.join("Chisa Skadi.png"), "b");
    put(&d.lib.join("Chisa.png"), "c");
    put(&d.lib.join("notes.txt"), "not an image");
    put(&d.lib.join("Nature/Nature 1.png"), "in a folder: not inbox");
    put(&d.dl.join("BLACKmeow-91709880/151861634_p0--.png"), "p");
    let p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let items = p.inbox().unwrap();
    let by_name = |n: &str| items.iter().find(|i| i.name == n).unwrap_or_else(|| panic!("{n} missing"));
    assert_eq!(items.len(), 4);
    assert_eq!(by_name("wallhaven-1q2le9.jpg").reason, "no_match");
    assert_eq!(by_name("wallhaven-1q2le9.jpg").intake, "library");
    assert_eq!(by_name("wallhaven-1q2le9.jpg").origin.as_ref().unwrap().sources[0].site, Site::Wallhaven);
    assert_eq!(by_name("Chisa Skadi.png").reason, "conflict");
    assert_eq!(by_name("Chisa Skadi.png").matched, ["chisa", "skadi"]);
    assert_eq!(by_name("Chisa.png").reason, "ready");
    let px = by_name("151861634_p0--.png");
    assert_eq!(px.intake, d.dl.to_string_lossy());
    assert!(px.origin.is_none(), "not processed yet, so no record");
}

#[test]
fn folders_report_prefix_next_number_and_gaps() {
    let d = Dirs::new();
    for n in [1, 3, 4] {
        put(&d.lib.join(format!("Wuthering-Waves/Chisa/Chisa {n}.png")), &n.to_string());
    }
    put(&d.lib.join("Wuthering-Waves/Wuthering Waves 7.png"), "w");
    let p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let folders = p.folders().unwrap();
    let chisa = folders.iter().find(|f| f.path == "Wuthering-Waves/Chisa").unwrap();
    assert_eq!((chisa.prefix.as_str(), chisa.count, chisa.next_number, chisa.gaps.clone()), ("Chisa", 3, 5, vec![2]));
    let ww = folders.iter().find(|f| f.path == "Wuthering-Waves").unwrap();
    assert_eq!((ww.prefix.as_str(), ww.next_number), ("Wuthering Waves", 8));
}

#[test]
fn assigning_moves_numbers_and_updates_the_record() {
    let d = Dirs::new();
    put(&d.lib.join("wallhaven-1q2le9.jpg"), "a");
    put(&d.lib.join("Nature/Nature 7.jpg"), "old");
    let src = d.lib.join("wallhaven-1q2le9.jpg");
    let hash = hash_file(&src).unwrap();
    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let out = p.assign(&[src.clone()], "Nature").unwrap();
    assert!(out.report.error.is_none());
    assert!(!src.exists());
    assert!(d.lib.join("Nature/Nature 8.jpg").exists());
    let o = p.origins.get(&hash).unwrap();
    assert_eq!(o.path, "Nature/Nature 8.jpg");
    assert_eq!(o.original_name, "wallhaven-1q2le9.jpg");
    assert_eq!(o.sources[0].site, Site::Wallhaven);
    assert_eq!(o.note, "Assigned; tags: ");
    assert_eq!(p.index.get("Nature/Nature 8.jpg").unwrap().hash, hash);
    assert!(p.index.get("wallhaven-1q2le9.jpg").is_none());
    // and it can be undone
    p.undo_batch(out.report.batch).unwrap();
    assert!(src.exists());
}

#[test]
fn assigning_an_intake_file_keeps_its_artist() {
    let d = Dirs::new();
    let src = d.dl.join("BLACKmeow-91709880/151861634_p0--.png");
    put(&src, "p");
    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let out = p.process(&[src.clone()]).unwrap(); // no tag: left in place, record made
    assert_eq!(out.report.left.len(), 1);
    p.assign(&[src.clone()], "Series/Some Artist").unwrap();
    assert!(d.lib.join("Series/Some Artist/Some Artist 1.png").exists());
    let o = p.origins.all().next().unwrap();
    assert_eq!(o.path, "Series/Some Artist/Some Artist 1.png");
    assert_eq!(o.sources[0].artist.as_deref(), Some("BLACKmeow"));
}

#[test]
fn assigning_rejects_bad_folders() {
    let d = Dirs::new();
    put(&d.lib.join("a.png"), "a");
    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    for bad in ["", "/etc", "../x", "a/../../x", ".sorter/trash", "Duplicates"] {
        assert!(p.assign(&[d.lib.join("a.png")], bad).is_err(), "{bad:?} should be refused");
    }
    assert!(d.lib.join("a.png").exists());
}

#[test]
fn re_sort_previews_then_moves_existing_images_as_one_undoable_batch() {
    let d = Dirs::new();
    put(&d.lib.join("Archive/Chisa original.png"), "chisa");
    put(&d.lib.join("Archive/mystery.png"), "mystery");
    put(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.png"), "already sorted");
    // A file outside the selected scope must not be touched.
    put(&d.lib.join("Elsewhere/Chisa later.png"), "later");

    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let preview = p.resort_preview(Some("Archive")).unwrap();
    assert!(preview.actions.iter().any(|a| matches!(a, sorter_core::Action::Move { from, to, .. }
        if from.ends_with("Archive/Chisa original.png") && to == "Wuthering-Waves/Chisa/Chisa 2.png")));
    assert!(preview.actions.iter().any(|a| matches!(a, sorter_core::Action::Leave { path, .. }
        if path.ends_with("Archive/mystery.png"))));
    assert!(d.lib.join("Archive/Chisa original.png").exists(), "preview changes nothing");

    let out = p.resort(Some("Archive")).unwrap();
    assert!(out.report.error.is_none());
    assert_eq!(out.report.done.len(), 1);
    assert!(!d.lib.join("Archive/Chisa original.png").exists());
    assert!(d.lib.join("Wuthering-Waves/Chisa/Chisa 2.png").exists());
    assert!(d.lib.join("Archive/mystery.png").exists());
    assert!(d.lib.join("Elsewhere/Chisa later.png").exists());
    assert_eq!(p.origins.get(&hash_file(&d.lib.join("Wuthering-Waves/Chisa/Chisa 2.png")).unwrap()).unwrap().original_name, "Chisa original.png");

    p.undo_batch(out.report.batch).unwrap();
    assert!(d.lib.join("Archive/Chisa original.png").exists());
    assert!(!d.lib.join("Wuthering-Waves/Chisa/Chisa 2.png").exists());
}

#[test]
fn paths_from_the_ui_must_stay_inside() {
    let d = Dirs::new();
    let p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    assert!(p.resolve("Nature/x.png").is_ok());
    assert!(p.resolve(&d.lib.join("x.png").to_string_lossy()).is_ok());
    assert!(p.resolve(&d.dl.join("a/x.png").to_string_lossy()).is_ok());
    assert!(p.resolve("../x.png").is_err());
    assert!(p.resolve("/etc/passwd").is_err());
    assert!(p.resolve(&format!("{}/../../etc/passwd", d.lib.display())).is_err());
}

#[test]
fn delete_moves_to_the_trash_and_can_be_undone_or_emptied() {
    let d = Dirs::new();
    put(&d.lib.join("Nature/Nature 1.png"), "a");
    put(&d.lib.join("Nature/Nature 2.png"), "b");
    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let hash = hash_file(&d.lib.join("Nature/Nature 1.png")).unwrap();
    let out = p.delete(&[d.lib.join("Nature/Nature 1.png")]).unwrap();
    assert!(out.report.error.is_none());
    assert_eq!(names(&d.lib.join("Nature")), ["Nature 2.png"]);
    assert!(p.index.get("Nature/Nature 1.png").is_none());
    assert_eq!(p.index.paths_for_hash(&hash).len(), 0);
    assert!(p.origins.get(&hash).unwrap().path.starts_with(".sorter/trash/"));
    assert_eq!(p.origins.get(&hash).unwrap().note, "Deleted; tags: ");

    p.undo_batch(out.report.batch).unwrap();
    assert_eq!(names(&d.lib.join("Nature")), ["Nature 1.png", "Nature 2.png"]);
    assert_eq!(p.origins.get(&hash).unwrap().path, "Nature/Nature 1.png");

    let out = p.delete(&[d.lib.join("Nature/Nature 2.png")]).unwrap();
    assert!(out.report.error.is_none());
    assert_eq!(p.empty_trash().unwrap(), 1);
    assert!(!d.lib.join(".sorter/trash").exists());
}

#[test]
fn gap_filling_previews_and_applies_through_the_log() {
    let d = Dirs::new();
    for n in [1, 3, 4] {
        put(&d.lib.join(format!("Wuthering-Waves/Chisa/Chisa {n}.png")), &n.to_string());
    }
    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let preview = p.gap_fill_preview("Wuthering-Waves/Chisa", GapMode::LastIntoGap).unwrap();
    assert_eq!(preview.len(), 1);
    assert_eq!((preview[0].from.as_str(), preview[0].to.as_str()), ("Chisa 4.png", "Chisa 2.png"));
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png", "Chisa 3.png", "Chisa 4.png"], "preview changes nothing");

    let out = p.fill_gaps("Wuthering-Waves/Chisa", GapMode::LastIntoGap).unwrap();
    assert!(out.report.error.is_none());
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png", "Chisa 2.png", "Chisa 3.png"]);
    p.undo_batch(out.report.batch).unwrap();
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png", "Chisa 3.png", "Chisa 4.png"]);
}

#[test]
fn images_are_listed_in_number_order_with_their_origin() {
    let d = Dirs::new();
    put(&d.lib.join("Nature/Nature 10.png"), "10");
    put(&d.lib.join("Nature/Nature 2.png"), "2");
    put(&d.lib.join("Nature/odd name.png"), "odd");
    let p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    let imgs = p.images("Nature").unwrap();
    let order: Vec<&str> = imgs.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(order, ["Nature 2.png", "Nature 10.png", "odd name.png"]);
    assert_eq!(imgs[0].number, Some(2));
    assert_eq!(imgs[2].number, None);
    assert!(imgs[0].hash.is_some() && imgs[0].origin.is_some());
}

#[test]
fn duplicates_are_listed_with_what_they_duplicate() {
    let d = Dirs::new();
    put(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.png"), "same");
    put(&d.dl.join("Chisa copy.png"), "same");
    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    p.process(&[d.dl.join("Chisa copy.png")]).unwrap();
    let dups = p.duplicates().unwrap();
    assert_eq!(dups.len(), 1);
    assert_eq!(dups[0].name, "Chisa copy.png");
    assert_eq!(dups[0].duplicate_of.as_deref(), Some("Wuthering-Waves/Chisa/Chisa 1.png"));
}

#[test]
fn a_record_can_be_given_a_source_by_hand() {
    let d = Dirs::new();
    put(&d.lib.join("mystery.png"), "m");
    let hash = hash_file(&d.lib.join("mystery.png")).unwrap();
    let mut p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    assert_eq!(p.origins.get(&hash).unwrap().sources[0].site, Site::Unknown);
    assert!(p.edit_origin(&hash, Site::Wallhaven, "abc123").unwrap());
    let s = &p.origins.get(&hash).unwrap().sources[0];
    assert_eq!((s.site, s.id.as_str(), s.url.as_str()), (Site::Wallhaven, "abc123", "https://wallhaven.cc/w/abc123"));
    assert!(!p.edit_origin("no such hash", Site::Pixiv, "1").unwrap());
    drop(p);
    let p = Pipeline::open(&d.lib, d.cfg()).unwrap();
    assert_eq!(p.origins.get(&hash).unwrap().sources[0].site, Site::Wallhaven, "saved to disk");
}
