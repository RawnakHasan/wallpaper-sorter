use crate::numbering::GapMode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchMode {
    /// Keyword must appear as whole words (default).
    #[default]
    Word,
    /// Keyword may appear inside a longer word.
    Substring,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Tag {
    pub keywords: Vec<String>,
    /// Folder inside the library, e.g. "Wuthering-Waves/Chisa".
    pub dest: String,
    /// File prefix; defaults to the folder name with hyphens turned into spaces.
    #[serde(default)]
    pub prefix: Option<String>,
    #[serde(default, rename = "match")]
    pub match_mode: MatchMode,
    /// If not empty, the tag only applies when at least one of these words is also in the name.
    #[serde(default)]
    pub strict_words: Vec<String>,
    /// A generic tag only applies if no specific tag matched and the name is short.
    #[serde(default)]
    pub generic: bool,
}

/// Per-folder settings that exist independently of matching tags. This lets an empty folder, or a
/// folder with several tags, keep one stable file prefix.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Folder {
    /// Folder inside the library.
    pub path: String,
    #[serde(default)]
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct Settings {
    pub image_extensions: Vec<String>,
    pub duplicates_folder: String,
    pub generic_max_words: usize,
    pub gap_mode: GapMode,
    #[serde(default = "default_danbooru_rating")]
    pub danbooru_rating: String,
    #[serde(default = "default_wallhaven_purity")]
    pub wallhaven_purity: String,
    #[serde(default = "default_yandere_rating")]
    pub yandere_rating: String,
    #[serde(default = "default_safebooru_rating")]
    pub safebooru_rating: String,
}

fn default_danbooru_rating() -> String {
    "g".to_string()
}
fn default_wallhaven_purity() -> String {
    "sfw".to_string()
}
fn default_yandere_rating() -> String {
    "s".to_string()
}
fn default_safebooru_rating() -> String {
    "general".to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            image_extensions: ["jpg", "jpeg", "png", "webp", "avif", "gif", "bmp"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            duplicates_folder: "Duplicates".to_string(),
            generic_max_words: 4,
            gap_mode: GapMode::Keep,
            danbooru_rating: "g".to_string(),
            wallhaven_purity: "sfw".to_string(),
            yandere_rating: "s".to_string(),
            safebooru_rating: "general".to_string(),
        }
    }
}

fn yes() -> bool {
    true
}

fn no() -> bool {
    false
}

/// A folder outside (or inside) the library whose new images are sorted into the library.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Intake {
    /// May start with "~/".
    pub path: String,
    /// Also watch subfolders, including ones created later (default true).
    #[serde(default = "yes")]
    pub recursive: bool,
    /// Remove subfolders once they have stayed empty for a while (default false).
    #[serde(default = "no")]
    pub remove_empty_folders: bool,
}

fn default_port() -> u16 {
    8421
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct ServerCfg {
    /// The web page and its API listen on 127.0.0.1 only.
    pub port: u16,
}

impl Default for ServerCfg {
    fn default() -> Self {
        ServerCfg {
            port: default_port(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub setup_complete: bool,
    #[serde(default)]
    pub server: ServerCfg,
    /// The library folder, e.g. "~/Pictures/Wallpapers". Can also be given on the command line.
    #[serde(default)]
    pub library: Option<String>,
    #[serde(default)]
    pub intake: Vec<Intake>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default, rename = "tag")]
    pub tags: Vec<Tag>,
    #[serde(default, rename = "folder")]
    pub folders: Vec<Folder>,
}

impl Config {
    pub fn from_toml(text: &str) -> Result<Config, toml::de::Error> {
        let cfg: Config = toml::from_str(text)?;
        if !["g", "s", "q", "e"].contains(&cfg.settings.danbooru_rating.as_str()) {
            return Err(<toml::de::Error as serde::de::Error>::custom(
                "settings.danbooru_rating must be g, s, q, or e",
            ));
        }
        if !["sfw", "sketchy", "nsfw"].contains(&cfg.settings.wallhaven_purity.as_str()) {
            return Err(<toml::de::Error as serde::de::Error>::custom(
                "settings.wallhaven_purity must be sfw, sketchy, or nsfw",
            ));
        }
        if !["s", "q", "e"].contains(&cfg.settings.yandere_rating.as_str()) {
            return Err(<toml::de::Error as serde::de::Error>::custom(
                "settings.yandere_rating must be s, q, or e",
            ));
        }
        if !["general", "safe", "questionable", "explicit"]
            .contains(&cfg.settings.safebooru_rating.as_str())
        {
            return Err(<toml::de::Error as serde::de::Error>::custom(
                "settings.safebooru_rating must be general, safe, questionable, or explicit",
            ));
        }
        Ok(cfg)
    }

    /// File prefix for a destination folder: an explicit folder prefix, then a tag prefix, else
    /// the folder name with hyphens turned into spaces ("Wuthering-Waves" becomes "Wuthering Waves").
    pub fn prefix_for(&self, dest: &str) -> String {
        for f in &self.folders {
            if f.path == dest {
                if let Some(p) = &f.prefix {
                    return p.clone();
                }
            }
        }
        for t in &self.tags {
            if t.dest == dest {
                if let Some(p) = &t.prefix {
                    return p.clone();
                }
            }
        }
        dest.rsplit('/').next().unwrap_or(dest).replace('-', " ")
    }
}
