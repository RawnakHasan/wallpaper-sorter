//! The web API over real HTTP on 127.0.0.1, with a real library in a temporary folder.

use serde_json::{json, Value};
use sorter_core::Config;
use sorter_daemon::{serve, Daemon, Options, Thumbs};
use sorter_engine::hash_file;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Env {
    base: PathBuf,
    lib: PathBuf,
    cfg_path: PathBuf,
    thumbs: PathBuf,
    daemon: Daemon,
    port: u16,
}

impl Drop for Env {
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

/// `prep` creates files in the library (first path) and the intake folder (second) before the program starts.
fn setup(prep: impl FnOnce(&Path, &Path)) -> Env {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let base = std::env::temp_dir().join(format!("sorter-web-{}-{n}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let (lib, intake) = (base.join("lib"), base.join("pixiv"));
    fs::create_dir_all(&lib).unwrap();
    fs::create_dir_all(&intake).unwrap();
    prep(&lib, &intake);

    let starter = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../spec/tags.starter.toml")).unwrap();
    let text = starter
        .replace("library = \"~/Pictures/Wallpapers\"", &format!("library = \"{}\"", lib.display()))
        .replace("path = \"~/Downloads/pixiv\"", &format!("path = \"{}\"", intake.display()));
    let cfg_path = base.join("config.toml");
    fs::write(&cfg_path, &text).unwrap();
    let opts = Options {
        stable_for: Duration::from_millis(150),
        cleanup_after: Duration::from_secs(600),
        cleanup_every: Duration::from_secs(60),
    };
    let daemon = Daemon::start_with(lib.clone(), Config::from_toml(&text).unwrap(), opts, Some(cfg_path.clone())).unwrap();
    let thumbs = base.join("thumbs");
    let web = serve(daemon.handle(), 0, Thumbs::new(thumbs.clone())).unwrap();
    Env { base, lib, cfg_path, thumbs, daemon, port: web.port }
}

struct Reply {
    status: u16,
    content_type: String,
    head: String,
    body: Vec<u8>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| panic!("not JSON ({e}): {}", String::from_utf8_lossy(&self.body)))
    }
}

fn dechunk(mut data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let eol = data.windows(2).position(|w| w == b"\r\n").expect("chunk size line");
        let size = usize::from_str_radix(std::str::from_utf8(&data[..eol]).unwrap().trim(), 16).expect("hex chunk size");
        data = &data[eol + 2..];
        if size == 0 {
            return out;
        }
        out.extend_from_slice(&data[..size]);
        data = &data[size + 2..];
    }
}

fn http(port: u16, method: &str, path: &str, body: Option<&Value>, extra: &[(&str, &str)]) -> Reply {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(20))).unwrap();
    let has = |name: &str| extra.iter().any(|(k, _)| k.eq_ignore_ascii_case(name));
    let mut req = format!("{method} {path} HTTP/1.1\r\nConnection: close\r\n");
    if !has("Host") {
        req.push_str(&format!("Host: 127.0.0.1:{port}\r\n"));
    }
    let payload = body.map(|b| b.to_string());
    if let Some(p) = &payload {
        if !has("Content-Type") {
            req.push_str("Content-Type: application/json\r\n");
        }
        req.push_str(&format!("Content-Length: {}\r\n", p.len()));
    }
    for (k, v) in extra {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    s.write_all(req.as_bytes()).unwrap();
    if let Some(p) = payload {
        s.write_all(p.as_bytes()).unwrap();
    }
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).unwrap();
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").expect("a complete response");
    let head = String::from_utf8_lossy(&raw[..split]).to_string();
    let status = head.lines().next().unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
    let content_type = head
        .lines()
        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-type:").map(|v| v.trim().to_string()))
        .unwrap_or_default();
    let mut body = raw[split + 4..].to_vec();
    if head.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        body = dechunk(&body); // the server sends bodies over about 32 KB in chunks
    }
    Reply { status, content_type, head, body }
}

impl Env {
    fn get(&self, path: &str) -> Reply {
        http(self.port, "GET", path, None, &[])
    }
    fn send(&self, method: &str, path: &str, body: Value) -> Reply {
        http(self.port, method, path, Some(&body), &[])
    }
    fn pump(&mut self, timeout: Duration, mut cond: impl FnMut() -> bool) -> bool {
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            self.daemon.step(Duration::from_millis(40)).unwrap();
            if cond() {
                return true;
            }
        }
        cond()
    }
}

