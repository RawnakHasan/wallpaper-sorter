use crate::daemon::Shared;
use crate::secrets::{self, ApiSecrets};
use base64::Engine;
use image::{ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sorter_core::{Action, Site, Source};
use sorter_engine::{hash_file, move_no_replace, ExecError, Outcome};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use ureq::{Agent, AgentBuilder, Response};

const MAX_ITEMS: usize = 100;
const MAX_IMAGE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_API_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

#[derive(Clone, Deserialize)]
pub(crate) struct FetchRequest {
    #[serde(default)]
    site: Option<String>,
    input: String,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FetchState {
    Queued,
    Downloading,
    Sorted,
    Inbox,
    Duplicate,
    Error,
}

#[derive(Clone, Serialize)]
pub(crate) struct FetchJobItem {
    input: String,
    site: Option<String>,
    id: Option<String>,
    state: FetchState,
    location: Option<String>,
    message: Option<String>,
    character_suggestions: Vec<CharacterSuggestion>,
}

#[derive(Clone, Serialize)]
struct CharacterSuggestion {
    keyword: String,
    series: Option<String>,
}

#[derive(Clone, Serialize)]
pub(crate) struct FetchJob {
    id: u64,
    done: bool,
    items: Vec<FetchJobItem>,
}

#[derive(Clone)]
struct ParsedItem {
    site: Site,
    id: String,
}

#[derive(Clone)]
struct SiteEndpoints {
    wallhaven_api: String,
    danbooru_api: String,
    wallhaven_image_hosts: Vec<String>,
    danbooru_image_hosts: Vec<String>,
    allow_http: bool,
}

impl SiteEndpoints {
    fn production() -> Self {
        Self {
            wallhaven_api: "https://wallhaven.cc/api/v1".into(),
            danbooru_api: "https://danbooru.donmai.us".into(),
            wallhaven_image_hosts: vec!["w.wallhaven.cc".into(), "wallhaven.cc".into()],
            danbooru_image_hosts: vec!["cdn.donmai.us".into(), "danbooru.donmai.us".into()],
            allow_http: false,
        }
    }

    fn api_url(&self, site: Site, id: &str) -> String {
        match site {
            Site::Wallhaven => format!("{}/w/{id}", self.wallhaven_api),
            Site::Danbooru => format!("{}/posts/{id}.json", self.danbooru_api),
            _ => unreachable!("only supported sites are parsed"),
        }
    }

    fn api_hosts(&self, site: Site) -> Vec<String> {
        match site {
            Site::Wallhaven => vec![url_authority(&self.wallhaven_api).unwrap_or_default()],
            Site::Danbooru => vec![url_authority(&self.danbooru_api).unwrap_or_default()],
            _ => Vec::new(),
        }
    }

    fn image_hosts(&self, site: Site) -> &[String] {
        match site {
            Site::Wallhaven => &self.wallhaven_image_hosts,
            Site::Danbooru => &self.danbooru_image_hosts,
            _ => &[],
        }
    }
}

#[derive(Default)]
struct JobStore {
    jobs: HashMap<u64, FetchJob>,
}

#[derive(Default)]
struct RateLimiter {
    next: Mutex<HashMap<&'static str, Instant>>,
    no_wait: bool,
}

impl RateLimiter {
    fn wait(&self, site: Site) {
        if self.no_wait {
            return;
        }
        let interval = match site {
            Site::Wallhaven => Duration::from_millis(1350),
            Site::Danbooru => Duration::from_secs(1),
            _ => Duration::ZERO,
        };
        let label = site.label();
        let now = Instant::now();
        let start = {
            let mut next = self.next.lock().unwrap_or_else(|error| error.into_inner());
            let start = next.get(label).copied().unwrap_or(now).max(now);
            next.insert(label, start + interval);
            start
        };
        thread::sleep(start.saturating_duration_since(now));
    }

    #[cfg(test)]
    fn without_delay() -> Self {
        Self {
            next: Mutex::new(HashMap::new()),
            no_wait: true,
        }
    }
}

#[derive(Clone)]
pub(crate) struct FetchManager {
    store: Arc<Mutex<JobStore>>,
    next_id: Arc<AtomicU64>,
    limiter: Arc<RateLimiter>,
    endpoints: SiteEndpoints,
    agent: Agent,
}

impl Default for FetchManager {
    fn default() -> Self {
        Self::new(SiteEndpoints::production())
    }
}

impl FetchManager {
    fn new(endpoints: SiteEndpoints) -> Self {
        let agent = AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(25))
            .timeout_write(Duration::from_secs(10))
            .redirects(0)
            .build();
        Self {
            store: Arc::new(Mutex::new(JobStore::default())),
            next_id: Arc::new(AtomicU64::new(1)),
            limiter: Arc::new(RateLimiter::default()),
            endpoints,
            agent,
        }
    }

    pub(crate) fn submit(
        &self,
        shared: Arc<Shared>,
        secrets_path: PathBuf,
        requests: Vec<FetchRequest>,
    ) -> Result<FetchJob, String> {
        if requests.is_empty() || requests.len() > MAX_ITEMS {
            return Err(format!("send between 1 and {MAX_ITEMS} fetch entries"));
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut job = FetchJob {
            id,
            done: true,
            items: Vec::with_capacity(requests.len()),
        };
        let mut work = Vec::new();
        for request in requests {
            match parse_input(request.site.as_deref(), &request.input) {
                Ok(parsed) => {
                    job.done = false;
                    let index = job.items.len();
                    job.items.push(FetchJobItem {
                        input: request.input,
                        site: Some(parsed.site.label().to_string()),
                        id: Some(parsed.id.clone()),
                        state: FetchState::Queued,
                        location: None,
                        message: None,
                        character_suggestions: Vec::new(),
                    });
                    work.push((index, parsed));
                }
                Err(message) => job.items.push(FetchJobItem {
                    input: request.input,
                    site: request.site,
                    id: None,
                    state: FetchState::Error,
                    location: None,
                    message: Some(message),
                    character_suggestions: Vec::new(),
                }),
            }
        }
        {
            let mut store = self.store.lock().unwrap_or_else(|error| error.into_inner());
            store.jobs.retain(|_, old| !old.done);
            if store.jobs.len() >= 32 {
                return Err("too many active fetch jobs".into());
            }
            store.jobs.insert(id, job.clone());
        }
        if work.is_empty() {
            return Ok(job);
        }

        let manager = self.clone();
        let spawn = thread::Builder::new()
            .name(format!("fetch-{id}"))
            .spawn(move || {
                for (index, item) in work {
                    manager.update_item(id, index, |entry| {
                        entry.state = FetchState::Downloading;
                        entry.message = Some("Fetching metadata and image".into());
                    });
                    let result = process_one(
                        &item,
                        &shared,
                        &secrets_path,
                        &manager.endpoints,
                        &manager.agent,
                        &manager.limiter,
                        id,
                        index,
                    );
                    manager.update_item(id, index, |entry| match result {
                        Ok(result) => {
                            entry.state = result.state;
                            entry.location = result.location;
                            entry.message = Some(result.message);
                            entry.character_suggestions = result.character_suggestions;
                        }
                        Err(message) => {
                            entry.state = FetchState::Error;
                            entry.message = Some(message);
                        }
                    });
                }
                manager.finish(id);
            });
        if spawn.is_err() {
            self.update_job(id, |job| {
                job.done = true;
                for item in &mut job.items {
                    if matches!(item.state, FetchState::Queued | FetchState::Downloading) {
                        item.state = FetchState::Error;
                        item.message = Some("could not start the fetch worker".into());
                    }
                }
            });
            return Err("could not start the fetch worker".into());
        }
        Ok(job)
    }

    pub(crate) fn get(&self, id: u64) -> Option<FetchJob> {
        self.store
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .jobs
            .get(&id)
            .cloned()
    }

    fn update_item(&self, job_id: u64, index: usize, update: impl FnOnce(&mut FetchJobItem)) {
        self.update_job(job_id, |job| {
            if let Some(item) = job.items.get_mut(index) {
                update(item);
            }
        });
    }

    fn update_job(&self, job_id: u64, update: impl FnOnce(&mut FetchJob)) {
        if let Some(job) = self
            .store
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .jobs
            .get_mut(&job_id)
        {
            update(job);
        }
    }

    fn finish(&self, job_id: u64) {
        self.update_job(job_id, |job| job.done = true);
    }
}

fn parse_input(site: Option<&str>, input: &str) -> Result<ParsedItem, String> {
    let input = input.trim();
    if input.is_empty() || input.len() > 2048 {
        return Err("enter a site ID or supported post URL".into());
    }
    if input.contains("://") {
        return parse_url(input);
    }
    let site = site
        .and_then(Site::from_label)
        .filter(|site| matches!(site, Site::Wallhaven | Site::Danbooru))
        .ok_or_else(|| "choose Wallhaven or Danbooru for a bare ID".to_string())?;
    validate_id(site, input)?;
    Ok(ParsedItem {
        site,
        id: input.to_string(),
    })
}

fn parse_url(input: &str) -> Result<ParsedItem, String> {
    let (scheme, rest) = input
        .split_once("://")
        .ok_or_else(|| "unsupported URL".to_string())?;
    if !matches!(scheme.to_ascii_lowercase().as_str(), "http" | "https") {
        return Err("only Wallhaven and Danbooru post URLs are supported".into());
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains('@') || authority.contains(':') {
        return Err("URL must not contain credentials or a port".into());
    }
    let host = authority.to_ascii_lowercase();
    let path = rest.find('/').map(|index| &rest[index..]).unwrap_or("/");
    let path = path.split(['?', '#']).next().unwrap_or("/");
    let (site, id) = match host.as_str() {
        "wallhaven.cc" | "www.wallhaven.cc" if path.starts_with("/w/") => {
            (Site::Wallhaven, &path[3..])
        }
        "whvn.cc" => (Site::Wallhaven, path.trim_start_matches('/')),
        "danbooru.donmai.us" if path.starts_with("/posts/") => {
            (Site::Danbooru, &path["/posts/".len()..])
        }
        _ => return Err("URL is not a supported Wallhaven or Danbooru post".into()),
    };
    if id.contains('/') || id.is_empty() {
        return Err("URL must point to one post".into());
    }
    validate_id(site, id)?;
    Ok(ParsedItem {
        site,
        id: id.to_string(),
    })
}

fn validate_id(site: Site, id: &str) -> Result<(), String> {
    let valid = match site {
        Site::Wallhaven => id.len() == 6 && id.chars().all(|c| c.is_ascii_alphanumeric()),
        Site::Danbooru => {
            !id.is_empty()
                && id.len() <= 12
                && id.chars().all(|c| c.is_ascii_digit())
                && id.chars().any(|c| c != '0')
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!("invalid {} ID", site.label()))
    }
}

fn url_authority(url: &str) -> Option<String> {
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split('/').next()?;
    (!authority.is_empty()).then(|| authority.to_ascii_lowercase())
}

struct FetchData {
    image_url: String,
    extension: String,
    rating: String,
    tags: Vec<String>,
    character_suggestions: Vec<CharacterSuggestion>,
}

struct ItemResult {
    state: FetchState,
    location: Option<String>,
    message: String,
    character_suggestions: Vec<CharacterSuggestion>,
}

fn process_one(
    item: &ParsedItem,
    shared: &Shared,
    secrets_path: &Path,
    endpoints: &SiteEndpoints,
    agent: &Agent,
    limiter: &RateLimiter,
    job_id: u64,
    item_index: usize,
) -> Result<ItemResult, String> {
    let secrets = secrets::load(secrets_path)?;
    let (root, settings) = {
        let pipeline = shared.lock();
        (pipeline.root.clone(), pipeline.cfg.settings.clone())
    };
    let data = fetch_metadata(item, &secrets, endpoints, agent, limiter)?;
    check_rating(
        item.site,
        &data.rating,
        &settings.danbooru_rating,
        &settings.wallhaven_purity,
    )?;
    let extension = normalize_extension(&data.extension)
        .ok_or_else(|| "site returned an unsupported image type".to_string())?;
    if !settings
        .image_extensions
        .iter()
        .any(|value| value.eq_ignore_ascii_case(extension))
    {
        return Err(format!(
            "image type .{extension} is not enabled in the sorter settings"
        ));
    }

    let temp_dir = ensure_fetch_temp_dir(&root)?;
    let part_path = temp_dir.join(format!(".fetch-{job_id}-{item_index}.part"));
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&part_path)
        .map_err(|_| "cannot create a temporary download file".to_string())?;
    let downloaded = download_image(
        item.site,
        &data.image_url,
        endpoints,
        agent,
        limiter,
        &secrets,
        file,
    );
    if let Err(error) = downloaded {
        match fs::remove_file(&part_path) {
            Ok(()) => return Err(error),
            Err(cleanup) if cleanup.kind() == io::ErrorKind::NotFound => return Err(error),
            Err(_) => {
                return Err(format!(
                    "{error}; the partial file remains in the staging folder"
                ))
            }
        }
    }
    let format = match image_format(&part_path) {
        Ok(format) => format,
        Err(message) => {
            remove_partial(&part_path)?;
            return Err(message);
        }
    };
    let actual_extension =
        extension_for(format).ok_or_else(|| "downloaded image format is not supported".to_string());
    let actual_extension = match actual_extension {
        Ok(extension) => extension,
        Err(message) => {
            remove_partial(&part_path)?;
            return Err(message);
        }
    };
    if actual_extension != extension {
        remove_partial(&part_path)?;
        return Err("downloaded image type did not match the site's metadata".into());
    }

    let base_name = format!("{}-{}.{}", site_slug(item.site), item.id, extension);
    let completed = unique_target(&temp_dir, &base_name, |candidate| {
        move_no_replace(&part_path, candidate)
    })?;
    sync_directory(&temp_dir).map_err(|_| "cannot sync the fetch staging folder".to_string())?;
    let hash = hash_file(&completed).map_err(|_| "cannot hash the downloaded image".to_string())?;
    let temp_relative = relative_to(&root, &completed)?;
    let source = Source::manual(item.site, &item.id);

    let mut pipeline = shared.lock();
    pipeline
        .remember_fetch(
            &hash,
            &temp_relative,
            &base_name,
            source,
            data.tags,
            data.rating,
        )
        .map_err(|_| "cannot save fetched image metadata".to_string())?;
    let root_target = unique_target(&root, &base_name, |candidate| {
        move_no_replace(&completed, candidate)
    })?;
    sync_directory(&temp_dir).map_err(|_| "cannot sync the fetch staging folder".to_string())?;
    sync_directory(&root).map_err(|_| "cannot sync the library folder".to_string())?;
    let root_relative = relative_to(&root, &root_target)?;
    pipeline
        .relocate_fetch_origin(&hash, &temp_relative, &root_relative)
        .map_err(|_| "cannot update fetched image metadata".to_string())?;
    let outcome = pipeline
        .process(std::slice::from_ref(&root_target))
        .map_err(|_| "cannot plan or sort the fetched image".to_string())?;
    Ok(result_from_outcome(
        &outcome,
        &root_target,
        data.character_suggestions,
    ))
}

fn fetch_metadata(
    item: &ParsedItem,
    secrets: &ApiSecrets,
    endpoints: &SiteEndpoints,
    agent: &Agent,
    limiter: &RateLimiter,
) -> Result<FetchData, String> {
    let api_url = endpoints.api_url(item.site, &item.id);
    let api_hosts = endpoints.api_hosts(item.site);
    let response = get_follow(
        item.site,
        &api_url,
        &api_hosts,
        endpoints.allow_http,
        secrets,
        true,
        agent,
        limiter,
    )?;
    require_json(&response)?;
    let value = read_json_response(response)?;
    match item.site {
        Site::Wallhaven => {
            let data = &value["data"];
            if data["id"].as_str() != Some(&item.id) {
                return Err("Wallhaven returned a different wallpaper ID".into());
            }
            let rating = data["purity"]
                .as_str()
                .ok_or_else(|| "Wallhaven response is missing purity".to_string())?
                .to_string();
            let image_url = data["path"]
                .as_str()
                .ok_or_else(|| "Wallhaven response has no downloadable image".to_string())?
                .to_string();
            let extension = data["file_type"]
                .as_str()
                .and_then(extension_from_mime)
                .ok_or_else(|| "Wallhaven response has an unsupported image type".to_string())?
                .to_string();
            let tags = unique_tags(
                data["tags"]
                    .as_array()
                    .ok_or_else(|| "Wallhaven response has no tags list".to_string())?
                    .iter()
                    .filter_map(|tag| tag["name"].as_str())
                    .take(256)
                    .filter(|tag| !tag.is_empty() && tag.len() <= 120)
                    .map(str::to_string),
            );
            Ok(FetchData {
                image_url,
                extension,
                rating,
                tags,
                character_suggestions: Vec::new(),
            })
        }
        Site::Danbooru => {
            if value["id"].as_u64().map(|id| id.to_string()).as_deref() != Some(&item.id) {
                return Err("Danbooru returned a different post ID".into());
            }
            let rating = value["rating"]
                .as_str()
                .ok_or_else(|| "Danbooru response is missing rating".to_string())?
                .to_string();
            let image_url = value["file_url"]
                .as_str()
                .filter(|url| !url.is_empty())
                .ok_or_else(|| "Danbooru post has no downloadable image".to_string())?
                .to_string();
            let extension = value["file_ext"]
                .as_str()
                .ok_or_else(|| "Danbooru response is missing file type".to_string())?
                .to_string();
            let tags = unique_tags(
                [
                    value["tag_string_character"].as_str().unwrap_or_default(),
                    value["tag_string_copyright"].as_str().unwrap_or_default(),
                ]
                .into_iter()
                .flat_map(str::split_whitespace)
                .take(256)
                .filter(|tag| tag.len() <= 120)
                .flat_map(danbooru_hints),
            );
            let character_suggestions = danbooru_character_suggestions(
                value["tag_string_character"].as_str().unwrap_or_default(),
            );
            Ok(FetchData {
                image_url,
                extension,
                rating,
                tags,
                character_suggestions,
            })
        }
        _ => Err("unsupported fetch site".into()),
    }
}

fn danbooru_hints(tag: &str) -> Vec<String> {
    if let Some((head, tail)) = tag.split_once("_(") {
        if let Some(inside) = tail.strip_suffix(')') {
            let mut hints = Vec::new();
            if !head.is_empty() {
                hints.push(head.replace('_', " "));
            }
            if !inside.is_empty() {
                hints.push(inside.replace('_', " "));
            }
            return hints;
        }
    }
    vec![tag.replace('_', " ")]
}

fn danbooru_character_suggestions(tags: &str) -> Vec<CharacterSuggestion> {
    let mut suggestions = Vec::new();
    for tag in tags
        .split_whitespace()
        .take(256)
        .filter(|tag| tag.len() <= 120)
    {
        let (keyword, series) = match tag.split_once("_(") {
            Some((keyword, tail)) => match tail.strip_suffix(')') {
                Some(series) => (keyword, Some(series)),
                None => (tag, None),
            },
            None => (tag, None),
        };
        let keyword = keyword.replace('_', " ");
        if keyword.is_empty() {
            continue;
        }
        let series = series
            .filter(|value| !value.is_empty())
            .map(|value| value.replace('_', " "));
        if !suggestions.iter().any(|existing: &CharacterSuggestion| {
            existing.keyword.eq_ignore_ascii_case(&keyword)
                && existing.series.as_deref().map(str::to_ascii_lowercase)
                    == series.as_deref().map(str::to_ascii_lowercase)
        }) {
            suggestions.push(CharacterSuggestion { keyword, series });
        }
    }
    suggestions
}

fn unique_tags(tags: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut unique = Vec::new();
    for tag in tags {
        if !unique
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&tag))
        {
            unique.push(tag);
        }
    }
    unique
}

