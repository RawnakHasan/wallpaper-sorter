//! The small web server: the JSON API the UI talks to, images and thumbnails, and a placeholder page.
//! It listens on 127.0.0.1 only, and refuses requests that did not come from a page served by itself.

use crate::daemon::{ConfigUndoKind, Shared};
use crate::fetch::{validate_lookup_source, FetchJob, FetchManager, FetchRequest};
use crate::git;
use crate::secrets::{self, SecretsUpdate};
use crate::thumbs::Thumbs;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sorter_core::matcher::{split_name, tokens};
use sorter_core::{
    classify, expand_home, Action, Dest, GapMode, LeaveReason, Plan, Site, WALLPAPER_PATH_ARGUMENT,
};
use sorter_engine::cfgedit::{
    add_folder, add_intake, add_tag, delete_tag_checked, merge_folder as edit_merge_folder,
    remove_intake, rename_folder as edit_rename_folder, set_fetch_ratings, set_folder_prefix,
    set_gap_mode, set_setup_complete, set_wallpaper_apply, set_zerochan_preferences, update_intake,
    update_tag_checked, validate_tag, TagSpec,
};
use sorter_engine::{Kind, Origin, Outcome, UndoError};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server};

const INDEX_HTML: &str = include_str!("../ui-dist/index.html");
const APP_CSS: &[u8] = include_bytes!("../ui-dist/assets/app.css");
const APP_JS: &[u8] = include_bytes!("../ui-dist/assets/app.js");
const FONT_TEXT: &[u8] = include_bytes!("../ui-dist/assets/hanken-grotesk.woff2");
const FONT_MONO: &[u8] = include_bytes!("../ui-dist/assets/jetbrains-mono.woff2");

/// The page may load only its own files, talk only to this server, and not be framed.
const PAGE_CSP: &str = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

pub struct WebServer {
    pub port: u16,
}

struct Ctx {
    shared: Arc<Shared>,
    thumbs: Thumbs,
    port: u16,
    fetch: FetchManager,
    secrets_path: Option<PathBuf>,
}

/// Starts the server on 127.0.0.1:`port` (0 picks a free port) in background threads.
pub fn serve(shared: Arc<Shared>, port: u16, thumbs: Thumbs) -> io::Result<WebServer> {
    let server = Server::http(("127.0.0.1", port))
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .unwrap_or(port);
    let server = Arc::new(server);
    let secrets_path = shared
        .config_path
        .as_deref()
        .and_then(Path::parent)
        .map(|parent| parent.join("secrets.toml"));
    let ctx = Arc::new(Ctx {
        shared,
        thumbs,
        port,
        fetch: FetchManager::default(),
        secrets_path,
    });
    for _ in 0..6 {
        let (server, ctx) = (server.clone(), ctx.clone());
        std::thread::spawn(move || {
            while let Ok(req) = server.recv() {
                handle(&ctx, req);
            }
        });
    }
    Ok(WebServer { port })
}

struct Resp {
    status: u16,
    content_type: &'static str,
    cache: &'static str,
    csp: Option<&'static str>,
    retry_after: Option<u32>,
    body: Vec<u8>,
}

impl Resp {
    fn json(status: u16, v: &impl Serialize) -> Resp {
        Resp {
            status,
            content_type: "application/json",
            cache: "no-store",
            csp: None,
            retry_after: None,
            body: serde_json::to_vec(v).unwrap_or_default(),
        }
    }
    /// A file of the UI itself.
    fn asset(content_type: &'static str, body: &'static [u8], cache: &'static str) -> Resp {
        Resp {
            status: 200,
            content_type,
            cache,
            csp: Some(PAGE_CSP),
            retry_after: None,
            body: body.to_vec(),
        }
    }
    fn image(content_type: &'static str, body: Vec<u8>) -> Resp {
        Resp {
            status: 200,
            content_type,
            cache: "public, max-age=31536000, immutable",
            csp: None,
            retry_after: None,
            body,
        }
    }
}

struct ApiError {
    status: u16,
    msg: String,
    retry_after: Option<u32>,
}

impl ApiError {
    fn new(status: u16, msg: impl Into<String>) -> ApiError {
        ApiError {
            status,
            msg: msg.into(),
            retry_after: None,
        }
    }
}

impl From<io::Error> for ApiError {
    fn from(e: io::Error) -> ApiError {
        let status = match e.kind() {
            io::ErrorKind::InvalidInput | io::ErrorKind::InvalidData => 400,
            io::ErrorKind::NotFound => 404,
            io::ErrorKind::AlreadyExists => 409,
            io::ErrorKind::WouldBlock => 503,
            io::ErrorKind::Unsupported => 415,
            _ => 500,
        };
        if status == 503 {
            ApiError {
                status,
                msg: e.to_string(),
                retry_after: Some(1),
            }
        } else {
            ApiError::new(status, e.to_string())
        }
    }
}

impl From<UndoError> for ApiError {
    fn from(e: UndoError) -> ApiError {
        let status = match e {
            UndoError::NotFound(_) => 404,
            UndoError::AlreadyUndone(_)
            | UndoError::NotUndoable(_)
            | UndoError::ConfigChangedAfterFolderChange
            | UndoError::FileMovedSince(_) => 409,
            _ => 500,
        };
        ApiError::new(status, e.to_string())
    }
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes().to_vec(), value.as_bytes().to_vec()).expect("valid header")
}

fn handle(ctx: &Ctx, mut req: Request) {
    let resp =
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| route(ctx, &mut req))) {
            Ok(result) => result,
            Err(_) => {
                eprintln!("wallpaper-sorter: web handler panicked");
                Err(ApiError::new(500, "internal server error"))
            }
        }
        .unwrap_or_else(|e| {
            let mut resp = Resp::json(e.status, &json!({ "error": e.msg }));
            resp.retry_after = e.retry_after;
            resp
        });
    let mut r = Response::from_data(resp.body).with_status_code(resp.status);
    r.add_header(header("Content-Type", resp.content_type));
    r.add_header(header("Cache-Control", resp.cache));
    r.add_header(header("X-Content-Type-Options", "nosniff"));
    if let Some(csp) = resp.csp {
        r.add_header(header("Content-Security-Policy", csp));
    }
    if let Some(retry_after) = resp.retry_after {
        r.add_header(header("Retry-After", &retry_after.to_string()));
    }
    let _ = req.respond(r);
}