#[test]
fn status_and_the_security_checks() {
    let e = setup(|_, _| {});
    let r = e.get("/api/status");
    assert_eq!(r.status, 200);
    let v = r.json();
    assert_eq!(v["library"], e.lib.to_string_lossy().as_ref());
    assert_eq!(v["counts"]["inbox"], 0);
    assert_eq!(v["intake"][0]["exists"], true);

    // another website (or a DNS trick) must not reach it
    assert_eq!(http(e.port, "GET", "/api/status", None, &[("Host", "evil.example")]).status, 403);
    assert_eq!(http(e.port, "POST", "/api/rescan", Some(&json!({})), &[("Origin", "http://evil.example")]).status, 403);
    assert_eq!(http(e.port, "POST", "/api/rescan", Some(&json!({})), &[("Content-Type", "text/plain")]).status, 415);
    assert_eq!(http(e.port, "POST", "/api/rescan", Some(&json!({})), &[("Origin", &format!("http://127.0.0.1:{}", e.port))]).status, 200);
    assert_eq!(e.get("/api/nothing").status, 404);
    assert!(String::from_utf8_lossy(&e.get("/").body).contains("Wallpaper Sorter"));
    assert!(e.get("/design").body.len() > 100_000);
}

#[test]
fn the_inbox_assign_and_folder_views() {
    let mut e = setup(|lib, _| put(&lib.join("wallhaven-1q2le9.jpg"), "a"));
    e.pump(Duration::from_millis(500), || false); // let the startup scan look at it (no tag: stays)
    let inbox = e.get("/api/inbox").json();
    assert_eq!(inbox.as_array().unwrap().len(), 1);
    assert_eq!(inbox[0]["reason"], "no_match");
    assert_eq!(inbox[0]["origin"]["sources"][0]["site"], "Wallhaven");
    let path = inbox[0]["path"].as_str().unwrap().to_string();

    let r = e.send("POST", "/api/assign", json!({ "paths": [path], "folder": "Nature" }));
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    assert_eq!(r.json()["done"].as_array().unwrap().len(), 1);

    let folders = e.get("/api/folders").json();
    let nature = folders.as_array().unwrap().iter().find(|f| f["path"] == "Nature").unwrap();
    assert_eq!((nature["count"].clone(), nature["next_number"].clone(), nature["prefix"].clone()), (json!(1), json!(2), json!("Nature")));
    let images = e.get("/api/images?folder=Nature").json();
    assert_eq!(images[0]["name"], "Nature 1.jpg");
    assert_eq!(images[0]["origin"]["original_name"], "wallhaven-1q2le9.jpg");
    assert_eq!(e.get("/api/inbox").json().as_array().unwrap().len(), 0);

    // bad requests
    assert_eq!(e.send("POST", "/api/assign", json!({ "paths": ["/etc/passwd"], "folder": "Nature" })).status, 400);
    assert_eq!(e.send("POST", "/api/assign", json!({ "paths": ["../x.png"], "folder": "Nature" })).status, 400);
    assert_eq!(e.send("POST", "/api/assign", json!({ "paths": ["nothing.png"], "folder": "Nature" })).status, 404);
    assert_eq!(e.send("POST", "/api/assign", json!({ "paths": [], "folder": "Nature" })).status, 400);
    assert_eq!(e.get("/api/images?folder=../etc").status, 400);
}

#[test]
fn assigning_with_a_tag_saves_it_and_sorts_the_files_waiting() {
    let mut e = setup(|lib, _| {
        put(&lib.join("Violet Evergarden.jpg"), "one");
        put(&lib.join("Violet.full.1234.jpg"), "two");
    });
    e.pump(Duration::from_millis(500), || false);
    assert_eq!(e.get("/api/inbox").json().as_array().unwrap().len(), 2);
    let first = e.lib.join("Violet Evergarden.jpg").to_string_lossy().to_string();
    let r = e.send(
        "POST",
        "/api/assign",
        json!({ "paths": [first], "folder": "Series/Violet", "tag": { "keywords": ["violet"], "dest": "Series/Violet" } }),
    );
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    assert!(fs::read_to_string(&e.cfg_path).unwrap().contains("keywords = [\"violet\"]"));
    assert!(e.get("/api/tags").json().as_array().unwrap().iter().any(|t| t["dest"] == "Series/Violet"));

    // the new tag also catches the other waiting file, because the program looks again
    let lib = e.lib.clone();
    assert!(e.pump(Duration::from_secs(6), || lib.join("Series/Violet/Violet 2.jpg").exists()));
    assert!(!e.lib.join("Violet.full.1234.jpg").exists());
}