fn check_rating(
    site: Site,
    rating: &str,
    danbooru_max: &str,
    wallhaven_max: &str,
) -> Result<(), String> {
    let (rank, maximum, setting) = match site {
        Site::Danbooru => (
            ["g", "s", "q", "e"].iter().position(|v| *v == rating),
            ["g", "s", "q", "e"].iter().position(|v| *v == danbooru_max),
            "Danbooru rating",
        ),
        Site::Wallhaven => (
            ["sfw", "sketchy", "nsfw"].iter().position(|v| *v == rating),
            ["sfw", "sketchy", "nsfw"]
                .iter()
                .position(|v| *v == wallhaven_max),
            "Wallhaven purity",
        ),
        _ => return Err("unsupported fetch site".into()),
    };
    let rank = rank.ok_or_else(|| format!("{setting} returned an unknown value"))?;
    let maximum = maximum.ok_or_else(|| format!("invalid {setting} setting"))?;
    if rank > maximum {
        return Err(format!(
            "blocked by the {setting} setting (item: {rating}; maximum: {})",
            if site == Site::Danbooru {
                ["g", "s", "q", "e"][maximum]
            } else {
                ["sfw", "sketchy", "nsfw"][maximum]
            }
        ));
    }
    Ok(())
}

fn download_image(
    site: Site,
    url: &str,
    endpoints: &SiteEndpoints,
    agent: &Agent,
    limiter: &RateLimiter,
    secrets: &ApiSecrets,
    mut output: File,
) -> Result<(), String> {
    let response = get_follow(
        site,
        url,
        endpoints.image_hosts(site),
        endpoints.allow_http,
        secrets,
        false,
        agent,
        limiter,
    )?;
    let content_type = response
        .header("Content-Type")
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !content_type.starts_with("image/") {
        return Err("site returned a non-image response".into());
    }
    if response
        .header("Content-Length")
        .and_then(|length| length.parse::<u64>().ok())
        .is_some_and(|length| length > MAX_IMAGE_BYTES)
    {
        return Err("image exceeds the 32 MiB download limit".into());
    }
    let mut reader = response.into_reader().take(MAX_IMAGE_BYTES + 1);
    let size =
        io::copy(&mut reader, &mut output).map_err(|_| "image download failed".to_string())?;
    if size == 0 {
        return Err("site returned an empty image".into());
    }
    if size > MAX_IMAGE_BYTES {
        return Err("image exceeds the 32 MiB download limit".into());
    }
    output
        .sync_all()
        .map_err(|_| "cannot sync the downloaded image".to_string())?;
    Ok(())
}