fn header_value(req: &Request, name: &str) -> Option<String> {
    req.headers()
        .iter()
        .find(|h| h.field.to_string().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

/// Only pages served from this very address may talk to the API. This keeps other websites (and DNS tricks)
/// from reaching it through the browser.
fn check_request(ctx: &Ctx, req: &Request) -> Result<(), ApiError> {
    let hosts = [
        format!("127.0.0.1:{}", ctx.port),
        format!("localhost:{}", ctx.port),
    ];
    if !header_value(req, "Host").map_or(false, |h| hosts.contains(&h)) {
        return Err(ApiError::new(403, "unexpected Host header"));
    }
    if matches!(req.method(), Method::Get | Method::Head) {
        if header_value(req, "Sec-Fetch-Site").as_deref() == Some("cross-site") {
            return Err(ApiError::new(403, "cross-site requests are not allowed"));
        }
        return Ok(());
    }
    if let Some(origin) = header_value(req, "Origin") {
        if !hosts.iter().any(|h| origin == format!("http://{h}")) {
            return Err(ApiError::new(403, "unexpected Origin"));
        }
    }
    if !header_value(req, "Content-Type").map_or(false, |c| c.starts_with("application/json")) {
        return Err(ApiError::new(
            415,
            "send JSON with Content-Type: application/json",
        ));
    }
    Ok(())
}

fn percent_decode(s: &str, plus_is_space: bool) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                let hex = std::str::from_utf8(&b[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok());
                match hex {
                    Some(v) => {
                        out.push(v);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' if plus_is_space => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn split_url(url: &str) -> (Vec<String>, HashMap<String, String>) {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let segs = path
        .trim_matches('/')
        .split('/')
        .map(|s| percent_decode(s, false))
        .collect();
    let q = query
        .split('&')
        .filter(|s| !s.is_empty())
        .map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            (percent_decode(k, true), percent_decode(v, true))
        })
        .collect();
    (segs, q)
}

fn read_json<T: DeserializeOwned>(req: &mut Request) -> Result<T, ApiError> {
    let mut buf = Vec::new();
    req.as_reader()
        .take(2_000_001)
        .read_to_end(&mut buf)
        .map_err(|e| ApiError::new(400, e.to_string()))?;
    if buf.len() > 2_000_000 {
        return Err(ApiError::new(413, "JSON body is too large"));
    }
    serde_json::from_slice(&buf).map_err(|e| ApiError::new(400, format!("bad JSON: {e}")))
}

#[derive(Deserialize)]
struct PathsBody {
    paths: Vec<String>,
}
#[derive(Deserialize)]
struct AssignBody {
    paths: Vec<String>,
    folder: String,
    #[serde(default)]
    tag: Option<TagSpec>,
}
#[derive(Deserialize)]
struct DeleteTagBody {
    #[serde(default)]
    expected_keywords: Option<Vec<String>>,
    #[serde(default)]
    expected_dest: Option<String>,
}
#[derive(Deserialize)]
struct UndoBody {
    #[serde(default)]
    batch: Option<u64>,
    #[serde(default)]
    id: Option<u64>,
}
#[derive(Deserialize)]
struct GapBody {
    folder: String,
    mode: String,
}
#[derive(Deserialize)]
struct OriginBody {
    hash: String,
    site: String,
    id: String,
}
#[derive(Deserialize)]
struct OriginLookupBody {
    hash: String,
    site: String,
    id: String,
}
#[derive(Deserialize)]
struct ApplyWallpaperBody {
    hash: String,
}
#[derive(Deserialize)]
struct SettingsBody {
    #[serde(default)]
    gap_mode: Option<String>,
    #[serde(default)]
    setup_complete: Option<bool>,
    #[serde(default)]
    danbooru_rating: Option<String>,
    #[serde(default)]
    wallhaven_purity: Option<String>,
    #[serde(default)]
    yandere_rating: Option<String>,
    #[serde(default)]
    safebooru_rating: Option<String>,
    #[serde(default)]
    konachan_rating: Option<String>,
    #[serde(default)]
    zerochan_username: Option<String>,
    #[serde(default)]
    warn_before_unrated_sites: Option<bool>,
    #[serde(default)]
    wallpaper_apply_script: Option<String>,
    #[serde(default)]
    wallpaper_apply_args: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct GitCommitBody {
    repository: String,
    paths: Vec<String>,
    message: String,
}
#[derive(Deserialize)]
struct GitPushBody {
    repository: String,
    remote: String,
    branch: String,
}
#[derive(Deserialize)]
struct FetchBody {
    items: Vec<FetchRequest>,
}
#[derive(Deserialize)]
struct TestBody {
    filename: String,
}
#[derive(Deserialize)]
struct ResortBody {
    #[serde(default)]
    folder: Option<String>,
}
#[derive(Deserialize)]
struct FolderBody {
    folder: String,
}
#[derive(Deserialize)]
struct FolderChangeBody {
    from: String,
    to: String,
}
#[derive(Deserialize)]
struct FolderPrefixBody {
    folder: String,
    prefix: String,
}
#[derive(Deserialize)]
struct RestoreDuplicatesBody {
    paths: Vec<String>,
    folder: String,
}
#[derive(Deserialize)]
struct IntakeBody {
    path: String,
    #[serde(default = "default_recursive")]
    recursive: bool,
    #[serde(default)]
    remove_empty_folders: bool,
}

fn default_recursive() -> bool {
    true
}

fn route(ctx: &Ctx, req: &mut Request) -> Result<Resp, ApiError> {
    check_request(ctx, req)?;
    let method = req.method().clone();
    let (segs, query) = split_url(req.url());
    let segs: Vec<&str> = segs.iter().map(|s| s.as_str()).collect();
    match (method, segs.as_slice()) {
        (Method::Get, [""]) => Ok(Resp::asset(
            "text/html; charset=utf-8",
            INDEX_HTML.as_bytes(),
            "no-cache",
        )),
        (Method::Get, ["assets", "app.css"]) => {
            Ok(Resp::asset("text/css; charset=utf-8", APP_CSS, "no-cache"))
        }
        (Method::Get, ["assets", "app.js"]) => Ok(Resp::asset(
            "text/javascript; charset=utf-8",
            APP_JS,
            "no-cache",
        )),
        (Method::Get, ["assets", "hanken-grotesk.woff2"]) => Ok(Resp::asset(
            "font/woff2",
            FONT_TEXT,
            "public, max-age=86400",
        )),
        (Method::Get, ["assets", "jetbrains-mono.woff2"]) => Ok(Resp::asset(
            "font/woff2",
            FONT_MONO,
            "public, max-age=86400",
        )),
        (Method::Get, [first, ..]) if *first != "api" && *first != "assets" => Ok(Resp::asset(
            "text/html; charset=utf-8",
            INDEX_HTML.as_bytes(),
            "no-cache",
        )),
        (Method::Get, ["api", "status"]) => status(ctx),
        (Method::Get, ["api", "inbox"]) => Ok(Resp::json(200, &ctx.shared.lock().inbox()?)),
        (Method::Get, ["api", "folders"]) => Ok(Resp::json(200, &ctx.shared.lock().folders()?)),
        (Method::Get, ["api", "images"]) => {
            let folder = query
                .get("folder")
                .ok_or_else(|| ApiError::new(400, "folder is required"))?;
            Ok(Resp::json(200, &ctx.shared.lock().images(folder)?))
        }
        (Method::Get, ["api", "duplicates"]) => {
            Ok(Resp::json(200, &ctx.shared.lock().duplicates()?))
        }
        (Method::Get, ["api", "data"]) => data(ctx, &query),
        (Method::Get, ["api", "activity"]) => activity(ctx, &query),
        (Method::Get, ["api", "tags"]) => Ok(Resp::json(200, &tags_json(ctx))),
        (Method::Get, ["api", "settings"]) => {
            let settings = ctx.shared.lock().cfg.settings.clone();
            Ok(Resp::json(200, &public_settings(&settings)?))
        }
        (Method::Get, ["api", "search"]) => {
            let secrets_path = ctx
                .secrets_path
                .as_deref()
                .ok_or_else(|| ApiError::new(503, "site search requires a saved config file"))?;
            let site = query
                .get("site")
                .ok_or_else(|| ApiError::new(400, "site is required"))?;
            if !matches!(
                site.as_str(),
                "Wallhaven" | "Danbooru" | "yande.re" | "Safebooru" | "Konachan.net"
            ) {
                return Err(ApiError::new(400, "choose a supported site"));
            }
            let search_query = query.get("q").map(String::as_str).unwrap_or_default();
            let page = query
                .get("page")
                .map(|page| page.parse::<u32>())
                .transpose()
                .map_err(|_| ApiError::new(400, "page must be a positive number"))?
                .unwrap_or(1);
            if !(1..=100).contains(&page) {
                return Err(ApiError::new(400, "page must be between 1 and 100"));
            }
            if search_query.len() > 300 {
                return Err(ApiError::new(
                    400,
                    "search query must be 300 characters or fewer",
                ));
            }
            let result = ctx
                .fetch
                .search(ctx.shared.clone(), secrets_path, site, search_query, page)
                .map_err(|error| ApiError::new(502, error))?;
            Ok(Resp::json(200, &result))
        }
        (Method::Get, ["api", "search", "details"]) => {
            let secrets_path = ctx
                .secrets_path
                .as_deref()
                .ok_or_else(|| ApiError::new(503, "site search requires a saved config file"))?;
            let site = query
                .get("site")
                .ok_or_else(|| ApiError::new(400, "site is required"))?;
            let id = query
                .get("id")
                .ok_or_else(|| ApiError::new(400, "post ID is required"))?;
            let details = ctx
                .fetch
                .search_details(ctx.shared.clone(), secrets_path, site, id)
                .map_err(|error| ApiError::new(502, error))?;
            Ok(Resp::json(200, &details))
        }
        (Method::Get, ["api", "search", "preview", token]) => {
            let secrets_path = ctx
                .secrets_path
                .as_deref()
                .ok_or_else(|| ApiError::new(503, "site previews require a saved config file"))?;
            let bytes = ctx
                .fetch
                .preview(token, secrets_path, &ctx.thumbs)
                .map_err(|error| ApiError::new(502, error))?
                .ok_or_else(|| ApiError::new(404, "search preview not found"))?;
            Ok(Resp::image("image/jpeg", bytes))
        }
        (Method::Get, ["api", "secrets"]) => {
            let path = ctx
                .secrets_path
                .as_deref()
                .ok_or_else(|| ApiError::new(503, "secrets require a saved config file"))?;
            let status = secrets::status(path).map_err(|error| ApiError::new(500, error))?;
            Ok(Resp::json(200, &status))
        }
        (Method::Get, ["api", "git", "status"]) => {
            let repository = query
                .get("repo")
                .ok_or_else(|| ApiError::new(400, "repository is required"))?;
            let status = git::status(repository).map_err(|error| ApiError::new(400, error))?;
            Ok(Resp::json(200, &status))
        }
        (Method::Get, ["api", "git", "log"]) => {
            let repository = query
                .get("repo")
                .ok_or_else(|| ApiError::new(400, "repository is required"))?;
            let limit = query
                .get("limit")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(300);
            let log = git::log(repository, limit).map_err(|error| ApiError::new(400, error))?;
            Ok(Resp::json(200, &json!({ "items": log })))
        }
        (Method::Post, ["api", "git", "commit"]) => {
            let body: GitCommitBody = read_json(req)?;
            let result = git::commit(&body.repository, &body.paths, &body.message)
                .map_err(|error| ApiError::new(400, error))?;
            Ok(Resp::json(200, &result))
        }
        (Method::Post, ["api", "git", "push"]) => {
            let body: GitPushBody = read_json(req)?;
            let result = git::push(&body.repository, &body.remote, &body.branch)
                .map_err(|error| ApiError::new(400, error))?;
            Ok(Resp::json(200, &result))
        }
        (Method::Put, ["api", "secrets"]) => {
            let path = ctx
                .secrets_path
                .as_deref()
                .ok_or_else(|| ApiError::new(503, "secrets require a saved config file"))?;
            let update: SecretsUpdate = read_json(req)?;
            let status =
                secrets::update(path, update).map_err(|error| ApiError::new(400, error))?;
            Ok(Resp::json(200, &status))
        }
        (Method::Post, ["api", "fetch"]) => {
            let path = ctx
                .secrets_path
                .clone()
                .ok_or_else(|| ApiError::new(503, "fetch requires a saved config file"))?;
            let body: FetchBody = read_json(req)?;
            let job = ctx
                .fetch
                .submit(ctx.shared.clone(), path, body.items)
                .map_err(|error| ApiError::new(400, error))?;
            Ok(Resp::json(202, &job))
        }
        (Method::Post, ["api", "apply-wallpaper"]) => {
            let body: ApplyWallpaperBody = read_json(req)?;
            apply_wallpaper(ctx, body)
        }
        (Method::Get, ["api", "fetch", job_id]) => {
            let id = job_id
                .parse::<u64>()
                .map_err(|_| ApiError::new(400, "invalid fetch job ID"))?;
            let job: FetchJob = ctx
                .fetch
                .get(id)
                .ok_or_else(|| ApiError::new(404, "fetch job not found"))?;
            Ok(Resp::json(200, &job))
        }
        (Method::Get, ["api", "gap-fill"]) => {
            let folder = query
                .get("folder")
                .ok_or_else(|| ApiError::new(400, "folder is required"))?;
            let mode = parse_mode(query.get("mode").map(|s| s.as_str()).unwrap_or(""))?;
            let renames = ctx.shared.lock().gap_fill_preview(folder, mode)?;
            Ok(Resp::json(
                200,
                &renames
                    .iter()
                    .map(|r| json!({ "from": r.from, "to": r.to }))
                    .collect::<Vec<_>>(),
            ))
        }
        (Method::Get, ["api", "resort"]) => {
            let folder = query
                .get("folder")
                .filter(|s| !s.is_empty())
                .map(String::as_str);
            let plan = ctx.shared.lock().resort_preview(folder)?;
            Ok(Resp::json(200, &resort_json(&plan)))
        }
        (Method::Get, ["api", "folder-rename"]) => {
            let from = query
                .get("from")
                .ok_or_else(|| ApiError::new(400, "from is required"))?;
            let to = query
                .get("to")
                .ok_or_else(|| ApiError::new(400, "to is required"))?;
            let plan = ctx.shared.lock().rename_folder_preview(from, to)?;
            Ok(Resp::json(200, &resort_json(&plan)))
        }
        (Method::Get, ["api", "folder-merge"]) => {
            let from = query
                .get("from")
                .ok_or_else(|| ApiError::new(400, "from is required"))?;
            let to = query
                .get("to")
                .ok_or_else(|| ApiError::new(400, "to is required"))?;
            let plan = ctx.shared.lock().merge_folder_preview(from, to)?;
            Ok(Resp::json(200, &resort_json(&plan)))
        }
        (Method::Get, ["api", "folder-prefix"]) => {
            let folder = query
                .get("folder")
                .ok_or_else(|| ApiError::new(400, "folder is required"))?;
            let prefix = query
                .get("prefix")
                .ok_or_else(|| ApiError::new(400, "prefix is required"))?;
            let plan = ctx.shared.lock().prefix_change_preview(folder, prefix)?;
            Ok(Resp::json(200, &resort_json(&plan)))
        }
        (Method::Get, ["api", "thumb", hash]) => {
            let src = image_source(ctx, hash)?;
            Ok(Resp::image("image/jpeg", ctx.thumbs.get(hash, &src)?))
        }
        (Method::Post, ["api", "thumb", hash, "refresh"]) => {
            let src = image_source(ctx, hash)?;
            ctx.thumbs.refresh(hash, &src)?;
            Ok(Resp::json(200, &json!({ "refreshed": true })))
        }
        (Method::Get, ["api", "image", hash]) => {
            let src = image_source(ctx, hash)?;
            Ok(Resp::image(content_type_for(&src), std::fs::read(&src)?))
        }

        (Method::Post, ["api", "assign"]) => {
            let b: AssignBody = read_json(req)?;
            if let Some(spec) = &b.tag {
                validate_tag(spec).map_err(|e| ApiError::new(400, e))?;
            }
            let out = {
                let mut p = ctx.shared.lock();
                let files = resolve_all(&p, &b.paths)?;
                p.assign(&files, &b.folder)?
            };
            let mut response = outcome_json(&out);
            if let Some(spec) = b.tag {
                ctx.shared
                    .edit_config(|t| add_tag(t, &spec))
                    .map_err(|e| ApiError::new(400, e))?;
                let additional = {
                    let mut pipeline = ctx.shared.lock();
                    match pipeline.inbox() {
                        Ok(items) => {
                            let ready: Vec<PathBuf> = items
                                .into_iter()
                                .filter(|item| item.reason == "ready")
                                .map(|item| PathBuf::from(item.path))
                                .collect();
                            if ready.is_empty() {
                                Ok(None)
                            } else {
                                pipeline.process(&ready).map(Some)
                            }
                        }
                        Err(error) => Err(error),
                    }
                };
                let (sorted, batch, error) = match additional {
                    Ok(Some(result)) => (
                        result
                            .report
                            .done
                            .iter()
                            .filter(|entry| entry.kind == Kind::Move)
                            .count(),
                        (!result.report.done.is_empty()).then_some(result.report.batch),
                        result.report.error.map(|error| error.to_string()),
                    ),
                    Ok(None) => (0, None, None),
                    Err(error) => (0, None, Some(error.to_string())),
                };
                response["additional_sorted"] = json!(sorted);
                response["additional_batch"] = json!(batch);
                response["additional_error"] = json!(error);
                ctx.shared.request_rescan();
            }
            Ok(Resp::json(200, &response))
        }
        (Method::Post, ["api", "delete"]) => {
            let b: PathsBody = read_json(req)?;
            let mut p = ctx.shared.lock();
            let files = resolve_all(&p, &b.paths)?;
            let out = p.delete(&files)?;
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Post, ["api", "undo"]) => {
            let b: UndoBody = read_json(req)?;
            let entries = match (b.batch, b.id) {
                (Some(batch), None) => ctx.shared.undo_batch(batch)?,
                (None, Some(id)) => vec![ctx.shared.undo_entry(id)?],
                _ => return Err(ApiError::new(400, "send either batch or id")),
            };
            Ok(Resp::json(
                200,
                &json!({ "undone": entries.iter().map(|e| json!({"id": e.id, "from": e.from, "to": e.to})).collect::<Vec<_>>() }),
            ))
        }
        (Method::Post, ["api", "duplicates", "empty"]) => {
            let mut p = ctx.shared.lock();
            let files: Vec<PathBuf> = p
                .duplicates()?
                .iter()
                .map(|d| p.root.join(&d.path))
                .collect();
            let out = p.delete(&files)?;
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Post, ["api", "trash", "empty"]) => {
            let n = ctx.shared.lock().empty_trash()?;
            Ok(Resp::json(200, &json!({ "removed": n })))
        }
        (Method::Post, ["api", "gap-fill"]) => {
            let b: GapBody = read_json(req)?;
            let mode = parse_mode(&b.mode)?;
            let out = ctx.shared.lock().fill_gaps(&b.folder, mode)?;
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Post, ["api", "resort"]) => {
            let b: ResortBody = read_json(req)?;
            let out = ctx.shared.lock().resort(b.folder.as_deref())?;
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Post, ["api", "folders"]) => {
            let b: FolderBody = read_json(req)?;
            if ctx.shared.config_path.is_none() {
                return Err(ApiError::new(
                    400,
                    "creating folders requires a config file",
                ));
            }
            let root = ctx.shared.lock().root.clone();
            ctx.shared.lock().create_folder(&b.folder)?;
            if let Err(e) = ctx
                .shared
                .edit_config(|text| add_folder(text, &b.folder, None))
            {
                rollback_created_folder(&root, &b.folder);
                return Err(ApiError::new(400, e));
            }
            Ok(Resp::json(200, &json!({ "folder": b.folder })))
        }
        (Method::Post, ["api", "folder-rename"]) => {
            let b: FolderChangeBody = read_json(req)?;
            if ctx.shared.config_path.is_none() {
                return Err(ApiError::new(400, "folder renames require a config file"));
            }
            let plan = ctx.shared.lock().rename_folder_preview(&b.from, &b.to)?;
            if plan.actions.is_empty()
                || plan
                    .actions
                    .iter()
                    .any(|a| matches!(a, Action::Leave { .. }))
            {
                return Err(ApiError::new(
                    409,
                    "folder rename has no movable images or contains destination conflicts",
                ));
            }
            let prefix_pins = ctx
                .shared
                .lock()
                .rename_folder_prefix_pins(&b.from, &b.to)?;
            let config_before = ctx
                .shared
                .config_text()
                .map_err(|e| ApiError::new(400, e))?;
            let out = ctx.shared.lock().rename_folder(&b.from, &b.to)?;
            finish_folder_change(
                ctx,
                &out,
                config_before,
                ConfigUndoKind::Rename,
                Some(b.from.clone()),
                Some(b.to.clone()),
                None,
                |text| edit_rename_folder(text, &b.from, &b.to, &prefix_pins),
            )?;
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Post, ["api", "folder-merge"]) => {
            let b: FolderChangeBody = read_json(req)?;
            if ctx.shared.config_path.is_none() {
                return Err(ApiError::new(400, "folder merges require a config file"));
            }
            let plan = ctx.shared.lock().merge_folder_preview(&b.from, &b.to)?;
            if plan.actions.is_empty() {
                return Err(ApiError::new(409, "source folder has no images to merge"));
            }
            let config_before = ctx
                .shared
                .config_text()
                .map_err(|e| ApiError::new(400, e))?;
            let out = ctx.shared.lock().merge_folder(&b.from, &b.to)?;
            finish_folder_change(
                ctx,
                &out,
                config_before,
                ConfigUndoKind::Merge,
                Some(b.from.clone()),
                Some(b.to.clone()),
                None,
                |text| edit_merge_folder(text, &b.from, &b.to),
            )?;
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Put, ["api", "folder-prefix"]) => {
            let b: FolderPrefixBody = read_json(req)?;
            if ctx.shared.config_path.is_none() {
                return Err(ApiError::new(400, "folder prefixes require a config file"));
            }
            let plan = ctx
                .shared
                .lock()
                .prefix_change_preview(&b.folder, &b.prefix)?;
            if plan
                .actions
                .iter()
                .any(|a| matches!(a, Action::Leave { .. }))
            {
                return Err(ApiError::new(
                    409,
                    "prefix change contains destination conflicts",
                ));
            }
            let config_before = ctx
                .shared
                .config_text()
                .map_err(|e| ApiError::new(400, e))?;
            let out = ctx.shared.lock().change_prefix(&b.folder, &b.prefix)?;
            finish_folder_change(
                ctx,
                &out,
                config_before,
                ConfigUndoKind::Prefix,
                Some(b.folder.clone()),
                None,
                Some(b.prefix.clone()),
                |text| set_folder_prefix(text, &b.folder, &b.prefix),
            )?;
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Post, ["api", "rescan"]) => {
            ctx.shared.request_rescan();
            Ok(Resp::json(200, &json!({ "ok": true })))
        }
        (Method::Post, ["api", "tags", "test"]) => {
            let b: TestBody = read_json(req)?;
            Ok(Resp::json(200, &test_name(ctx, &b.filename)?))
        }
        (Method::Post, ["api", "tags"]) => {
            let spec: TagSpec = read_json(req)?;
            ctx.shared
                .edit_config(|t| add_tag(t, &spec))
                .map_err(|e| ApiError::new(400, e))?;
            ctx.shared.request_rescan();
            Ok(Resp::json(200, &tags_json(ctx)))
        }
        (Method::Put, ["api", "tags", i]) => {
            let i: usize = i
                .parse()
                .map_err(|_| ApiError::new(400, "bad tag number"))?;
            let spec: TagSpec = read_json(req)?;
            ctx.shared
                .edit_config(|t| {
                    update_tag_checked(
                        t,
                        i,
                        &spec,
                        spec.expected_keywords.as_deref(),
                        spec.expected_dest.as_deref(),
                    )
                })
                .map_err(|e| {
                    let status = if e.contains("tag changed since") {
                        409
                    } else {
                        400
                    };
                    ApiError::new(status, e)
                })?;
            ctx.shared.request_rescan();
            Ok(Resp::json(200, &tags_json(ctx)))
        }
        (Method::Delete, ["api", "tags", i]) => {
            let i: usize = i
                .parse()
                .map_err(|_| ApiError::new(400, "bad tag number"))?;
            let expected: DeleteTagBody = read_json(req)?;
            ctx.shared
                .edit_config(|t| {
                    delete_tag_checked(
                        t,
                        i,
                        expected.expected_keywords.as_deref(),
                        expected.expected_dest.as_deref(),
                    )
                })
                .map_err(|e| {
                    let status = if e.contains("tag changed since") {
                        409
                    } else {
                        400
                    };
                    ApiError::new(status, e)
                })?;
            Ok(Resp::json(200, &tags_json(ctx)))
        }
        (Method::Put, ["api", "origins"]) => {
            let b: OriginBody = read_json(req)?;
            let site =
                Site::from_label(&b.site).ok_or_else(|| ApiError::new(400, "unknown site"))?;
            if !ctx.shared.lock().edit_origin(&b.hash, site, b.id.trim())? {
                return Err(ApiError::new(404, "no record with that hash"));
            }
            Ok(Resp::json(200, &json!({ "ok": true })))
        }
        (Method::Post, ["api", "origins", "lookup"]) => {
            let b: OriginLookupBody = read_json(req)?;
            if b.hash.len() != 64 || !b.hash.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(ApiError::new(400, "not a content hash"));
            }
            validate_lookup_source(&b.site, &b.id).map_err(|error| ApiError::new(400, error))?;
            let path = ctx.secrets_path.clone().ok_or_else(|| {
                ApiError::new(503, "metadata lookup requires a saved config file")
            })?;
            let result = ctx
                .fetch
                .lookup_origin(ctx.shared.clone(), path, &b.hash, &b.site, &b.id)
                .map_err(|error| ApiError::new(502, error))?;
            Ok(Resp::json(200, &result))
        }
        (Method::Put, ["api", "settings"]) => {
            let b: SettingsBody = read_json(req)?;
            let current_settings = ctx.shared.lock().cfg.settings.clone();
            if b.gap_mode.is_some()
                || b.setup_complete.is_some()
                || b.danbooru_rating.is_some()
                || b.wallhaven_purity.is_some()
                || b.yandere_rating.is_some()
                || b.safebooru_rating.is_some()
                || b.konachan_rating.is_some()
                || b.zerochan_username.is_some()
                || b.warn_before_unrated_sites.is_some()
                || b.wallpaper_apply_script.is_some()
                || b.wallpaper_apply_args.is_some()
            {
                ctx.shared
                    .edit_config(|text| {
                        let text = if let Some(mode) = b.gap_mode.as_deref() {
                            set_gap_mode(text, mode)?
                        } else {
                            text.to_string()
                        };
                        let text = if b.danbooru_rating.is_some()
                            || b.wallhaven_purity.is_some()
                            || b.yandere_rating.is_some()
                            || b.safebooru_rating.is_some()
                            || b.konachan_rating.is_some()
                        {
                            set_fetch_ratings(
                                &text,
                                b.danbooru_rating
                                    .as_deref()
                                    .unwrap_or(&current_settings.danbooru_rating),
                                b.wallhaven_purity
                                    .as_deref()
                                    .unwrap_or(&current_settings.wallhaven_purity),
                                b.yandere_rating
                                    .as_deref()
                                    .unwrap_or(&current_settings.yandere_rating),
                                b.safebooru_rating
                                    .as_deref()
                                    .unwrap_or(&current_settings.safebooru_rating),
                                b.konachan_rating
                                    .as_deref()
                                    .unwrap_or(&current_settings.konachan_rating),
                            )?
                        } else {
                            text
                        };
                        let text = if b.zerochan_username.is_some()
                            || b.warn_before_unrated_sites.is_some()
                        {
                            set_zerochan_preferences(
                                &text,
                                b.zerochan_username
                                    .as_deref()
                                    .unwrap_or(&current_settings.zerochan_username),
                                b.warn_before_unrated_sites
                                    .unwrap_or(current_settings.warn_before_unrated_sites),
                            )?
                        } else {
                            text
                        };
                        let text = if b.wallpaper_apply_script.is_some()
                            || b.wallpaper_apply_args.is_some()
                        {
                            set_wallpaper_apply(
                                &text,
                                b.wallpaper_apply_script
                                    .as_deref()
                                    .unwrap_or(&current_settings.wallpaper_apply_script),
                                b.wallpaper_apply_args
                                    .as_deref()
                                    .unwrap_or(&current_settings.wallpaper_apply_args),
                            )?
                        } else {
                            text
                        };
                        if let Some(complete) = b.setup_complete {
                            set_setup_complete(&text, complete)
                        } else {
                            Ok(text)
                        }
                    })
                    .map_err(|e| ApiError::new(400, e))?;
            }
            let settings = ctx.shared.lock().cfg.settings.clone();
            Ok(Resp::json(200, &public_settings(&settings)?))
        }
        (Method::Post, ["api", "duplicates", "restore"]) => {
            let b: RestoreDuplicatesBody = read_json(req)?;
            let out = {
                let mut p = ctx.shared.lock();
                let files = resolve_all(&p, &b.paths)?;
                p.restore_duplicates(&files, &b.folder)?
            };
            Ok(Resp::json(200, &outcome_json(&out)))
        }
        (Method::Post, ["api", "intake"]) => {
            let b: IntakeBody = read_json(req)?;
            ctx.shared
                .edit_config(|text| add_intake(text, &b.path, b.recursive, b.remove_empty_folders))
                .map_err(|e| ApiError::new(400, e))?;
            ctx.shared.request_rescan();
            Ok(Resp::json(
                200,
                &json!({ "intake": ctx.shared.lock().cfg.intake }),
            ))
        }
        (Method::Put, ["api", "intake", i]) => {
            let index: usize = i
                .parse()
                .map_err(|_| ApiError::new(400, "bad intake index"))?;
            let b: IntakeBody = read_json(req)?;
            ctx.shared
                .edit_config(|text| {
                    update_intake(text, index, &b.path, b.recursive, b.remove_empty_folders)
                })
                .map_err(|e| ApiError::new(400, e))?;
            ctx.shared.request_rescan();
            Ok(Resp::json(
                200,
                &json!({ "intake": ctx.shared.lock().cfg.intake }),
            ))
        }
        (Method::Delete, ["api", "intake", i]) => {
            let index: usize = i
                .parse()
                .map_err(|_| ApiError::new(400, "bad intake index"))?;
            ctx.shared
                .edit_config(|text| remove_intake(text, index))
                .map_err(|e| ApiError::new(400, e))?;
            ctx.shared.request_rescan();
            Ok(Resp::json(
                200,
                &json!({ "intake": ctx.shared.lock().cfg.intake }),
            ))
        }
        _ => Err(ApiError::new(404, "not found")),
    }
}

static WALLPAPER_CHILD_REAPER: OnceLock<Result<mpsc::Sender<Child>, String>> = OnceLock::new();

fn wallpaper_child_reaper() -> Result<&'static mpsc::Sender<Child>, ApiError> {
    let result = WALLPAPER_CHILD_REAPER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<Child>();
        std::thread::Builder::new()
            .name("wallpaper-script-reaper".to_string())
            .spawn(move || {
                let mut children = Vec::new();
                loop {
                    match receiver.recv_timeout(Duration::from_millis(250)) {
                        Ok(child) => children.push(child),
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    children.retain_mut(|child: &mut Child| match child.try_wait() {
                        Ok(Some(_)) => false,
                        Ok(None) => true,
                        Err(error) => {
                            eprintln!("could not reap detached wallpaper script: {error}");
                            true
                        }
                    });
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(sender)
    });
    result
        .as_ref()
        .map_err(|error| ApiError::new(503, format!("could not initialize script reaper: {error}")))
}

fn apply_wallpaper(ctx: &Ctx, body: ApplyWallpaperBody) -> Result<Resp, ApiError> {
    if body.hash.len() != 64 || !body.hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ApiError::new(
            400,
            "hash must be a 64-character hexadecimal image hash",
        ));
    }

    let (script, args, image_path) = {
        let p = ctx.shared.lock();
        let script = p.cfg.settings.wallpaper_apply_script.clone();
        if script.trim().is_empty() {
            return Err(ApiError::new(
                409,
                "configure a wallpaper script in Settings first",
            ));
        }
        let entry = p
            .index
            .entries()
            .find(|entry| entry.hash == body.hash)
            .ok_or_else(|| ApiError::new(404, "image is no longer in the Library"))?;
        let image_path = p.resolve(&entry.path)?;
        if !image_path.is_file() || sorter_engine::hash_file(&image_path)? != body.hash {
            return Err(ApiError::new(404, "image is no longer in the Library"));
        }
        (
            script,
            p.cfg.settings.wallpaper_apply_args.clone(),
            image_path,
        )
    };

    let script_path = expand_home(&script);
    if !script_path.is_absolute() {
        return Err(ApiError::new(
            400,
            "wallpaper script path must be absolute or start with ~/",
        ));
    }
    let metadata = fs::metadata(&script_path)
        .map_err(|error| ApiError::new(400, format!("wallpaper script is unavailable: {error}")))?;
    if !metadata.is_file() {
        return Err(ApiError::new(
            400,
            "wallpaper script path must name a regular file",
        ));
    }

    let reaper = wallpaper_child_reaper()?;
    let mut command = Command::new("/bin/bash");
    command
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    command.process_group(0);
    for arg in args {
        if arg == WALLPAPER_PATH_ARGUMENT {
            command.arg(&image_path);
        } else {
            command.arg(arg);
        }
    }
    let child = command.spawn().map_err(|error| {
        ApiError::new(502, format!("could not start wallpaper script: {error}"))
    })?;
    if let Err(error) = reaper.send(child) {
        let mut child = error.0;
        if child.try_wait()?.is_none() {
            child.kill()?;
        }
        child.wait()?;
        return Err(ApiError::new(
            503,
            "script reaper stopped; the wallpaper script was stopped",
        ));
    }
    Ok(Resp::json(202, &json!({ "started": true })))
}

fn parse_mode(s: &str) -> Result<GapMode, ApiError> {
    match s {
        "last" => Ok(GapMode::LastIntoGap),
        "renumber" => Ok(GapMode::Renumber),
        _ => Err(ApiError::new(400, "mode must be \"last\" or \"renumber\"")),
    }
}

fn resolve_all(p: &sorter_engine::Pipeline, paths: &[String]) -> Result<Vec<PathBuf>, ApiError> {
    if paths.is_empty() {
        return Err(ApiError::new(400, "no paths given"));
    }
    let mut out = Vec::new();
    for s in paths {
        let path = p.resolve(s)?;
        if !path.is_file() {
            return Err(ApiError::new(404, format!("{s} is not a file")));
        }
        out.push(path);
    }
    Ok(out)
}

fn rollback_created_folder(root: &std::path::Path, folder: &str) {
    let leaf = root.join(folder);
    let _ = std::fs::remove_dir(&leaf);
    let mut parent = leaf.parent();
    while let Some(path) = parent {
        if path == root {
            break;
        }
        if std::fs::remove_dir(path).is_err() {
            break;
        }
        parent = path.parent();
    }
}

fn finish_folder_change(
    ctx: &Ctx,
    out: &Outcome,
    config_before: String,
    kind: ConfigUndoKind,
    from: Option<String>,
    to: Option<String>,
    prefix: Option<String>,
    change: impl FnOnce(&str) -> Result<String, String>,
) -> Result<(), ApiError> {
    let has_file_changes = !out.report.done.is_empty();
    if let Some(error) = out.report.error.as_ref() {
        if has_file_changes {
            ctx.shared.undo_batch(out.report.batch)?;
        }
        return Err(ApiError::new(500, error.to_string()));
    }
    if let Err(e) = ctx.shared.edit_config(change) {
        if has_file_changes {
            ctx.shared.undo_batch(out.report.batch)?;
        }
        return Err(ApiError::new(400, e));
    }
    if has_file_changes {
        if let Err(e) =
            ctx.shared
                .record_config_undo(out.report.batch, config_before, kind, from, to, prefix)
        {
            ctx.shared.undo_batch(out.report.batch)?;
            return Err(ApiError::new(500, e));
        }
    }
    Ok(())
}

fn leave_text(r: &LeaveReason) -> String {
    match r {
        LeaveReason::NoMatch => "no match".to_string(),
        LeaveReason::Conflict(t) => format!("conflict: {}", t.join(";")),
        LeaveReason::Problem(p) => p.clone(),
    }
}

fn outcome_json(o: &Outcome) -> Value {
    json!({
        "batch": o.report.batch,
        "done": o.report.done.iter().map(|e| json!({ "id": e.id, "kind": e.kind, "from": e.from, "to": e.to, "note": e.note })).collect::<Vec<_>>(),
        "left": o.report.left.iter().map(|(p, r)| json!({ "path": p, "reason": leave_text(r) })).collect::<Vec<_>>(),
        "skipped": o.report.skipped,
        "error": o.report.error.as_ref().map(|e| e.to_string()),
    })
}

fn resort_json(plan: &Plan) -> Value {
    let items: Vec<Value> = plan
        .actions
        .iter()
        .map(|action| match action {
            Action::Move {
                from,
                to,
                rule,
                matched,
            } => json!({
                "kind": "move", "from": from, "to": to, "rule": rule.label(), "matched": matched,
            }),
            Action::Rename { from, to } => json!({ "kind": "rename", "from": from, "to": to }),
            Action::ToDuplicates {
                from,
                to,
                duplicate_of,
            } => json!({
                "kind": "duplicate", "from": from, "to": to, "duplicate_of": duplicate_of,
            }),
            Action::Leave { path, reason } => {
                json!({ "kind": "leave", "path": path, "reason": leave_text(reason) })
            }
            // Re-sort only supplies images, so Ignore here means an image is already correctly
            // numbered in its destination folder.  It is a stay, rather than a skipped input.
            Action::Ignore { path } => json!({ "kind": "stay", "path": path }),
        })
        .collect();
    let changes = items
        .iter()
        .filter(|item| matches!(item["kind"].as_str(), Some("move" | "rename" | "duplicate")))
        .count();
    json!({ "items": items, "changes": changes })
}

fn tags_json(ctx: &Ctx) -> Value {
    let p = ctx.shared.lock();
    Value::Array(
        p.cfg
            .tags
            .iter()
            .enumerate()
            .map(|(i, t)| {
                let mut v = serde_json::to_value(t).unwrap_or(Value::Null);
                v["index"] = json!(i);
                v["effective_prefix"] = json!(p.cfg.prefix_for(&t.dest));
                v
            })
            .collect(),
    )
}

fn status(ctx: &Ctx) -> Result<Resp, ApiError> {
    let p = ctx.shared.lock();
    let intake_watch = ctx.shared.intake_watch_status();
    let settings = public_settings(&p.cfg.settings)?;
    Ok(Resp::json(
        200,
        &json!({
            "version": env!("CARGO_PKG_VERSION"),
            "library": p.root,
            "config_file": ctx.shared.config_path,
            "activity_last_id": p.log.entries().last().map(|e| e.id).unwrap_or(0),
            "intake": intake_watch.iter().enumerate().map(|(index, d)| json!({
                "index": index,
                "path": d.path,
                "exists": d.path.is_dir(),
                "recursive": d.recursive,
                "remove_empty_folders": d.remove_empty_folders,
                "watching": d.watching,
                "error": d.error,
            })).collect::<Vec<_>>(),
            "counts": {
                "library_images": p.index.len(),
                "inbox": p.inbox()?.len(),
                "duplicates": p.duplicates()?.len(),
                "records": p.origins.len(),
            },
            "settings": settings,
            "setup_complete": p.cfg.setup_complete,
        }),
    ))
}

fn public_settings(settings: &sorter_core::Settings) -> Result<Value, ApiError> {
    let mut value = serde_json::to_value(settings)
        .map_err(|error| ApiError::new(500, format!("could not serialize settings: {error}")))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| ApiError::new(500, "settings did not serialize as an object"))?;
    object.insert(
        "zerochan_username_saved".into(),
        json!(!settings.zerochan_username.trim().is_empty()),
    );
    object.insert(
        "zerochan_username".into(),
        json!(settings.zerochan_username),
    );
    Ok(value)
}