#[test]
fn the_tag_tester() {
    let e = setup(|_, _| {});
    let v = e.send("POST", "/api/tags/test", json!({ "filename": "Chisa waterfall.png" })).json();
    assert_eq!((v["dest"].clone(), v["rule"].clone()), (json!("Wuthering-Waves/Chisa"), json!("Specific beats generic")));
    assert_eq!(v["new_name"], "Chisa 1.png");
    assert_eq!(v["words"], json!(["chisa", "waterfall"]));
    let v = e.send("POST", "/api/tags/test", json!({ "filename": "Chisa Skadi.png" })).json();
    assert_eq!((v["dest"].clone(), v["rule"].clone()), (json!("INBOX"), json!("Conflict")));
    assert!(v["new_name"].is_null());
    let v = e.send("POST", "/api/tags/test", json!({ "filename": "Konachan.com - 999996 solo long_hair dress sky clouds waterfall.jpg" })).json();
    assert_eq!(v["rule"], "No match");
    assert!(v["ignored"].as_str().unwrap().contains("generic ignored"));
}

#[test]
fn tags_can_be_added_changed_and_removed() {
    let e = setup(|_, _| {});
    let before = e.get("/api/tags").json().as_array().unwrap().len();
    let r = e.send("POST", "/api/tags", json!({ "keywords": ["lumi"], "dest": "Originals/Lumi", "prefix": "Lumi" }));
    assert_eq!(r.status, 200);
    let tags = r.json();
    assert_eq!(tags.as_array().unwrap().len(), before + 1);
    let idx = tags.as_array().unwrap().iter().position(|t| t["dest"] == "Originals/Lumi").unwrap();
    assert_eq!(tags[idx]["effective_prefix"], "Lumi");

    let r = e.send("PUT", &format!("/api/tags/{idx}"), json!({ "keywords": ["lumi", "lumina"], "dest": "Originals/Lumi", "generic": false }));
    assert_eq!(r.status, 200);
    assert_eq!(r.json()[idx]["keywords"], json!(["lumi", "lumina"]));
    assert_eq!(r.json()[idx]["effective_prefix"], "Lumi", "folder name, now that the prefix was cleared");

    let r = http(e.port, "DELETE", &format!("/api/tags/{idx}"), Some(&json!({})), &[]);
    assert_eq!(r.status, 200);
    assert_eq!(r.json().as_array().unwrap().len(), before);

    assert_eq!(e.send("POST", "/api/tags", json!({ "keywords": ["x"], "dest": "../escape" })).status, 400);
    assert_eq!(e.send("POST", "/api/tags", json!({ "keywords": [], "dest": "Fine" })).status, 400);
    assert_eq!(e.send("PUT", "/api/tags/99999", json!({ "keywords": ["x"], "dest": "Fine" })).status, 400);
    assert!(fs::read_to_string(&e.cfg_path).unwrap().contains("# ---------- Wuthering Waves ----------"), "comments in the config survive");
}

#[test]
fn delete_and_undo_through_the_api() {
    let e = setup(|lib, _| put(&lib.join("Nature/Nature 1.png"), "a"));
    let r = e.send("POST", "/api/delete", json!({ "paths": ["Nature/Nature 1.png"] }));
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let batch = r.json()["batch"].as_u64().unwrap();
    assert!(!e.lib.join("Nature/Nature 1.png").exists());

    let act = e.get("/api/activity").json();
    assert_eq!(act[0]["undoable"], true);
    assert_eq!(act[0]["kind"], "move");
    assert_eq!(e.send("POST", "/api/undo", json!({ "batch": batch })).status, 200);
    assert!(e.lib.join("Nature/Nature 1.png").exists());
    let act = e.get("/api/activity").json();
    assert_eq!(act[0]["kind"], "undo");
    assert_eq!(act[1]["undone"], true);
    assert_eq!(act[1]["undoable"], false);

    let id = act[1]["id"].as_u64().unwrap();
    assert_eq!(e.send("POST", "/api/undo", json!({ "id": id })).status, 409, "already undone");
    assert_eq!(e.send("POST", "/api/undo", json!({ "id": 9999 })).status, 404);
    assert_eq!(e.send("POST", "/api/undo", json!({})).status, 400);
}