fn get_follow(
    site: Site,
    url: &str,
    allowed_authorities: &[String],
    allow_http: bool,
    secrets: &ApiSecrets,
    api_request: bool,
    agent: &Agent,
    limiter: &RateLimiter,
) -> Result<Response, String> {
    let mut current = url.to_string();
    let mut retried_rate_limit = false;
    for redirects in 0..=MAX_REDIRECTS {
        let parsed = parse_remote_url(&current, allowed_authorities, allow_http)?;
        limiter.wait(site);
        let mut request = agent.get(&current);
        let user_agent = user_agent(site, secrets);
        request = request.set("User-Agent", &user_agent);
        if api_request
            && allowed_authorities
                .first()
                .is_some_and(|host| host.eq_ignore_ascii_case(&parsed.authority))
        {
            match site {
                Site::Wallhaven => {
                    if let Some(key) = secrets.wallhaven_api_key.as_deref() {
                        request = request.set("X-API-Key", key);
                    }
                }
                Site::Danbooru => {
                    if let (Some(username), Some(key)) = (
                        secrets.danbooru_username.as_deref(),
                        secrets.danbooru_api_key.as_deref(),
                    ) {
                        let credentials =
                            base64::prelude::BASE64_STANDARD.encode(format!("{username}:{key}"));
                        request = request.set("Authorization", &format!("Basic {credentials}"));
                    }
                }
                _ => {}
            }
        }
        let response = match request.call() {
            Ok(response) => response,
            Err(ureq::Error::Status(_, response)) => response,
            Err(_) => return Err("could not connect to the image site".into()),
        };
        let status = response.status();
        if matches!(status, 301 | 302 | 303 | 307 | 308) {
            if redirects == MAX_REDIRECTS {
                return Err("site redirected too many times".into());
            }
            let location = response
                .header("Location")
                .ok_or_else(|| "site returned a redirect without a location".to_string())?;
            current = resolve_redirect(&current, location)?;
            continue;
        }
        if status == 429 {
            if retried_rate_limit {
                return Err("site rate limit is still active; try again later".into());
            }
            let delay = response
                .header("Retry-After")
                .and_then(parse_retry_after)
                .ok_or_else(|| {
                    "site rate limit hit without a valid Retry-After value".to_string()
                })?;
            drop(response);
            thread::sleep(delay);
            retried_rate_limit = true;
            continue;
        }
        if status != 200 {
            return Err(match status {
                401 | 403 => "site denied this request; check the saved API credentials".into(),
                404 => "no accessible post exists for this ID".into(),
                _ => format!("site returned HTTP {status}"),
            });
        }
        return Ok(response);
    }
    Err("site redirected too many times".into())
}