fn origin_json(o: &Origin) -> Value {
    let (folder, name) = o.path.rsplit_once('/').unwrap_or(("", o.path.as_str()));
    json!({
        "hash": o.hash, "path": o.path, "folder": folder, "name": name,
        "original_name": o.original_name, "sources": o.sources, "added": o.added,
        "width": o.width, "height": o.height, "note": o.note,
        "tags": o.tags, "rating": o.rating,
    })
}

fn data(ctx: &Ctx, q: &HashMap<String, String>) -> Result<Resp, ApiError> {
    let p = ctx.shared.lock();
    let text = q
        .get("q")
        .map(|s| s.to_lowercase())
        .filter(|s| !s.is_empty());
    let site = q.get("site").filter(|s| !s.is_empty());
    let folder = q.get("folder").filter(|s| !s.is_empty());
    let unknown = q.get("unknown").map_or(false, |v| v == "1" || v == "true");
    let mut recs: Vec<&Origin> = p
        .origins
        .all()
        .filter(|o| {
            site.map_or(true, |s| {
                o.sources
                    .iter()
                    .any(|x| x.site.label().eq_ignore_ascii_case(s))
            })
        })
        .filter(|o| !unknown || o.sources.iter().all(|x| x.site == Site::Unknown))
        .filter(|o| folder.map_or(true, |f| o.path.starts_with(&format!("{f}/"))))
        .filter(|o| {
            text.as_ref().map_or(true, |t| {
                o.path.to_lowercase().contains(t)
                    || o.original_name.to_lowercase().contains(t)
                    || o.sources.iter().any(|s| s.id.to_lowercase().contains(t))
            })
        })
        .collect();
    recs.sort_by(|a, b| {
        (std::cmp::Reverse(a.added), &a.path).cmp(&(std::cmp::Reverse(b.added), &b.path))
    });
    let total = recs.len();
    let offset: usize = q.get("offset").and_then(|v| v.parse().ok()).unwrap_or(0);
    let limit: usize = q
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(100)
        .min(500);
    let items: Vec<Value> = recs
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(origin_json)
        .collect();
    Ok(Resp::json(
        200,
        &json!({ "total": total, "offset": offset, "items": items }),
    ))
}