#[test]
fn thumbnails_are_cached_by_hash_and_survive_a_move() {
    let mut image_path = PathBuf::new();
    let e = setup(|lib, _| {
        image_path = lib.join("Nature/Nature 1.png");
        fs::create_dir_all(image_path.parent().unwrap()).unwrap();
        image::RgbImage::from_fn(800, 400, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 90])).save(&image_path).unwrap();
    });
    let hash = hash_file(&image_path).unwrap();
    let r = e.get(&format!("/api/thumb/{hash}"));
    assert_eq!((r.status, r.content_type.as_str()), (200, "image/jpeg"));
    assert_eq!(&r.body[..2], &[0xFF, 0xD8]);
    let img = image::load_from_memory(&r.body).unwrap();
    assert_eq!((img.width(), img.height()), (400, 200));
    assert!(e.thumbs.join(format!("{hash}.jpg")).exists());

    // move the image: same hash, so the cached thumbnail is reused, nothing new is drawn
    let r = e.send("POST", "/api/assign", json!({ "paths": ["Nature/Nature 1.png"], "folder": "Elsewhere" }));
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    assert_eq!(e.get(&format!("/api/thumb/{hash}")).status, 200);
    assert_eq!(fs::read_dir(&e.thumbs).unwrap().count(), 1);

    let full = e.get(&format!("/api/image/{hash}"));
    assert_eq!((full.status, full.content_type.as_str()), (200, "image/png"));
    assert_eq!(&full.body[..4], b"\x89PNG");
    assert_eq!(e.get("/api/thumb/not-a-hash").status, 400);
    assert_eq!(e.get(&format!("/api/thumb/{}", "0".repeat(64))).status, 404);
}

#[test]
fn the_data_view_filters() {
    let e = setup(|lib, _| {
        put(&lib.join("wallhaven-1q2le9.jpg"), "w");
        put(&lib.join("Arknights/Skadi/Skadi 1.png"), "s");
        put(&lib.join("Wuthering-Waves/Chisa/Chisa 1.png"), "c");
    });
    let all = e.get("/api/data").json();
    assert_eq!(all["total"], 3);
    assert_eq!(e.get("/api/data?site=Wallhaven").json()["total"], 1);
    assert_eq!(e.get("/api/data?site=wallhaven").json()["total"], 1);
    assert_eq!(e.get("/api/data?unknown=1").json()["total"], 2);
    assert_eq!(e.get("/api/data?q=1q2le9").json()["total"], 1);
    assert_eq!(e.get("/api/data?q=SKADI").json()["total"], 1);
    assert_eq!(e.get("/api/data?folder=Arknights").json()["total"], 1);
    assert_eq!(e.get("/api/data?folder=Wuthering-Waves").json()["total"], 1);
    let page = e.get("/api/data?limit=2&offset=1").json();
    assert_eq!((page["total"].clone(), page["items"].as_array().unwrap().len()), (json!(3), 2));
    let one = &e.get("/api/data?site=Wallhaven").json()["items"][0];
    assert_eq!(one["sources"][0]["url"], "https://wallhaven.cc/w/1q2le9");
    assert_eq!((one["name"].clone(), one["folder"].clone()), (json!("wallhaven-1q2le9.jpg"), json!("")));
}

#[test]
fn duplicates_can_be_listed_and_emptied() {
    let mut e = setup(|lib, _| {
        put(&lib.join("Wuthering-Waves/Chisa/Chisa 1.png"), "same");
        put(&lib.join("Chisa copy.png"), "same");
    });
    let lib = e.lib.clone();
    assert!(e.pump(Duration::from_secs(6), || lib.join("Duplicates/Chisa copy.png").exists()));
    let dups = e.get("/api/duplicates").json();
    assert_eq!(dups.as_array().unwrap().len(), 1);
    assert_eq!(dups[0]["duplicate_of"], "Wuthering-Waves/Chisa/Chisa 1.png");
    assert_eq!(e.get("/api/status").json()["counts"]["duplicates"], 1);

    assert_eq!(e.send("POST", "/api/duplicates/empty", json!({})).status, 200);
    assert_eq!(e.get("/api/duplicates").json().as_array().unwrap().len(), 0);
    assert_eq!(e.send("POST", "/api/trash/empty", json!({})).json()["removed"], 1);
    assert!(!e.lib.join(".sorter/trash").exists());
}

