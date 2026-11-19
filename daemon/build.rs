use std::path::PathBuf;
use std::process::Command;

fn main() {
    let daemon_dir = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let ui_dir = daemon_dir.join("../ui");
    for path in [
        "index.html",
        "app.css",
        "core.js",
        "pages.js",
        "pages2.js",
        "main.js",
        "vite.config.js",
        "package.json",
        "package-lock.json",
        "src",
        "fonts",
    ] {
        println!("cargo:rerun-if-changed={}", ui_dir.join(path).display());
    }
    println!(
        "cargo:rerun-if-changed={}",
        ui_dir.join("node_modules/.bin").display()
    );

    let vite = ui_dir.join("node_modules/.bin/vite");
    let dist_index = daemon_dir.join("ui-dist/index.html");
    if vite.is_file() {
        let status = Command::new("npm")
            .arg("run")
            .arg("build")
            .current_dir(&ui_dir)
            .status()
            .expect("failed to start npm; install Node.js and npm to build the UI");
        if !status.success() {
            panic!("Vite UI build failed with {status}");
        }
    } else if !dist_index.is_file() {
        panic!("built UI assets are missing; run `npm --prefix ui install && npm --prefix ui run build`");
    }
}