struct ParsedRemoteUrl {
    authority: String,
}

fn parse_remote_url(
    url: &str,
    allowed_authorities: &[String],
    allow_http: bool,
) -> Result<ParsedRemoteUrl, String> {
    let (scheme, rest) = url
        .split_once("://")
        .ok_or_else(|| "site returned an invalid image URL".to_string())?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && !(allow_http && scheme == "http") {
        return Err("site URL must use HTTPS".into());
    }
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if authority.is_empty()
        || authority.contains('@')
        || (!allow_http && authority.contains(':'))
        || !allowed_authorities
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(&authority))
    {
        return Err("site URL host is not allowlisted".into());
    }
    Ok(ParsedRemoteUrl { authority })
}

fn resolve_redirect(current: &str, location: &str) -> Result<String, String> {
    if location.starts_with("https://") || location.starts_with("http://") {
        return Ok(location.to_string());
    }
    let (scheme, rest) = current
        .split_once("://")
        .ok_or_else(|| "site returned an invalid redirect".to_string())?;
    let authority = rest.split('/').next().unwrap_or_default();
    if location.starts_with("//") {
        Ok(format!("{scheme}:{location}"))
    } else if location.starts_with('/') {
        Ok(format!("{scheme}://{authority}{location}"))
    } else {
        Err("site returned an unsupported relative redirect".into())
    }
}

