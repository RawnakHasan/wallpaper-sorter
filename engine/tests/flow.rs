//! End-to-end tests on real temporary folders: scan, plan, apply, log, undo.

use sorter_core::{build_plan, Action, Config, GapMode, Incoming, Plan, Rule};
use sorter_engine::{apply, library_snapshot, undo_batch, undo_entry, ExecError, Log, UndoError};
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
        let base = std::env::temp_dir().join(format!("sorter-test-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (lib, dl) = (base.join("lib"), base.join("dl"));
        fs::create_dir_all(&lib).unwrap();
        fs::create_dir_all(&dl).unwrap();
        Dirs { base, lib, dl }
    }
    fn log(&self) -> Log {
        Log::open(self.lib.join(".sorter/log.jsonl")).unwrap()
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

fn put(path: &Path, content: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn incoming(path: &Path, hash: Option<&str>) -> Incoming {
    Incoming { path: path.to_string_lossy().to_string(), hash: hash.map(|h| h.to_string()) }
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
    v.sort();
    v
}

#[test]
fn scan_plan_apply_and_log() {
    let d = Dirs::new();
    put(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.jpg"), "old");
    put(&d.lib.join(".sorter/ignored.txt"), "hidden");
    put(&d.lib.join("unsorted.jpg"), "root file");
    let src = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    put(&src, "new");

    let snap = library_snapshot(&d.lib).unwrap();
    assert_eq!(snap.folders.keys().cloned().collect::<Vec<_>>(), ["Wuthering-Waves", "Wuthering-Waves/Chisa"]);
    let plan = build_plan(&cfg(), &snap, &[incoming(&src, None)]);

    let mut log = d.log();
    let report = apply(&plan, &d.lib, &mut log);
    assert!(report.error.is_none(), "{:?}", report.error);
    assert_eq!(report.done.len(), 1);
    assert_eq!(read(&d.lib.join("Wuthering-Waves/Chisa/Chisa 2.png")), "new");
    assert!(!src.exists());
    assert_eq!(read(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.jpg")), "old");

    let reopened = d.log();
    assert_eq!(reopened.entries(), log.entries());
    assert_eq!(reopened.entries()[0].note, "One folder; tags: chisa");
}

#[test]
fn never_overwrites() {
    let d = Dirs::new();
    put(&d.dl.join("a.png"), "source");
    put(&d.lib.join("Out/a.png"), "target");
    let plan = Plan {
        actions: vec![Action::Move {
            from: d.dl.join("a.png").to_string_lossy().to_string(),
            to: "Out/a.png".to_string(),
            rule: Rule::OneFolder,
            matched: vec![],
        }],
    };
    let mut log = d.log();
    let report = apply(&plan, &d.lib, &mut log);
    assert!(matches!(report.error, Some(ExecError::TargetExists(_))));
    assert_eq!(read(&d.dl.join("a.png")), "source");
    assert_eq!(read(&d.lib.join("Out/a.png")), "target");
    assert!(log.entries().is_empty());
}

#[test]
fn a_vanished_source_is_skipped_and_the_rest_continues() {
    let d = Dirs::new();
    put(&d.dl.join("b.png"), "b");
    let mv = |name: &str, to: &str| Action::Move {
        from: d.dl.join(name).to_string_lossy().to_string(),
        to: to.to_string(),
        rule: Rule::OneFolder,
        matched: vec![],
    };
    let plan = Plan { actions: vec![mv("gone.png", "X/gone.png"), mv("b.png", "X/b.png")] };
    let mut log = d.log();
    let report = apply(&plan, &d.lib, &mut log);
    assert!(report.error.is_none());
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(report.done.len(), 1);
    assert_eq!(read(&d.lib.join("X/b.png")), "b");
}

fn sorted_once(d: &Dirs) -> (Log, PathBuf, u64) {
    put(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.jpg"), "old");
    let src = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    put(&src, "new");
    let snap = library_snapshot(&d.lib).unwrap();
    let plan = build_plan(&cfg(), &snap, &[incoming(&src, None)]);
    let mut log = d.log();
    let report = apply(&plan, &d.lib, &mut log);
    assert!(report.error.is_none());
    (log, src, report.done[0].id)
}

#[test]
fn undo_puts_the_file_back_once() {
    let d = Dirs::new();
    let (mut log, src, id) = sorted_once(&d);
    undo_entry(&mut log, id).unwrap();
    assert_eq!(read(&src), "new");
    assert!(!d.lib.join("Wuthering-Waves/Chisa/Chisa 2.png").exists());
    assert!(matches!(undo_entry(&mut log, id), Err(UndoError::AlreadyUndone(_))));
}

#[test]
fn undo_adds_a_suffix_when_the_old_name_is_taken() {
    let d = Dirs::new();
    let (mut log, src, id) = sorted_once(&d);
    put(&src, "someone else");
    undo_entry(&mut log, id).unwrap();
    assert_eq!(read(&src), "someone else");
    assert_eq!(read(&d.dl.join("Kuchiba.Chisa.full.4511113 (2).png")), "new");
}

#[test]
fn undo_explains_when_the_file_was_moved_since() {
    let d = Dirs::new();
    let (mut log, _src, id) = sorted_once(&d);
    fs::remove_file(d.lib.join("Wuthering-Waves/Chisa/Chisa 2.png")).unwrap();
    assert!(matches!(undo_entry(&mut log, id), Err(UndoError::FileMovedSince(_))));
}

#[test]
fn undo_batch_unwinds_renames_and_moves() {
    let d = Dirs::new();
    for (n, c) in [(1, "one"), (3, "three"), (4, "four")] {
        put(&d.lib.join(format!("Wuthering-Waves/Chisa/Chisa {n}.jpg")), c);
    }
    let src = d.dl.join("Chisa x.png");
    put(&src, "new");
    let mut config = cfg();
    config.settings.gap_mode = GapMode::LastIntoGap;
    let snap = library_snapshot(&d.lib).unwrap();
    let plan = build_plan(&config, &snap, &[incoming(&src, None)]);
    assert_eq!(plan.actions.len(), 2);

    let mut log = d.log();
    let report = apply(&plan, &d.lib, &mut log);
    assert!(report.error.is_none());
    let chisa = d.lib.join("Wuthering-Waves/Chisa");
    assert_eq!(names(&chisa), ["Chisa 1.jpg", "Chisa 2.jpg", "Chisa 3.jpg", "Chisa 4.png"]);
    assert_eq!(read(&chisa.join("Chisa 2.jpg")), "four");

    let undone = undo_batch(&mut log, report.batch).unwrap();
    assert_eq!(undone.len(), 2);
    assert_eq!(names(&chisa), ["Chisa 1.jpg", "Chisa 3.jpg", "Chisa 4.jpg"]);
    assert_eq!(read(&chisa.join("Chisa 4.jpg")), "four");
    assert_eq!(read(&src), "new");
}

#[test]
fn a_duplicate_goes_to_the_duplicates_folder() {
    let d = Dirs::new();
    put(&d.lib.join("Wuthering-Waves/Chisa/Chisa 1.jpg"), "same bytes");
    let src = d.dl.join("Kuchiba.Chisa.full.4511113.png");
    put(&src, "same bytes");
    let mut snap = library_snapshot(&d.lib).unwrap();
    snap.hashes.insert("h1".to_string(), "Wuthering-Waves/Chisa/Chisa 1.jpg".to_string());
    let plan = build_plan(&cfg(), &snap, &[incoming(&src, Some("h1"))]);
    let mut log = d.log();
    let report = apply(&plan, &d.lib, &mut log);
    assert!(report.error.is_none());
    assert_eq!(read(&d.lib.join("Duplicates/Kuchiba.Chisa.full.4511113.png")), "same bytes");
    assert_eq!(names(&d.lib.join("Wuthering-Waves/Chisa")), ["Chisa 1.jpg"]);
    assert_eq!(report.done[0].note, "duplicate of Wuthering-Waves/Chisa/Chisa 1.jpg");
}
