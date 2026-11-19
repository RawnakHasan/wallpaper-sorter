//! The watcher on real folders with real inotify. Each test drives the daemon one step at a time,
//! so nothing depends on threads; the waits are short because the stability window is shortened.

use sorter_core::{Config, Intake};
use sorter_daemon::{Daemon, Notice, Options};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Dirs {
    base: PathBuf,
    lib: PathBuf,
}

impl Dirs {
    fn new() -> Dirs {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("sorter-watch-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let lib = base.join("lib");
        fs::create_dir_all(&lib).unwrap();
        Dirs { base, lib }
    }
}

impl Drop for Dirs {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn cfg(intake: Option<&Path>) -> Config {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/tags.starter.toml");
    let mut c = Config::from_toml(&fs::read_to_string(path).unwrap()).unwrap();
    c.library = None;
    c.intake = intake
        .map(|p| {
            vec![Intake {
                path: p.to_string_lossy().to_string(),
                recursive: true,
                remove_empty_folders: true,
            }]
        })
        .unwrap_or_default();
    c
}

fn fast() -> Options {
    Options {
        stable_for: Duration::from_millis(150),
        cleanup_after: Duration::from_millis(200),
        cleanup_every: Duration::from_millis(100),
    }
}

/// Steps the daemon until `cond` holds or `timeout` passes; returns whether it held.
fn pump(d: &mut Daemon, timeout: Duration, mut cond: impl FnMut() -> bool) -> bool {
    let end = Instant::now() + timeout;
    while Instant::now() < end {
        d.step(Duration::from_millis(40)).unwrap();
        if cond() {
            return true;
        }
    }
    cond()
}

const WAIT: Duration = Duration::from_secs(6);
const CHISA1: &str = "Wuthering-Waves/Chisa/Chisa 1.png";

#[test]
fn sorts_a_file_saved_in_the_library_root() {
    let t = Dirs::new();
    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    fs::write(t.lib.join("Kuchiba.Chisa.full.4511113.png"), "pixels").unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
    assert!(!t.lib.join("Kuchiba.Chisa.full.4511113.png").exists());
}

#[test]
fn sorts_a_file_moved_into_the_library_root() {
    let t = Dirs::new();
    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    let elsewhere = t.base.join("elsewhere.png");
    fs::write(&elsewhere, "pixels").unwrap();
    fs::rename(&elsewhere, t.lib.join("Chisa.png")).unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
}

#[test]
fn a_browser_download_is_sorted_only_after_the_final_rename() {
    let t = Dirs::new();
    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    let partial = t.lib.join("Chisa.png.crdownload");
    fs::write(&partial, "half").unwrap();
    pump(&mut d, Duration::from_millis(600), || false);
    assert!(partial.exists());
    assert!(!t.lib.join(CHISA1).exists());
    fs::write(&partial, "the whole file").unwrap();
    fs::rename(&partial, t.lib.join("Chisa.png")).unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
    assert_eq!(
        fs::read_to_string(t.lib.join(CHISA1)).unwrap(),
        "the whole file"
    );
}

#[test]
fn a_slow_writer_is_not_sorted_until_it_closes_the_file() {
    let t = Dirs::new();
    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    let mut f = File::create(t.lib.join("Chisa slow.png")).unwrap();
    f.write_all(b"first part ").unwrap();
    f.flush().unwrap();
    pump(&mut d, Duration::from_millis(700), || false);
    assert!(
        t.lib.join("Chisa slow.png").exists(),
        "must not be touched while it is still open"
    );
    f.write_all(b"second part").unwrap();
    drop(f);
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
    assert_eq!(
        fs::read_to_string(t.lib.join(CHISA1)).unwrap(),
        "first part second part"
    );
}

#[test]
fn files_already_waiting_at_start_are_sorted_without_any_event() {
    let t = Dirs::new();
    fs::write(t.lib.join("Chisa.png"), "pixels").unwrap();
    fs::write(t.lib.join("wallhaven-1q2le9.jpg"), "no tag").unwrap();
    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
    assert!(
        t.lib.join("wallhaven-1q2le9.jpg").exists(),
        "no match: left where it is"
    );
}

#[test]
fn folders_created_later_in_an_intake_folder_are_watched_and_cleaned_up() {
    let t = Dirs::new();
    let intake = t.base.join("pixiv");
    fs::create_dir_all(&intake).unwrap();
    let mut d = Daemon::start(t.lib.clone(), cfg(Some(&intake)), fast()).unwrap();
    let artist = intake.join("BLACKmeow-91709880");
    fs::create_dir_all(&artist).unwrap();
    fs::write(artist.join("Chisa.png"), "pixels").unwrap(); // written before the watch on the new folder exists
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
    assert!(
        pump(&mut d, WAIT, || !artist.exists()),
        "the empty artist folder is removed after a while"
    );
    assert!(intake.exists(), "the intake folder itself stays");
}

#[test]
fn deleted_and_recreated_intake_root_is_watched_again() {
    let t = Dirs::new();
    let intake = t.base.join("pixiv");
    fs::create_dir_all(&intake).unwrap();
    let mut d = Daemon::start(t.lib.clone(), cfg(Some(&intake)), fast()).unwrap();
    pump(&mut d, Duration::from_millis(250), || false);

    fs::remove_dir_all(&intake).unwrap();
    fs::create_dir_all(&intake).unwrap();
    fs::write(intake.join("Chisa.png"), "pixels").unwrap();

    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
}

#[cfg(unix)]
#[test]
fn unreadable_intake_subfolder_does_not_stop_sibling_folders() {
    use std::os::unix::fs::PermissionsExt;

    if unsafe { libc::geteuid() } == 0 {
        return;
    }
    let t = Dirs::new();
    let intake = t.base.join("pixiv");
    let blocked = intake.join("blocked");
    let available = intake.join("available");
    fs::create_dir_all(&blocked).unwrap();
    fs::create_dir_all(&available).unwrap();
    fs::write(available.join("Chisa.png"), "pixels").unwrap();
    fs::set_permissions(&blocked, fs::Permissions::from_mode(0o000)).unwrap();

    let mut d = Daemon::start(t.lib.clone(), cfg(Some(&intake)), fast()).unwrap();
    let sorted = pump(&mut d, WAIT, || t.lib.join(CHISA1).exists());
    fs::set_permissions(&blocked, fs::Permissions::from_mode(0o700)).unwrap();

    assert!(
        sorted,
        "an unreadable sibling must not abort intake scanning"
    );
}

#[test]
fn an_unsorted_intake_file_stays_where_it_is() {
    let t = Dirs::new();
    let intake = t.base.join("pixiv");
    let artist = intake.join("BLACKmeow-91709880");
    fs::create_dir_all(&artist).unwrap();
    let mut d = Daemon::start(t.lib.clone(), cfg(Some(&intake)), fast()).unwrap();
    let file = artist.join("151861634_p0--.png");
    fs::write(&file, "pixels").unwrap();
    let mut saw_left = false;
    pump(&mut d, Duration::from_secs(2), || false);
    // process once more by hand to read the report
    d.rescan();
    for n in d.step(Duration::from_millis(50)).unwrap() {
        if let Notice::Processed(o) = n {
            saw_left |= !o.report.left.is_empty();
        }
    }
    assert!(file.exists());
    assert!(
        saw_left
            || d.pipeline()
                .origins
                .all()
                .any(|o| o.path == file.to_string_lossy())
    );
    pump(&mut d, Duration::from_millis(600), || false);
    assert!(
        artist.exists(),
        "a folder that still holds a file is never removed"
    );
}

#[test]
fn an_intake_folder_that_does_not_exist_yet_is_picked_up_when_it_appears() {
    let t = Dirs::new();
    let intake = t.base.join("pixiv");
    let mut d = Daemon::start(t.lib.clone(), cfg(Some(&intake)), fast()).unwrap();
    pump(&mut d, Duration::from_millis(300), || false);
    fs::create_dir_all(intake.join("someone-1")).unwrap();
    fs::write(intake.join("someone-1/Chisa.png"), "pixels").unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
}

#[test]
fn undone_files_are_not_sorted_again_until_they_change() {
    let t = Dirs::new();
    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    let file = t.lib.join("Chisa.png");
    fs::write(&file, "pixels").unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));