fn parse_retry_after(value: &str) -> Option<Duration> {
    if let Ok(seconds) = value.trim().parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let date = httpdate::parse_http_date(value).ok()?;
    Some(
        date.duration_since(SystemTime::now())
            .unwrap_or(Duration::ZERO),
    )
}

fn user_agent(site: Site, secrets: &ApiSecrets) -> String {
    let version = env!("CARGO_PKG_VERSION");
    if site == Site::Danbooru {
        if let Some(id) = secrets.danbooru_user_id.as_deref() {
            return format!("wallpaper-sorter/{version} (user #{id})");
        }
    }
    format!("wallpaper-sorter/{version} (local desktop client)")
}

fn require_json(response: &Response) -> Result<(), String> {
    if response
        .header("Content-Type")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .starts_with("application/json")
    {
        Ok(())
    } else {
        Err("site returned a non-JSON API response".into())
    }
}

fn read_json_response(response: Response) -> Result<Value, String> {
    if response
        .header("Content-Length")
        .and_then(|length| length.parse::<u64>().ok())
        .is_some_and(|length| length > MAX_API_BYTES)
    {
        return Err("site API response is too large".into());
    }
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_API_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "could not read the site API response".to_string())?;
    if bytes.len() as u64 > MAX_API_BYTES {
        return Err("site API response is too large".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "site returned invalid JSON".into())
}

