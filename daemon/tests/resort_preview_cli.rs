use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn write_image(root: &Path, relative: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, relative.as_bytes()).unwrap();
}

#[test]
fn cli_preview_counts_before_changes_and_does_not_move_files() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let base = std::env::temp_dir().join(format!("sorter-preview-{}-{nonce}", std::process::id()));
    let library = base.join("library");
    let intake = base.join("intake");
    fs::create_dir_all(&library).unwrap();
    fs::create_dir_all(&intake).unwrap();
    write_image(&library, "Wuthering-Waves/Chisa/Chisa 1.png");
    write_image(&library, "Wuthering-Waves/Chisa/Chisa manual.png");
    write_image(&library, "Wuthering-Waves/Chisa/mystery.png");
    write_image(&library, "Nature/nature wallpaper.png");

    let spec = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/tags.starter.toml");
    let config_text = fs::read_to_string(spec)
        .unwrap()
        .replace(
            "library = \"~/Pictures/Wallpapers\"",
            &format!("library = \"{}\"", library.display()),
        )
        .replace(
            "path = \"~/Downloads/pixiv\"",
            &format!("path = \"{}\"", intake.display()),
        );
    let config = base.join("config.toml");
    fs::write(&config, config_text).unwrap();

    let binary = env!("CARGO_BIN_EXE_wallpaper-sorter");
    let whole = Command::new(binary)
        .args(["--config", config.to_str().unwrap(), "--resort-preview"])
        .output()
        .unwrap();
    assert!(
        whole.status.success(),
        "{}",
        String::from_utf8_lossy(&whole.stderr)
    );
    let whole = String::from_utf8(whole.stdout).unwrap();
    let counts_at = whole.find("Counts:").expect("counts are printed");
    let changes_at = whole.find("Changes:").expect("changes section is printed");
    assert!(
        counts_at < changes_at,
        "counts must precede changes:\n{whole}"
    );
    assert!(
        whole.contains("4 images"),
        "whole-library count is included:\n{whole}"
    );
    assert!(
        whole.contains("2 moves"),
        "planned moves are counted:\n{whole}"
    );
    assert!(whole.contains("Chisa manual.png -> Wuthering-Waves/Chisa/Chisa 2.png"));
    assert!(whole.contains("nature wallpaper.png -> Nature/Nature 1.png"));

    let folder = Command::new(binary)
        .args([
            "--config",
            config.to_str().unwrap(),
            "--resort-preview",
            "--folder",
            "Wuthering-Waves/Chisa",
        ])
        .output()
        .unwrap();
    assert!(
        folder.status.success(),
        "{}",
        String::from_utf8_lossy(&folder.stderr)
    );
    let folder = String::from_utf8(folder.stdout).unwrap();
    assert!(
        folder.contains("3 images"),
        "folder scope is reported:\n{folder}"
    );
    assert!(
        folder.contains("1 move, 0 renames, 0 duplicates"),
        "singular action counts are grammatical:\n{folder}"
    );
    assert!(!folder.contains("1 moves"));
    assert!(
        !folder.contains("Nature/nature wallpaper.png"),
        "folder scope excludes other folders:\n{folder}"
    );

    assert!(library
        .join("Wuthering-Waves/Chisa/Chisa manual.png")
        .exists());
    assert!(library.join("Nature/nature wallpaper.png").exists());
    assert!(!library.join("Wuthering-Waves/Chisa/Chisa 2.png").exists());
    assert!(!library.join("Nature/Nature 1.png").exists());
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn first_run_with_library_creates_starter_config() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let base =
        std::env::temp_dir().join(format!("sorter-first-run-{}-{nonce}", std::process::id()));
    let library = base.join("Pictures/Wallpapers");
    let config = base.join("config.toml");
    fs::create_dir_all(&library).unwrap();

    let binary = env!("CARGO_BIN_EXE_wallpaper-sorter");
    let result = Command::new(binary)
        .args([
            "--config",
            config.to_str().unwrap(),
            "--library",
            library.to_str().unwrap(),
            "--once",
        ])
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(config.is_file());

    let text = fs::read_to_string(&config).unwrap();
    assert!(text.contains(&format!("library = \"{}\"", library.display())));
    fs::remove_dir_all(base).unwrap();
}
