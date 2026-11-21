//! Where an image came from, worked out from its original filename (and, for Pixiv, its folder).
//! No network and no file access.

use crate::matcher::split_name;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Site {
    Wallhaven,
    Zerochan,
    Konachan,
    YandeRe,
    Danbooru,
    Safebooru,
    Pixiv,
    Unknown,
}

impl Site {
    pub fn label(self) -> &'static str {
        match self {
            Site::Wallhaven => "Wallhaven",
            Site::Zerochan => "Zerochan",
            Site::Konachan => "Konachan",
            Site::YandeRe => "yande.re",
            Site::Danbooru => "Danbooru",
            Site::Safebooru => "Safebooru",
            Site::Pixiv => "Pixiv",
            Site::Unknown => "Unknown",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub site: Site,
    /// The site's id for the image (for older Danbooru names, the md5). Empty when unknown.
    pub id: String,
    /// Link to the page for this image. Empty when unknown.
    pub url: String,
    /// Pixiv page number (the "_p0" part).
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub artist_id: Option<String>,
}

impl Site {
    /// The site for a label such as "yande.re" (any case).
    pub fn from_label(label: &str) -> Option<Site> {
        [
            Site::Wallhaven,
            Site::Zerochan,
            Site::Konachan,
            Site::YandeRe,
            Site::Danbooru,
            Site::Safebooru,
            Site::Pixiv,
            Site::Unknown,
        ]
        .into_iter()
        .find(|s| s.label().eq_ignore_ascii_case(label))
    }
}

impl Source {
    /// A source entered by hand: the link is worked out from the site and id.
    pub fn manual(site: Site, id: &str) -> Source {
        simple(site, id)
    }

    pub fn unknown() -> Source {
        Source {
            site: Site::Unknown,
            id: String::new(),
            url: String::new(),
            page: None,
            artist: None,
            artist_id: None,
        }
    }

    /// Same site, id and page: the same place on the web.
    pub fn same_origin(&self, other: &Source) -> bool {
        self.site == other.site && self.id == other.id && self.page == other.page
    }
}

fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    let head = s.get(..prefix.len())?;
    if head.eq_ignore_ascii_case(prefix) {
        Some(&s[prefix.len()..])
    } else {
        None
    }
}

fn leading_digits(s: &str) -> &str {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    &s[..end]
}

/// The page for an image, from its site and id. Empty for Unknown.
pub fn url_for(site: Site, id: &str) -> String {
    match site {
        Site::Wallhaven => format!("https://wallhaven.cc/w/{id}"),
        Site::Zerochan => format!("https://www.zerochan.net/{id}"),
        Site::Konachan => format!("https://konachan.com/post/show/{id}"),
        Site::YandeRe => format!("https://yande.re/post/show/{id}"),
        Site::Danbooru if id.chars().all(|c| c.is_ascii_digit()) => {
            format!("https://danbooru.donmai.us/posts/{id}")
        }
        Site::Danbooru => format!("https://danbooru.donmai.us/posts?tags=md5%3A{id}"),
        Site::Safebooru => format!("https://safebooru.org/index.php?page=post&s=view&id={id}"),
        Site::Pixiv => format!("https://www.pixiv.net/artworks/{id}"),
        Site::Unknown => String::new(),
    }
}

fn simple(site: Site, id: &str) -> Source {
    Source {
        site,
        id: id.to_string(),
        url: url_for(site, id),
        page: None,
        artist: None,
        artist_id: None,
    }
}

/// Site and id for a file, from its original name. `parent_folder` is the name of the folder it was in
/// (the Pixiv extension names it "<artist>-<artist id>").
pub fn parse_source(file_name: &str, parent_folder: &str) -> Source {
    let (stem, _ext) = split_name(file_name);
    let mut s = stem;
    if let Some(rest) = strip_prefix_ci(s, "naive-") {
        s = rest;
    }

    if let Some(rest) = strip_prefix_ci(s, "wallhaven-") {
        if rest.len() == 6 && rest.chars().all(|c| c.is_ascii_alphanumeric()) {
            return simple(Site::Wallhaven, rest);
        }
        return Source::unknown();
    }
    if let Some(rest) = strip_prefix_ci(s, "konachan.com - ") {
        let id = leading_digits(rest);
        if !id.is_empty() {
            return simple(Site::Konachan, id);
        }
    }
    if let Some(rest) = strip_prefix_ci(s, "yande.re ") {
        let id = leading_digits(rest);
        if !id.is_empty() {
            return simple(Site::YandeRe, id);
        }
    }
    if let Some(rest) = strip_prefix_ci(s, "danbooru-") {
        let id = leading_digits(rest);
        let suffix = &rest[id.len()..];
        if !id.is_empty()
            && (suffix.is_empty()
                || suffix
                    .strip_prefix(" (")
                    .and_then(|value| value.strip_suffix(')'))
                    .is_some_and(|number| {
                        !number.is_empty() && number.chars().all(|c| c.is_ascii_digit())
                    }))
        {
            return simple(Site::Danbooru, id);
        }
    }
    // Zerochan: "<Name>.full.<id>"
    if let Some(i) = s.rfind(".full.") {
        let id = &s[i + 6..];
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
            return simple(Site::Zerochan, id);
        }
    }
    // Danbooru: "__<tags>__<md5>"
    if s.len() >= 34 && s.is_char_boundary(s.len() - 32) {
        let (head, md5) = s.split_at(s.len() - 32);
        if head.ends_with("__") && md5.chars().all(|c| c.is_ascii_hexdigit()) {
            return simple(Site::Danbooru, md5);
        }
    }
    // Pixiv: "<illustration id>_p<page>" optionally followed by "--" and more
    let id = leading_digits(s);
    if id.len() >= 5 {
        if let Some(rest) = s[id.len()..].strip_prefix("_p") {
            let page = leading_digits(rest);
            let after = &rest[page.len()..];
            let ends_cleanly = after
                .chars()
                .next()
                .map_or(true, |c| !c.is_ascii_alphanumeric());
            if !page.is_empty() && ends_cleanly {
                let (artist, artist_id) = match parent_folder.rsplit_once('-') {
                    Some((name, num))
                        if !name.is_empty()
                            && !num.is_empty()
                            && num.chars().all(|c| c.is_ascii_digit()) =>
                    {
                        (Some(name.to_string()), Some(num.to_string()))
                    }
                    _ => (None, None),
                };
                return Source {
                    site: Site::Pixiv,
                    id: id.to_string(),
                    url: url_for(Site::Pixiv, id),
                    page: page.parse().ok(),
                    artist,
                    artist_id,
                };
            }
        }
    }
    Source::unknown()
}