fn extension_from_mime(mime: &str) -> Option<&'static str> {
    match mime.to_ascii_lowercase().as_str() {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        "image/bmp" => Some("bmp"),
        _ => None,
    }
}

fn normalize_extension(extension: &str) -> Option<&'static str> {
    match extension
        .trim_start_matches('.')
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "webp" => Some("webp"),
        "gif" => Some("gif"),
        "bmp" => Some("bmp"),
        _ => None,
    }
}

fn image_format(path: &Path) -> Result<ImageFormat, String> {
    let mut file = File::open(path).map_err(|_| "cannot read the downloaded image".to_string())?;
    let mut header = [0u8; 32];
    let count = file
        .read(&mut header)
        .map_err(|_| "cannot inspect the downloaded image".to_string())?;
    let format = image::guess_format(&header[..count])
        .map_err(|_| "downloaded response is not a supported image".to_string())?;
    let file = File::open(path).map_err(|_| "cannot read the downloaded image".to_string())?;
    let (width, height) = ImageReader::with_format(BufReader::new(file), format)
        .into_dimensions()
        .map_err(|_| "downloaded image header is invalid".to_string())?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 100_000_000 {
        return Err("downloaded image dimensions are invalid or too large".into());
    }
    Ok(format)
}

fn extension_for(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Jpeg => Some("jpg"),
        ImageFormat::Png => Some("png"),
        ImageFormat::WebP => Some("webp"),
        ImageFormat::Gif => Some("gif"),
        ImageFormat::Bmp => Some("bmp"),
        _ => None,
    }
}

fn ensure_fetch_temp_dir(root: &Path) -> Result<PathBuf, String> {
    let sorter_dir = root.join(".sorter");
    let temp_dir = sorter_dir.join("tmp");
    for path in [&sorter_dir, &temp_dir] {
        match fs::create_dir(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("cannot create fetch staging folder".into()),
        }
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| "cannot access fetch staging folder".to_string())?;
        if !metadata.file_type().is_dir() {
            return Err("fetch staging path must be a real directory".into());
        }
    }
    Ok(temp_dir)
}

fn site_slug(site: Site) -> &'static str {
    match site {
        Site::Wallhaven => "wallhaven",
        Site::Danbooru => "danbooru",
        _ => "unknown",
    }
}

fn relative_to(root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(root)
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "download escaped the library folder".into())
}

fn unique_target(
    directory: &Path,
    name: &str,
    mut move_file: impl FnMut(&Path) -> Result<(), ExecError>,
) -> Result<PathBuf, String> {
    let base = directory.join(name);
    for suffix in 1u64.. {
        let target = if suffix == 1 {
            base.clone()
        } else {
            let stem = base.file_stem().unwrap_or_default().to_string_lossy();
            let extension = base
                .extension()
                .map(|value| format!(".{}", value.to_string_lossy()))
                .unwrap_or_default();
            base.with_file_name(format!("{stem} ({suffix}){extension}"))
        };
        match move_file(&target) {
            Ok(()) => return Ok(target),
            Err(ExecError::TargetExists(_)) => continue,
            Err(error) => return Err(format!("could not place fetched image: {error}")),
        }
    }
    unreachable!("unbounded suffix loop always returns")
}

fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

fn remove_partial(path: &Path) -> Result<(), String> {
    fs::remove_file(path).map_err(|_| "cannot remove an invalid partial download".into())
}