    let batch = d.pipeline().log.entries().last().unwrap().batch;
    d.undo_batch(batch).unwrap();
    assert!(file.exists());
    pump(&mut d, Duration::from_millis(900), || false);
    assert!(file.exists(), "the undone file must stay put");
    assert!(!t.lib.join(CHISA1).exists());

    // a different file saved under the same name is a new download and is sorted
    fs::write(&file, "different pixels, longer").unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
}

#[test]
fn undone_files_remain_held_after_daemon_restart() {
    let t = Dirs::new();
    let file = t.lib.join("Chisa.png");
    {
        let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
        fs::write(&file, "pixels").unwrap();
        assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));

        let batch = d.pipeline().log.entries().last().unwrap().batch;
        d.undo_batch(batch).unwrap();
        assert!(file.exists());
    }

    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    pump(&mut d, Duration::from_millis(900), || false);
    assert!(file.exists(), "the undone file must stay put after restart");
    assert!(!t.lib.join(CHISA1).exists());
}

#[test]
fn undone_files_changed_after_daemon_restart_are_sorted() {
    let t = Dirs::new();
    let file = t.lib.join("Chisa.png");
    {
        let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
        fs::write(&file, "pixels").unwrap();
        assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));

        let batch = d.pipeline().log.entries().last().unwrap().batch;
        d.undo_batch(batch).unwrap();
    }

    let mut d = Daemon::start(t.lib.clone(), cfg(None), fast()).unwrap();
    fs::write(&file, "different pixels, longer").unwrap();
    assert!(pump(&mut d, WAIT, || t.lib.join(CHISA1).exists()));
}