fn activity(ctx: &Ctx, q: &HashMap<String, String>) -> Result<Resp, ApiError> {
    let p = ctx.shared.lock();
    let limit: usize = q
        .get("limit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(100)
        .min(1000);
    let items: Vec<Value> = p
        .log
        .entries()
        .iter()
        .rev()
        .take(limit)
        .map(|e| {
            let undone = p.log.is_undone(e.id);
            let is_undo = e.kind == sorter_engine::Kind::Undo;
            json!({
                "id": e.id, "batch": e.batch, "time": e.time, "kind": e.kind, "from": e.from, "to": e.to,
                "note": e.note, "undone": undone,
                "undoable": !is_undo && !undone && Path::new(&e.to).exists(),
            })
        })
        .collect();
    Ok(Resp::json(200, &items))
}

fn test_name(ctx: &Ctx, filename: &str) -> Result<Value, ApiError> {
    let p = ctx.shared.lock();
    let (stem, ext) = split_name(filename);
    let d = classify(filename, &p.cfg);
    let new_name = match &d.dest {
        Dest::Folder(f) => {
            let raw_ext = filename.rsplit('.').next().unwrap_or(&ext);
            p.preview_name(f, raw_ext).ok()
        }
        _ => None,
    };
    Ok(json!({
        "words": tokens(stem),
        "rule": d.rule.label(),
        "dest": d.dest.label(),
        "matched": d.matched,
        "ignored": d.ignored,
        "new_name": new_name,
    }))
}

fn image_source(ctx: &Ctx, hash: &str) -> Result<PathBuf, ApiError> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::new(400, "not a content hash"));
    }
    let p = ctx.shared.lock();
    if let Some(rel) = p.index.paths_for_hash(hash).first() {
        let abs = p.root.join(rel);
        if abs.is_file() {
            return Ok(abs);
        }
    }
    if let Some(o) = p.origins.get(hash) {
        let abs = if Path::new(&o.path).is_absolute() {
            PathBuf::from(&o.path)
        } else {
            p.root.join(&o.path)
        };
        if abs.is_file() && p.resolve(&abs.to_string_lossy()).is_ok() {
            return Ok(abs);
        }
    }
    Err(ApiError::new(404, "no image with that hash"))
}

fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}