#[test]
fn closing_gaps_previews_then_applies() {
    let e = setup(|lib, _| {
        for n in [1, 3, 4] {
            put(&lib.join(format!("Wuthering-Waves/Chisa/Chisa {n}.png")), &n.to_string());
        }
    });
    let preview = e.get("/api/gap-fill?folder=Wuthering-Waves/Chisa&mode=last").json();
    assert_eq!(preview, json!([{ "from": "Chisa 4.png", "to": "Chisa 2.png" }]));
    assert!(e.lib.join("Wuthering-Waves/Chisa/Chisa 4.png").exists(), "a preview changes nothing");
    assert_eq!(e.get("/api/gap-fill?folder=Wuthering-Waves/Chisa&mode=bogus").status, 400);

    let r = e.send("POST", "/api/gap-fill", json!({ "folder": "Wuthering-Waves/Chisa", "mode": "last" }));
    assert_eq!(r.status, 200);
    let names: Vec<String> = e.get("/api/images?folder=Wuthering-Waves/Chisa").json().as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, ["Chisa 1.png", "Chisa 2.png", "Chisa 3.png"]);
}

#[test]
fn a_source_can_be_set_by_hand_and_the_gap_mode_changed() {
    let mut hash = String::new();
    let e = setup(|lib, _| {
        put(&lib.join("mystery.png"), "m");
        hash = hash_file(&lib.join("mystery.png")).unwrap();
    });
    assert_eq!(e.get("/api/data?unknown=1").json()["total"], 1);
    assert_eq!(e.send("PUT", "/api/origins", json!({ "hash": hash, "site": "Wallhaven", "id": "abc123" })).status, 200);
    let v = e.get("/api/data?q=abc123").json();
    assert_eq!(v["total"], 1);
    assert_eq!(v["items"][0]["sources"][0]["url"], "https://wallhaven.cc/w/abc123");
    assert_eq!(e.get("/api/data?unknown=1").json()["total"], 0);
    assert_eq!(e.send("PUT", "/api/origins", json!({ "hash": hash, "site": "Nowhere", "id": "1" })).status, 400);
    assert_eq!(e.send("PUT", "/api/origins", json!({ "hash": "f".repeat(64), "site": "Pixiv", "id": "1" })).status, 404);

    assert_eq!(e.get("/api/settings").json()["gap_mode"], "keep");
    assert_eq!(e.send("PUT", "/api/settings", json!({ "gap_mode": "last" })).json()["gap_mode"], "last");
    assert_eq!(e.send("PUT", "/api/settings", json!({ "gap_mode": "nonsense" })).status, 400);
    assert!(fs::read_to_string(&e.cfg_path).unwrap().contains("gap_mode = \"last\""));
}

#[test]
fn the_page_and_its_files_are_served_with_a_strict_policy() {
    let e = setup(|_, _| {});
    let page = e.get("/");
    assert_eq!((page.status, page.content_type.as_str()), (200, "text/html; charset=utf-8"));
    let text = String::from_utf8_lossy(&page.body).to_string();
    assert!(text.contains("<div id=\"app\">") && text.contains("/main.js"));
    assert!(page.head.contains("Content-Security-Policy: default-src 'self'"), "{}", page.head);
    assert!(page.head.contains("frame-ancestors 'none'"));
    for (path, kind) in [("/app.css", "text/css"), ("/core.js", "text/javascript"), ("/pages.js", "text/javascript"), ("/pages2.js", "text/javascript"), ("/main.js", "text/javascript"), ("/fonts/hanken-grotesk.woff2", "font/woff2"), ("/fonts/jetbrains-mono.woff2", "font/woff2")] {
        let r = e.get(path);
        assert_eq!(r.status, 200, "{path}");
        assert!(r.content_type.starts_with(kind), "{path}: {}", r.content_type);
        assert!(r.body.len() > 500, "{path}");
        assert!(r.head.contains("Content-Security-Policy"), "{path}");
    }
    assert_eq!(&e.get("/fonts/hanken-grotesk.woff2").body[..4], b"wOF2");
    assert_eq!(e.get("/fonts/other.woff2").status, 404);
    // the status carries a number that changes whenever something is logged, so the page knows to refresh
    assert_eq!(e.get("/api/status").json()["activity_last_id"], 0);
}