fn result_from_outcome(
    outcome: &Outcome,
    source: &Path,
    character_suggestions: Vec<CharacterSuggestion>,
) -> ItemResult {
    if let Some(error) = &outcome.report.error {
        return ItemResult {
            state: FetchState::Error,
            location: None,
            message: format!("sorting stopped: {error}"),
            character_suggestions,
        };
    }
    for action in &outcome.plan.actions {
        match action {
            Action::Move { from, to, .. } if Path::new(from) == source => {
                let duplicate = outcome.report.done.iter().any(|entry| {
                    entry.from == *from && entry.kind == sorter_engine::Kind::Duplicate
                });
                return ItemResult {
                    state: if duplicate {
                        FetchState::Duplicate
                    } else {
                        FetchState::Sorted
                    },
                    location: Some(to.clone()),
                    message: if duplicate {
                        format!("duplicate sent to {to}")
                    } else {
                        format!("sorted into {to}")
                    },
                    character_suggestions,
                };
            }
            Action::Leave { path, reason } if Path::new(path) == source => {
                return ItemResult {
                    state: FetchState::Inbox,
                    location: Some(path.clone()),
                    message: format!("left in the Inbox ({reason:?})"),
                    character_suggestions,
                };
            }
            Action::ToDuplicates { from, to, .. } if Path::new(from) == source => {
                return ItemResult {
                    state: FetchState::Duplicate,
                    location: Some(to.clone()),
                    message: format!("duplicate sent to {to}"),
                    character_suggestions,
                };
            }
            _ => {}
        }
    }
    ItemResult {
        state: FetchState::Error,
        location: None,
        message: "sorter did not report a result for the downloaded image".into(),
        character_suggestions,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        check_rating, danbooru_character_suggestions, danbooru_hints, get_follow, parse_input,
        parse_retry_after, process_one, FetchState, RateLimiter, SiteEndpoints,
    };
    use crate::daemon::{Daemon, Options};
    use crate::secrets::ApiSecrets;
    use image::ImageFormat;
    use sorter_core::{Config, Site};
    use std::fs;
    use std::io::{BufRead, BufReader, Cursor, Write};
    use std::net::TcpListener;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread::JoinHandle;
    use std::time::Duration;
    use ureq::AgentBuilder;

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    struct FakeResponse {
        status: u16,
        content_type: &'static str,
        headers: Vec<(&'static str, String)>,
        body: Vec<u8>,
    }

    fn response(status: u16, content_type: &'static str, body: Vec<u8>) -> FakeResponse {
        FakeResponse {
            status,
            content_type,
            headers: Vec::new(),
            body,
        }
    }

    fn fake_server(responses: Vec<FakeResponse>) -> (String, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap().to_string();
        let base_url = format!("http://{address}");
        let worker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                reader.read_line(&mut request).unwrap();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    request.push_str(&line);
                }
                requests.push(request);
                let status_text = if response.status == 429 {
                    "Too Many Requests"
                } else {
                    "OK"
                };
                let mut headers = format!(
                    "HTTP/1.1 {} {status_text}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
                    response.status,
                    response.content_type,
                    response
                        .body
                        .len()
                );
                for (name, value) in response.headers {
                    headers.push_str(&format!("{name}: {value}\r\n"));
                }
                headers.push_str("\r\n");
                let original_length = response.body.len();
                let body = match String::from_utf8(response.body.clone()) {
                    Ok(text) => text.replace("__BASE__", &base_url).into_bytes(),
                    Err(_) => response.body,
                };
                let headers = headers.replace(
                    &format!("Content-Length: {original_length}\r\n"),
                    &format!("Content-Length: {}\r\n", body.len()),
                );
                stream.write_all(headers.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
            }
            requests
        });
        (address, worker)
    }

    fn png() -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "sorter-{label}-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn refuses_symlinked_fetch_staging_directory() {
        let root = temp_dir("fetch-staging-symlink");
        let outside = temp_dir("fetch-staging-outside");
        fs::create_dir(root.join(".sorter")).unwrap();
        fs::write(outside.join("sentinel"), "untouched").unwrap();
        symlink(&outside, root.join(".sorter/tmp")).unwrap();

        assert!(super::ensure_fetch_temp_dir(&root).is_err());
        assert_eq!(
            fs::read_to_string(outside.join("sentinel")).unwrap(),
            "untouched"
        );

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    fn config() -> Config {
        Config::from_toml("[[tag]]\nkeywords = [\"chisa\"]\ndest = \"Chisa\"\n").unwrap()
    }

    fn endpoints(address: &str) -> SiteEndpoints {
        SiteEndpoints {
            wallhaven_api: format!("http://{address}/api/v1"),
            danbooru_api: format!("http://{address}"),
            wallhaven_image_hosts: vec![address.to_string()],
            danbooru_image_hosts: vec![address.to_string()],
            allow_http: true,
        }
    }

    #[test]
    fn accepts_only_supported_ids_and_post_urls() {
        assert_eq!(
            parse_input(Some("Wallhaven"), "abc123").unwrap().id,
            "abc123"
        );
        assert_eq!(
            parse_input(None, "https://danbooru.donmai.us/posts/123456")
                .unwrap()
                .id,
            "123456"
        );
        assert!(parse_input(Some("Wallhaven"), "1234").is_err());
        assert!(parse_input(None, "https://example.com/posts/123").is_err());
        assert_eq!(
            parse_input(Some("Danbooru"), "https://wallhaven.cc/w/abc123")
                .unwrap()
                .site,
            Site::Wallhaven
        );
    }

    #[test]
    fn danbooru_character_aliases_produce_two_matching_hints() {
        assert_eq!(
            danbooru_hints("chisa_(wuthering_waves)"),
            ["chisa", "wuthering waves"]
        );
        assert_eq!(danbooru_hints("wuthering_waves"), ["wuthering waves"]);
    }

    #[test]
    fn danbooru_character_suggestions_separate_character_and_series() {
        let suggestions =
            danbooru_character_suggestions("lucielle_(wuthering_waves) chisa_(wuthering_waves)");

        assert_eq!(suggestions.len(), 2);
        assert_eq!(suggestions[0].keyword, "lucielle");
        assert_eq!(suggestions[0].series.as_deref(), Some("wuthering waves"));
    }

    #[test]
    fn default_rating_guards_reject_wider_content() {
        assert!(check_rating(Site::Danbooru, "g", "g", "sfw").is_ok());
        assert!(check_rating(Site::Danbooru, "q", "g", "sfw").is_err());
        assert!(check_rating(Site::Wallhaven, "sketchy", "g", "sfw").is_err());
        assert!(check_rating(Site::Wallhaven, "nsfw", "g", "nsfw").is_ok());
    }

    #[test]
    fn retry_after_supports_seconds_and_http_dates() {
        assert_eq!(parse_retry_after("3"), Some(Duration::from_secs(3)));
        assert_eq!(parse_retry_after("not a date"), None);
    }

    #[test]
    fn fake_wallhaven_fetch_sorts_and_persists_metadata_without_leaking_keys() {
        let image = png();
        let (address, server) = fake_server(vec![
            response(
                200,
                "application/json",
                format!(
                    "{{\"data\":{{\"id\":\"abc123\",\"purity\":\"sfw\",\"path\":\"__BASE__/image.png\",\"file_type\":\"image/png\",\"tags\":[{{\"name\":\"chisa\"}}]}}}}"
                )
                .into_bytes(),
            ),
            response(200, "image/png", image),
        ]);
        let root = temp_dir("fetch-integration");
        let config_path = root.join("config.toml");
        fs::write(
            &config_path,
            "[[tag]]\nkeywords = [\"chisa\"]\ndest = \"Chisa\"\n",
        )
        .unwrap();
        let daemon = Daemon::start_with(
            root.clone(),
            config(),
            Options::default(),
            Some(config_path),
        )
        .unwrap();
        let shared = daemon.handle();
        let secret_path = root.join("secrets.toml");
        fs::write(
            &secret_path,
            "wallhaven_api_key = \"not-for-the-image-host\"\n",
        )
        .unwrap();
        let endpoints = endpoints(&address);
        let agent = AgentBuilder::new().redirects(0).build();
        let item = parse_input(Some("Wallhaven"), "abc123").unwrap();

        let result = process_one(
            &item,
            &shared,
            &secret_path,
            &endpoints,
            &agent,
            &RateLimiter::without_delay(),
            1,
            0,
        )
        .unwrap();
        let requests = server.join().unwrap();

        assert!(matches!(result.state, FetchState::Sorted));
        assert_eq!(result.location.as_deref(), Some("Chisa/Chisa 1.png"));
        assert!(root.join("Chisa/Chisa 1.png").is_file());
        let origin = shared.lock().origins.all().next().unwrap().clone();
        assert_eq!(origin.tags, ["chisa"]);
        assert_eq!(origin.rating.as_deref(), Some("sfw"));
        assert!(requests[0].to_ascii_lowercase().contains("x-api-key:"));
        assert!(!requests[1].to_ascii_lowercase().contains("x-api-key:"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn fake_danbooru_fetch_uses_only_character_and_copyright_tags() {
        let image = png();
        let (address, server) = fake_server(vec![
            response(
                200,
                "application/json",
                br#"{"id":123456,"rating":"g","file_url":"__BASE__/danbooru.png","file_ext":"png","tag_string_character":"chisa_(wuthering_waves) lucielle_(wuthering_waves)","tag_string_copyright":"wuthering_waves","tag_string_artist":"skadi"}"#
                    .to_vec(),
            ),
            response(200, "image/png", image),
        ]);
        let root = temp_dir("danbooru-integration");
        let config_path = root.join("config.toml");
        fs::write(&config_path, "").unwrap();
        let daemon = Daemon::start_with(
            root.clone(),
            config(),
            Options::default(),
            Some(config_path),
        )
        .unwrap();
        let shared = daemon.handle();
        let secret_path = root.join("secrets.toml");
        fs::write(
            &secret_path,
            "danbooru_username = \"alice\"\ndanbooru_api_key = \"not-for-the-cdn\"\ndanbooru_user_id = \"123\"\n",
        )
        .unwrap();

        let result = process_one(
            &parse_input(Some("Danbooru"), "123456").unwrap(),
            &shared,
            &secret_path,
            &endpoints(&address),
            &AgentBuilder::new().redirects(0).build(),
            &RateLimiter::without_delay(),
            3,
            0,
        )
        .unwrap();
        let requests = server.join().unwrap();

        assert!(matches!(result.state, FetchState::Sorted));
        assert!(result.character_suggestions.iter().any(|suggestion| {
            suggestion.keyword == "lucielle"
                && suggestion.series.as_deref() == Some("wuthering waves")
        }));
        let origin = shared.lock().origins.all().next().unwrap().clone();
        assert_eq!(origin.tags, ["chisa", "wuthering waves", "lucielle"]);
        assert!(requests[0]
            .to_ascii_lowercase()
            .contains("authorization: basic"));
        assert!(requests[0].contains("wallpaper-sorter/"));
        assert!(requests[0].contains("user #123"));
        assert!(!requests[1].to_ascii_lowercase().contains("authorization:"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_redirect_or_url_to_an_unallowlisted_host_is_not_requested() {
        let (address, server) = fake_server(vec![response(
            200,
            "application/json",
            br#"{"data":{"id":"abc123","purity":"sfw","path":"https://127.0.0.1:9/image.png","file_type":"image/png","tags":[]}}"#.to_vec(),
        )]);
        let root = temp_dir("fetch-allowlist");
        let config_path = root.join("config.toml");
        fs::write(&config_path, "").unwrap();
        let daemon = Daemon::start_with(
            root.clone(),
            Config::default(),
            Options::default(),
            Some(config_path),
        )
        .unwrap();
        let result = process_one(
            &parse_input(Some("Wallhaven"), "abc123").unwrap(),
            &daemon.handle(),
            &root.join("secrets.toml"),
            &endpoints(&address),
            &AgentBuilder::new().redirects(0).build(),
            &RateLimiter::without_delay(),
            2,
            0,
        );
        assert!(result.err().unwrap().contains("host is not allowlisted"));
        assert_eq!(server.join().unwrap().len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn retries_a_429_after_its_retry_after_delay() {
        let (address, server) = fake_server(vec![
            {
                let mut response = response(429, "application/json", b"{}".to_vec());
                response.headers.push(("Retry-After", "0".into()));
                response
            },
            response(200, "application/json", b"{}".to_vec()),
        ]);
        let endpoint = format!("http://{address}/api/v1");
        let endpoints = endpoints(&address);
        let response = get_follow(
            Site::Wallhaven,
            &format!("{endpoint}/w/abc123"),
            &endpoints.api_hosts(Site::Wallhaven),
            true,
            &ApiSecrets::default(),
            true,
            &AgentBuilder::new().redirects(0).build(),
            &RateLimiter::without_delay(),
        )
        .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(server.join().unwrap().len(), 2);
    }
}
