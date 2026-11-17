//! End-to-end tests of the pipeline: hashing, duplicates, origin records, the hash cache, undo.

use sorter_core::{Config, GapMode, Site};
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
        let base = std::env::temp_dir().join(format!("sorter-pipe-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (lib, dl) = (base.join("lib"), base.join("dl"));
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&dl).unwrap();
        Dirs { base, lib, dl }
    }
}

impl Drop for Dirs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn cfg() -> Config {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/tags.starter.toml");
    Config::from_toml(&fs::read_to_string(path).unwrap()).unwrap()
}

/// A minimal PNG header with the given size, followed by `tag` so different files have different content.
fn png(w: u32, h: u32, tag: &str) -> Vec<u8> {
    let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
    v.extend(w.to_be_bytes());
    v.extend(h.to_be_bytes());
    v.extend([8, 2, 0, 0, 0]);
    v.extend(tag.bytes());
    v
}

fn put(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    v.sort();
    v
}

#[test]
fn moving_records_origin_dimensions_and_index() {
    let d = Dirs::new();
    let src = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    put(&src, &png(1920, 1080, "a"));
    let hash = hash_file(&src).unwrap();

    let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
    let out = p.process(&[src.clone()]).unwrap();
    assert!(out.report.error.is_none());

    let o = p.origins.get(&hash).expect("origin record");
    assert_eq!(o.path, "Wuthering-Waves/Chisa/Chisa 1.png");
    assert_eq!(o.original_name, "Kuchiba.Chisa.full.4511113.png");
    assert_eq!(o.sources.len(), 1);
    assert_eq!(o.sources[0].site, Site::Zerochan);
    assert_eq!(o.sources[0].id, "4511113");
    assert_eq!(o.sources[0].url, "https://www.zerochan.net/4511113");
    assert_eq!((o.width, o.height), (1920, 1080));
    assert_eq!(o.note, "One folder; tags: chisa");
    assert_eq!(p.index.get("Wuthering-Waves/Chisa/Chisa 1.png").unwrap().hash, hash);
}

#[test]
fn a_copy_from_another_site_is_a_duplicate_and_adds_a_source() {
    let d = Dirs::new();
    let a = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    let b = d.dl.join("Konachan.com - 404420 chisa wuthering_waves.png");
    put(&a, &png(100, 100, "same"));
    put(&b, &png(100, 100, "same"));

    let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
    p.process(&[a]).unwrap();
    let out = p.process(&[b.clone()]).unwrap();
    assert!(out.report.error.is_none());
    assert_eq!(names(&d.lib.join("Duplicates")), ["Konachan.com - 404420 chisa wuthering_waves.png"]);
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png"]);
    assert_eq!(p.origins.len(), 1);
    let o = p.origins.all().next().unwrap();
    let sites: Vec<Site> = o.sources.iter().map(|s| s.site).collect();
    assert_eq!(sites, [Site::Zerochan, Site::Konachan]);
}

#[test]
fn a_copy_in_the_same_batch_is_caught_too() {
    let d = Dirs::new();
    let a = d.dl.join("Chisa a.png");
    let b = d.dl.join("Chisa b.png");
    put(&a, &png(10, 10, "same"));
    put(&b, &png(10, 10, "same"));
    let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
    p.process(&[a, b]).unwrap();
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png"]);
    assert_eq!(names(&d.lib.join("Duplicates")), ["Chisa b.png"]);
}

