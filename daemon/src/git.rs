use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize)]
pub struct GitChange {
    pub path: String,
    pub status: String,
    pub from: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GitStatus {
    pub repository: String,
    pub branch: String,
    pub remote: String,
    pub up_to_date: bool,
    pub commits_to_push: usize,
    pub changes: Vec<GitChange>,
}

#[derive(Debug, Serialize)]
pub struct GitCommitResult {
    pub hash: String,
    pub message: String,
    pub changed: usize,
}

#[derive(Debug, Serialize)]
pub struct GitPushResult {
    pub pushed: usize,
    pub remote: String,
    pub branch: String,
}

#[derive(Debug, Serialize)]
pub struct GitLogItem {
    pub hash: String,
    pub message: String,
    pub date: i64,
    pub local: bool,
}

fn repository_path(repository: &str) -> Result<String, String> {
    let repository = repository.trim();
    if repository.is_empty() {
        return Err("repository is required".to_string());
    }
    let expanded = sorter_core::expand_home(repository);
    if !expanded.is_dir() {
        return Err("repository folder does not exist".to_string());
    }
    Ok(expanded.to_string_lossy().to_string())
}

fn run_git(repository: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repository)
        .args(args)
        .output()
        .map_err(|error| format!("could not start git: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git {} failed", args.first().unwrap_or(&"command"))
        } else {
            stderr
        });
    }
    Ok(String::from_utf8(output.stdout).unwrap_or_default())
}

pub fn status(repository: &str) -> Result<GitStatus, String> {
    let repository = repository_path(repository)?;
    let inside = run_git(&repository, &["rev-parse", "--is-inside-work-tree"])
        .unwrap_or_default();
    if inside.trim() != "true" {
        return Err("repository folder is not a Git work tree".to_string());
    }

    let branch = run_git(&repository, &["branch", "--show-current"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let branch = if branch.is_empty() {
        "HEAD".to_string()
    } else {
        branch
    };
    let remote = run_git(&repository, &["remote", "get-url", "origin"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let remote = if remote.is_empty() { "origin".to_string() } else { remote };

    let raw = run_git(
        &repository,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    )?;
    let mut changes = Vec::new();
    let mut chunks = raw.split('\0').filter(|chunk| !chunk.is_empty()).peekable();
    while let Some(record) = chunks.next() {
        let (xy, path) = if record.len() >= 3 {
            (record[..2].to_string(), record[3..].to_string())
        } else {
            (record.to_string(), String::new())
        };
        if path.is_empty() {
            continue;
        }
        let mut from = None;
        let mut target = path.clone();
        let status = match xy.as_bytes() {
            [b'?', b'?'] => "Added",
            [b'A', _] | [_, b'A'] => "Added",
            [b'D', _] | [_, b'D'] => "Deleted",
            [b'R', _] | [_, b'R'] => {
                if let Some(next) = chunks.next() {
                    from = Some(path.clone());
                    target = next.to_string();
                }
                "Renamed"
            }
            _ => "Modified",
        };
        changes.push(GitChange {
            path: target,
            status: status.to_string(),
            from,
        });
    }

    let (commits_to_push, up_to_date) = run_git(
        &repository,
        &["rev-list", "--left-right", "--count", "@{u}...HEAD"],
    )
    .ok()
    .and_then(|line| {
        let mut parts = line.split_whitespace();
        let behind = parts.next()?.parse::<usize>().ok()?;
        let ahead = parts.next()?.parse::<usize>().ok()?;
        Some((ahead, behind == 0 && ahead == 0))
    })
    .unwrap_or((0, true));

    Ok(GitStatus {
        repository,
        branch,
        remote,
        up_to_date,
        commits_to_push,
        changes,
    })
}

pub fn commit(repository: &str, paths: &[String], message: &str) -> Result<GitCommitResult, String> {
    let repository = repository_path(repository)?;
    let message = message.trim();
    if message.is_empty() {
        return Err("commit message is required".to_string());
    }
    if paths.is_empty() {
        return Err("select at least one changed file".to_string());
    }

    let mut args = vec!["add", "--"];
    for path in paths {
        if path.is_empty() || Path::new(path).is_absolute() {
            return Err("changed paths must be repository-relative".to_string());
        }
        args.push(path);
    }
    run_git(&repository, &args)?;
    run_git(&repository, &["commit", "-m", message])?;
    let hash = run_git(&repository, &["rev-parse", "--short", "HEAD"])?
        .trim()
        .to_string();
    Ok(GitCommitResult {
        hash,
        message: message.to_string(),
        changed: paths.len(),
    })
}

pub fn push(repository: &str, remote: &str, branch: &str) -> Result<GitPushResult, String> {
    let repository = repository_path(repository)?;
    let remote = remote.trim();
    let branch = branch.trim();
    if remote.is_empty() {
        return Err("remote is required".to_string());
    }
    if branch.is_empty() {
        return Err("branch is required".to_string());
    }
    let before = run_git(&repository, &["rev-list", "--count", &format!("{remote}/{branch}..HEAD")])
        .unwrap_or_else(|_| "0".to_string())
        .trim()
        .parse::<usize>()
        .unwrap_or(0);
    run_git(&repository, &["push", remote, branch])?;
    Ok(GitPushResult {
        pushed: before,
        remote: remote.to_string(),
        branch: branch.to_string(),
    })
}

pub fn log(repository: &str, limit: usize) -> Result<Vec<GitLogItem>, String> {
    let repository = repository_path(repository)?;
    let limit = limit.min(300).max(1);
    let limit_arg = limit.to_string();
    let raw = run_git(
        &repository,
        &["log", "-n", &limit_arg, "--pretty=format:%H%x1f%s%x1f%ct%x1f%D"],
    )?;
    let remote = run_git(&repository, &["remote", "get-url", "origin"])
        .unwrap_or_default()
        .trim()
        .to_string();

    let mut items = Vec::new();
    for line in raw.lines().filter(|line| !line.is_empty()) {
        let fields: Vec<&str> = line.split('\x1f').collect();
        if fields.len() < 4 {
            continue;
        }
        let hash = fields[0].to_string();
        let message = fields[1].to_string();
        let date = fields[2].parse::<i64>().unwrap_or(0);
        let refs = fields[3];
        let local = remote.is_empty()
            || !refs
                .split(',')
                .map(|value| value.trim())
                .any(|value| value.starts_with("origin/"));
        items.push(GitLogItem {
            hash: hash.chars().take(7).collect(),
            message,
            date,
            local,
        });
    }
    Ok(items)
}
