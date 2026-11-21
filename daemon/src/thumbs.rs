//! Thumbnails, made on first request and kept on disk under the image's content hash,
//! so moving or renaming an image never makes it necessary to draw its thumbnail again.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Longest side of a thumbnail, in pixels.
const MAX_SIDE: u32 = 400;
const MAX_PREVIEW_BYTES: usize = 5 * 1024 * 1024;
const MAX_PREVIEW_PIXELS: u64 = 40_000_000;

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

    pub fn cached(&self, hash: &str) -> io::Result<Option<Vec<u8>>> {
        validate_hash(hash)?;
        match fs::read(self.dir.join(format!("{hash}.jpg"))) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Generates and stores a local thumbnail for bytes received from an allowlisted site.
    pub fn cache_preview(&self, bytes: &[u8]) -> io::Result<(String, Vec<u8>)> {
        if bytes.is_empty() || bytes.len() > MAX_PREVIEW_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "preview is empty or exceeds the size limit",
            ));
        }
        let hash = blake3::hash(bytes).to_hex().to_string();
        if let Some(cached) = self.cached(&hash)? {
            return Ok((hash, cached));
        }
        let _one_at_a_time = self.drawing.lock().map_err(|_| {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "thumbnail generation lock is poisoned",
            )
        })?;
        if let Some(cached) = self.cached(&hash)? {
            return Ok((hash, cached));
        }
        let bad = |error: String| io::Error::new(io::ErrorKind::InvalidData, error);
        let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|error| bad(error.to_string()))?;
        let (width, height) = reader
            .into_dimensions()
            .map_err(|error| bad(error.to_string()))?;
        if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PREVIEW_PIXELS {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "preview dimensions exceed the pixel limit",
            ));
        }
        let image = image::load_from_memory(bytes).map_err(|error| bad(error.to_string()))?;
        let small = image.thumbnail(MAX_SIDE, MAX_SIDE).to_rgb8();
        let mut thumbnail = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut thumbnail, 80)
            .encode(
                small.as_raw(),
                small.width(),
                small.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|error| bad(error.to_string()))?;
        fs::create_dir_all(&self.dir)?;
        let cached = self.dir.join(format!("{hash}.jpg"));
        let tmp = cached.with_extension("tmp");
        fs::write(&tmp, &thumbnail)?;
        fs::rename(tmp, cached)?;
        Ok((hash, thumbnail))
    }

    /// The JPEG thumbnail for the image with this hash, drawn from `source` if it is not cached yet.
    pub fn get(&self, hash: &str, source: &Path) -> io::Result<Vec<u8>> {
        validate_hash(hash)?;
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
        self.draw_and_cache(hash, source)
    }

    /// Regenerates the cached thumbnail, waiting for any other thumbnail draw to finish.
    pub fn refresh(&self, hash: &str, source: &Path) -> io::Result<()> {
        validate_hash(hash)?;
        let _one_at_a_time = self.drawing.lock().map_err(|_| {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "thumbnail generation lock is poisoned",
            )
        })?;
        self.draw_and_cache(hash, source)?;
        Ok(())
    }

    fn draw_and_cache(&self, hash: &str, source: &Path) -> io::Result<Vec<u8>> {
        let cached = self.dir.join(format!("{hash}.jpg"));
        let bytes = draw(source)?;
        fs::create_dir_all(&self.dir)?;
        let tmp = cached.with_extension("tmp");
        fs::write(&tmp, &bytes)?;
        fs::rename(&tmp, &cached)?;
        Ok(bytes)
    }
}

fn validate_hash(hash: &str) -> io::Result<()> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a content hash",
        ));
    }
    Ok(())
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

    #[test]
    fn gif_and_bmp_formats_draw_and_avif_is_unsupported() {
        let temp =
            std::env::temp_dir().join(format!("sorter-thumbs-formats-{}", std::process::id()));
        let _ = fs::remove_dir_all(&temp);
        fs::create_dir_all(&temp).unwrap();
        let image = image::RgbImage::from_fn(40, 20, |x, y| image::Rgb([x as u8, y as u8, 100]));

        let gif = temp.join("image.gif");
        image.save(&gif).unwrap();
        let bmp = temp.join("image.bmp");
        image.save(&bmp).unwrap();

        let gif_bytes = Thumbs::new(temp.join("cache-gif"))
            .get(&"2".repeat(64), &gif)
            .unwrap();
        let bmp_bytes = Thumbs::new(temp.join("cache-bmp"))
            .get(&"3".repeat(64), &bmp)
            .unwrap();
        assert!(gif_bytes.starts_with(&[0xff, 0xd8]));
        assert!(bmp_bytes.starts_with(&[0xff, 0xd8]));

        let avif = temp.join("image.avif");
        fs::write(&avif, b"not real avif bytes").unwrap();
        let err = Thumbs::new(temp.join("cache-avif"))
            .get(&"4".repeat(64), &avif)
            .unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::Unsupported);

        let _ = fs::remove_dir_all(&temp);
    }
}

fn draw(source: &Path) -> io::Result<Vec<u8>> {
    if source
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("avif"))
    {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "AVIF thumbnails are not supported yet",
        ));
    }
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