#[test]
fn the_hash_cache_is_reused_until_a_file_changes() {
    let d = Dirs::new();
    let src = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    put(&src, &png(10, 10, "a"));
    {
        let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
        p.process(&[src]).unwrap();
    }
    let p = Pipeline::open(&d.lib, cfg()).unwrap();
    assert_eq!((p.last_refresh.hashed, p.last_refresh.reused), (0, 1));
    drop(p);

    put(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.png"), &png(10, 10, "changed and longer"));
    let p = Pipeline::open(&d.lib, cfg()).unwrap();
    assert_eq!((p.last_refresh.hashed, p.last_refresh.reused), (1, 0));
}

#[test]
fn gap_filling_keeps_origin_paths_current() {
    let d = Dirs::new();
    let chisa = d.lib.join("Wuthering-Waves/Chisa");
    for (n, tag) in [(1, "one"), (3, "three"), (4, "four")] {
        put(&chisa.join(format!("Chisa {n}.png")), &png(10, 10, tag));
    }
    let four = hash_file(&chisa.join("Chisa 4.png")).unwrap();
    let mut config = cfg();
    config.settings.gap_mode = GapMode::LastIntoGap;

    let mut p = Pipeline::open(&d.lib, config).unwrap();
    assert_eq!(p.origins.len(), 3);
    let src = d.dl.join("Chisa new.png");
    put(&src, &png(10, 10, "new"));
    p.process(&[src]).unwrap();

    assert_eq!(p.origins.get(&four).unwrap().path, "Wuthering-Waves/Chisa/Chisa 2.png");
    assert_eq!(p.index.get("Wuthering-Waves/Chisa/Chisa 2.png").unwrap().hash, four);
    assert!(p.index.get("Wuthering-Waves/Chisa/Chisa 4.png").is_some());
}

#[test]
fn existing_files_get_origin_records_when_the_library_is_opened() {
    let d = Dirs::new();
    put(&d.lib.join("wallhaven-1q2le9.jpg"), &png(10, 10, "w"));
    put(&d.lib.join("Arknights/Skadi/Skadi 3.png"), &png(10, 10, "s"));
    put(&d.lib.join("Notes/readme.txt"), b"not an image");
    let p = Pipeline::open(&d.lib, cfg()).unwrap();
    assert_eq!(p.origins.len(), 2);
    let w = p.origins.all().find(|o| o.original_name == "wallhaven-1q2le9.jpg").unwrap();
    assert_eq!(w.sources[0].site, Site::Wallhaven);
    assert_eq!(w.sources[0].id, "1q2le9");
    assert_eq!(w.path, "wallhaven-1q2le9.jpg");
    let s = p.origins.all().find(|o| o.original_name == "Skadi 3.png").unwrap();
    assert_eq!(s.sources[0].site, Site::Unknown);
    assert_eq!(s.note, "existing file");
}

#[test]
fn a_pixiv_file_left_in_place_keeps_its_artist() {
    let d = Dirs::new();
    let src = d.base.join("pixiv/BLACKmeow-91709880/151861634_p0--.png");
    put(&src, &png(2000, 1000, "p"));
    let hash = hash_file(&src).unwrap();
    let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
    let out = p.process(&[src.clone()]).unwrap();
    assert_eq!(out.report.left.len(), 1);
    assert!(src.exists());
    let o = p.origins.get(&hash).unwrap();
    assert_eq!(o.path, src.to_string_lossy());
    let s = &o.sources[0];
    assert_eq!((s.site, s.id.as_str(), s.page), (Site::Pixiv, "151861634", Some(0)));
    assert_eq!((s.artist.as_deref(), s.artist_id.as_deref()), (Some("BLACKmeow"), Some("91709880")));
    assert_eq!(o.note, "waiting in the Inbox (no match)");
}

#[test]
fn undo_batch_restores_the_file_and_the_record_path() {
    let d = Dirs::new();
    let src = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    put(&src, &png(10, 10, "a"));
    let hash = hash_file(&src).unwrap();
    let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
    let out = p.process(&[src.clone()]).unwrap();
    p.undo_batch(out.report.batch).unwrap();
    assert!(src.exists());
    assert!(p.index.get("Wuthering-Waves/Chisa/Chisa 1.png").is_none());
    assert_eq!(p.origins.get(&hash).unwrap().path, src.to_string_lossy());
}

#[test]
fn moving_a_file_by_hand_is_noticed_on_reopen() {
    let d = Dirs::new();
    let src = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    put(&src, &png(10, 10, "a"));
    let hash = hash_file(&src).unwrap();
    {
        let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
        p.process(&[src]).unwrap();
    }
    fs::create_dir_all(d.lib.join("Other")).unwrap();
    fs::rename(d.lib.join("Wuthering-Waves/Chisa/Chisa 1.png"), d.lib.join("Other/kept.png")).unwrap();
    let p = Pipeline::open(&d.lib, cfg()).unwrap();
    assert_eq!(p.origins.get(&hash).unwrap().path, "Other/kept.png");
    assert_eq!(p.origins.len(), 1);
}

#[test]
fn identical_files_already_in_the_library_are_listed() {
    let d = Dirs::new();
    put(&d.lib.join("A/one.png"), &png(10, 10, "same"));
    put(&d.lib.join("B/two.png"), &png(10, 10, "same"));
    put(&d.lib.join("C/three.png"), &png(10, 10, "different"));
    put(&d.lib.join("Duplicates/one.png"), &png(10, 10, "same"));
    let p = Pipeline::open(&d.lib, cfg()).unwrap();
    let groups = p.index.existing_duplicates("Duplicates");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].1, ["A/one.png", "B/two.png"]);
}

#[test]
fn a_loose_file_already_in_the_library_is_not_its_own_duplicate() {
    let d = Dirs::new();
    put(&d.lib.join("Chisa.png"), &png(10, 10, "a"));
    let mut p = Pipeline::open(&d.lib, cfg()).unwrap(); // the file is now indexed
    let out = p.process(&[d.lib.join("Chisa.png")]).unwrap();
    assert!(out.report.error.is_none());
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png"]);
    assert!(!d.lib.join("Duplicates").exists());
    assert_eq!(p.origins.len(), 1);
}

#[test]
fn a_loose_copy_of_a_sorted_file_is_still_a_duplicate() {
    let d = Dirs::new();
    put(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.png"), &png(10, 10, "same"));
    put(&d.lib.join("Chisa copy.png"), &png(10, 10, "same"));
    let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
    p.process(&[d.lib.join("Chisa copy.png")]).unwrap();
    assert_eq!(names(&d.lib.join("Duplicates")), ["Chisa copy.png"]);
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png"]);
}

#[test]
fn two_identical_loose_files_are_sorted_once_and_the_other_is_a_duplicate() {
    let d = Dirs::new();
    put(&d.lib.join("Chisa a.png"), &png(10, 10, "same"));
    put(&d.lib.join("Chisa b.png"), &png(10, 10, "same"));
    let mut p = Pipeline::open(&d.lib, cfg()).unwrap();
    p.process(&[d.lib.join("Chisa a.png"), d.lib.join("Chisa b.png")]).unwrap();
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.png"]);
    assert_eq!(names(&d.lib.join("Duplicates")), ["Chisa b.png"]);
}
