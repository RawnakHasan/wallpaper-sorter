//! Thumbnails, made on first request and kept on disk under the image's content hash,
//! so moving or renaming an image never makes it necessary to draw its thumbnail again.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Longest side of a thumbnail, in pixels.
const MAX_SIDE: u32 = 400;

pub struct Thumbs {
    dir: PathBuf,
    /// Only one thumbnail is drawn at a time; excess cold requests fail fast instead of waiting.
    drawing: Mutex<()>,
}

impl Thumbs {
    pub fn new(dir: PathBuf) -> Thumbs {
        Thumbs {
            dir,
            drawing: Mutex::new(()),
        }
    }

    /// $XDG_CACHE_HOME/wallpaper-sorter/thumbs, or ~/.cache/wallpaper-sorter/thumbs. Safe to delete.
    pub fn default_dir() -> PathBuf {
        let base = std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| sorter_core::expand_home("~/.cache"));
        base.join("wallpaper-sorter/thumbs")
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The JPEG thumbnail for the image with this hash, drawn from `source` if it is not cached yet.
    pub fn get(&self, hash: &str, source: &Path) -> io::Result<Vec<u8>> {
        if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "not a content hash",
            ));
        }
        let cached = self.dir.join(format!("{hash}.jpg"));
        if let Ok(bytes) = fs::read(&cached) {
            return Ok(bytes);
        }
        let _one_at_a_time = self.drawing.try_lock().map_err(|_| {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "thumbnail generation already in progress",
            )
        })?;
        if let Ok(bytes) = fs::read(&cached) {
            return Ok(bytes); // another request drew it while we waited
        }
        let bytes = draw(source)?;
        fs::create_dir_all(&self.dir)?;
        let tmp = cached.with_extension("tmp");
        fs::write(&tmp, &bytes)?;
        fs::rename(&tmp, &cached)?;
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn busy_thumbnail_generation_returns_would_block() {
        let temp = std::env::temp_dir().join(format!("sorter-thumbs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).unwrap();
        let source = temp.join("source.png");
        image::RgbImage::from_fn(20, 20, |x, y| image::Rgb([x as u8, y as u8, 100]))
            .save(&source)
            .unwrap();
        let thumbs = Thumbs::new(temp.join("cache"));
        let _held = thumbs.drawing.lock().unwrap();
        let err = thumbs
            .get(&"1".repeat(64), &source)
            .expect_err("busy thumbnail generation must not wait");
        assert_eq!(err.kind(), io::ErrorKind::WouldBlock);
        let _ = fs::remove_dir_all(&temp);
    }
}

fn draw(source: &Path) -> io::Result<Vec<u8>> {
    let bad = |e: String| io::Error::new(io::ErrorKind::InvalidData, e);
    let img = image::ImageReader::open(source)?
        .with_guessed_format()?
        .decode()
        .map_err(|e| bad(e.to_string()))?;
    let small = img.thumbnail(MAX_SIDE, MAX_SIDE).to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode(
            small.as_raw(),
            small.width(),
            small.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| bad(e.to_string()))?;
    Ok(out)
}
