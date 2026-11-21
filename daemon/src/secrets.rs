use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
pub(crate) struct ApiSecrets {
    pub(crate) wallhaven_api_key: Option<String>,
    pub(crate) danbooru_username: Option<String>,
    pub(crate) danbooru_api_key: Option<String>,
    pub(crate) danbooru_user_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(crate) struct SecretsUpdate {
    wallhaven_api_key: Option<String>,
    danbooru_username: Option<String>,
    danbooru_api_key: Option<String>,
    danbooru_user_id: Option<String>,
    clear_wallhaven: bool,
    clear_danbooru: bool,
}

#[derive(Serialize)]
pub(crate) struct SecretsStatus {
    wallhaven_saved: bool,
    danbooru_saved: bool,
    danbooru_username: Option<String>,
    danbooru_user_id: Option<String>,
}

impl ApiSecrets {
    fn read(path: &Path) -> Result<Self, String> {
        match fs::read_to_string(path) {
            Ok(text) => toml::from_str(&text)
                .map_err(|_| "secrets.toml is invalid; correct the file before fetching".into()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("cannot read secrets.toml".into()),
        }
    }

    fn status(&self) -> SecretsStatus {
        SecretsStatus {
            wallhaven_saved: self.wallhaven_api_key.is_some(),
            danbooru_saved: self.danbooru_username.is_some() && self.danbooru_api_key.is_some(),
            danbooru_username: self.danbooru_username.clone(),
            danbooru_user_id: self.danbooru_user_id.clone(),
        }
    }
}

pub(crate) fn load(path: &Path) -> Result<ApiSecrets, String> {
    ApiSecrets::read(path)
}

pub(crate) fn status(path: &Path) -> Result<SecretsStatus, String> {
    Ok(ApiSecrets::read(path)?.status())
}

pub(crate) fn update(path: &Path, update: SecretsUpdate) -> Result<SecretsStatus, String> {
    let mut secrets = ApiSecrets::read(path)?;
    if update.clear_wallhaven {
        secrets.wallhaven_api_key = None;
    } else if let Some(value) = update.wallhaven_api_key {
        secrets.wallhaven_api_key = Some(nonempty(value, "Wallhaven API key")?);
    }
    if update.clear_danbooru {
        secrets.danbooru_username = None;
        secrets.danbooru_api_key = None;
        secrets.danbooru_user_id = None;
    } else {
        if let Some(value) = update.danbooru_username {
            secrets.danbooru_username = Some(nonempty(value, "Danbooru username")?);
        }
        if let Some(value) = update.danbooru_api_key {
            secrets.danbooru_api_key = Some(nonempty(value, "Danbooru API key")?);
        }
        if let Some(value) = update.danbooru_user_id {
            let value = nonempty(value, "Danbooru user ID")?;
            if value.len() > 12 || !value.chars().all(|c| c.is_ascii_digit()) {
                return Err("Danbooru user ID must contain up to 12 digits".into());
            }
            secrets.danbooru_user_id = Some(value);
        }
    }
    if secrets.danbooru_username.is_some() != secrets.danbooru_api_key.is_some() {
        return Err("Danbooru credentials require both a username and API key".into());
    }
    write(path, &secrets)?;
    Ok(secrets.status())
}

fn nonempty(value: String, label: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() || value.len() > 4096 || value.chars().any(char::is_control) {
        return Err(format!(
            "{label} is empty, too long, or contains control characters"
        ));
    }
    Ok(value)
}

fn write(path: &Path, secrets: &ApiSecrets) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "secrets file has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "cannot create secrets directory".to_string())?;
    let text = toml::to_string(secrets).map_err(|_| "cannot encode secrets.toml".to_string())?;
    let (temp, mut file) = create_temp(path)?;
    let write_result = (|| -> io::Result<()> {
        use std::os::unix::fs::PermissionsExt;

        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o600))?;
        fs::rename(&temp, path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
        return Err("cannot save secrets.toml".into());
    }
    Ok(())
}

fn create_temp(path: &Path) -> Result<(PathBuf, File), String> {
    use std::os::unix::fs::OpenOptionsExt;

    for _ in 0..10 {
        let id = TEMP_ID.fetch_add(1, Ordering::Relaxed);
        let temp = path.with_file_name(format!(".secrets-{}-{id}.tmp", std::process::id()));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
        {
            Ok(file) => return Ok((temp, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("cannot create secrets.toml temporary file".into()),
        }
    }
    Err("cannot create secrets.toml temporary file".into())
}

#[cfg(test)]
mod tests {
    use super::{status, update, SecretsUpdate};
    use std::fs;

    #[test]
    fn secrets_are_write_only_and_have_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "sorter-secrets-{}-{}",
            std::process::id(),
            super::TEMP_ID.fetch_add(1, super::Ordering::Relaxed)
        ));
        let path = root.join("secrets.toml");
        let saved = update(
            &path,
            SecretsUpdate {
                wallhaven_api_key: Some("private-wallhaven-key".into()),
                danbooru_username: Some("alice".into()),
                danbooru_api_key: Some("private-danbooru-key".into()),
                danbooru_user_id: Some("123".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(saved.wallhaven_saved && saved.danbooru_saved);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let response = serde_json::to_string(&status(&path).unwrap()).unwrap();
        assert!(!response.contains("private"));
        assert!(response.contains("\"wallhaven_saved\":true"));
        assert!(response.contains("\"danbooru_username\":\"alice\""));
        assert!(response.contains("\"danbooru_user_id\":\"123\""));
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("private-wallhaven-key"));
        assert!(text.contains("private-danbooru-key"));
        fs::remove_dir_all(root).unwrap();
    }
}
