//! Memory and disk cache for AI results that replace the base image (AI
//! Denoise, Super Resolution). Each user owns one `BaseCache` with its own
//! folder, file magic and disk limit; pixels are stored losslessly as f16
//! through `cache_codec`.

use crate::cache_codec;
use crate::file_management::parse_virtual_path;
use half::f16;
use image::{DynamicImage, GenericImageView, Rgb32FImage};
use rayon::prelude::*;
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;

/// One cached result for one source file.
pub struct CachedBase {
    pub key: String,
    pub source: String,
    pub fingerprint: u64,
    pub image: Arc<Rgb32FImage>,
}

struct CacheState {
    dir: Option<PathBuf>,
    entries: Vec<Arc<CachedBase>>,
    pending: BTreeSet<String>,
    epoch: u64,
}

pub struct BaseCache {
    folder: &'static str,
    extension: &'static str,
    magic: &'static [u8; 8],
    /// Uncompressed f16 entries from older builds, still read.
    legacy_magic: Option<&'static [u8; 8]>,
    disk_limit_bytes: u64,
    memory_capacity: usize,
    /// Prefix of the `-progress`, `-ready` and `-error` events.
    event_prefix: &'static str,
    label: &'static str,
    state: Mutex<CacheState>,
}

/// The file a virtual copy's path refers to; virtual copies share results.
pub fn source_string(path: &str) -> String {
    parse_virtual_path(path).0.to_string_lossy().to_string()
}

/// A key that changes with the model or input `tag` and with the source
/// file's size and modification time.
pub fn entry_key(tag: &str, source: &str) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(tag.as_bytes());
    hasher.update(source.as_bytes());
    if let Ok(meta) = fs::metadata(source) {
        hasher.update(&meta.len().to_le_bytes());
        let modified = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
            .unwrap_or_default();
        hasher.update(&modified.as_nanos().to_le_bytes());
    }
    hasher.finalize().to_hex()[..32].to_string()
}

/// A cheap fingerprint of the decoded base, so a result made from other
/// RAW settings is regenerated.
pub fn base_fingerprint(base: &DynamicImage) -> u64 {
    let mut hasher = blake3::Hasher::new();
    let (w, h) = base.dimensions();
    hasher.update(&w.to_le_bytes());
    hasher.update(&h.to_le_bytes());
    if let Some(buf) = base.as_rgb32f() {
        let raw = buf.as_raw();
        for value in raw.iter().step_by((raw.len() / 4096).max(1)) {
            hasher.update(&value.to_bits().to_le_bytes());
        }
    }
    let bytes = hasher.finalize();
    u64::from_le_bytes(bytes.as_bytes()[..8].try_into().unwrap_or_default())
}

struct EntryHeader {
    source: String,
    fingerprint: u64,
    width: u32,
    height: u32,
    compressed: bool,
}

impl BaseCache {
    #[allow(clippy::too_many_arguments)]
    pub const fn new(
        folder: &'static str,
        extension: &'static str,
        magic: &'static [u8; 8],
        legacy_magic: Option<&'static [u8; 8]>,
        disk_limit_bytes: u64,
        memory_capacity: usize,
        event_prefix: &'static str,
        label: &'static str,
    ) -> Self {
        Self {
            folder,
            extension,
            magic,
            legacy_magic,
            disk_limit_bytes,
            memory_capacity,
            event_prefix,
            label,
            state: Mutex::new(CacheState {
                dir: None,
                entries: Vec::new(),
                pending: BTreeSet::new(),
                epoch: 0,
            }),
        }
    }

    fn state(&self) -> MutexGuard<'_, CacheState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn initialize_dir(&self, cache_dir: &Path) {
        let dir = cache_dir.join(self.folder);
        let _ = fs::create_dir_all(&dir);
        self.state().dir = Some(dir);
    }

    /// Changes whenever a result is added or the cache is cleared, so renders
    /// keyed on the adjustments alone are redone.
    pub fn epoch(&self) -> u64 {
        self.state().epoch
    }

    fn entry_path(&self, key: &str) -> Option<PathBuf> {
        self.state()
            .dir
            .as_ref()
            .map(|dir| dir.join(format!("{key}.{}", self.extension)))
    }

    fn memory_get(&self, key: &str) -> Option<Arc<CachedBase>> {
        let mut state = self.state();
        let pos = state.entries.iter().position(|e| e.key == key)?;
        let entry = state.entries.remove(pos);
        state.entries.push(Arc::clone(&entry));
        Some(entry)
    }

    fn memory_insert(&self, entry: Arc<CachedBase>) {
        let mut state = self.state();
        state.entries.retain(|e| e.key != entry.key);
        if state.entries.len() >= self.memory_capacity {
            state.entries.remove(0);
        }
        state.entries.push(entry);
    }

    fn read_header(&self, reader: &mut impl Read) -> Option<EntryHeader> {
        let mut magic = [0u8; 8];
        reader.read_exact(&mut magic).ok()?;
        let compressed = if &magic == self.magic {
            true
        } else if self.legacy_magic.is_some_and(|legacy| &magic == legacy) {
            false
        } else {
            return None;
        };
        let mut u32_buf = [0u8; 4];
        let mut u64_buf = [0u8; 8];
        reader.read_exact(&mut u32_buf).ok()?;
        let mut source = vec![0u8; u32::from_le_bytes(u32_buf) as usize];
        reader.read_exact(&mut source).ok()?;
        reader.read_exact(&mut u64_buf).ok()?;
        let fingerprint = u64::from_le_bytes(u64_buf);
        reader.read_exact(&mut u32_buf).ok()?;
        let width = u32::from_le_bytes(u32_buf);
        reader.read_exact(&mut u32_buf).ok()?;
        let height = u32::from_le_bytes(u32_buf);
        Some(EntryHeader {
            source: String::from_utf8(source).ok()?,
            fingerprint,
            width,
            height,
            compressed,
        })
    }

    /// Reads a compressed or legacy entry; an entry whose pixels cannot be
    /// read is deleted, so it is generated again instead of failing on every
    /// load.
    fn read_entry(&self, path: &Path, key: &str, source: &str) -> Option<CachedBase> {
        let mut reader = BufReader::new(File::open(path).ok()?);
        let header = self.read_header(&mut reader)?;
        if header.source != source {
            return None;
        }

        let len = header.width as usize * header.height as usize * 3;
        let halves = if header.compressed {
            let mut payload = Vec::new();
            reader
                .read_to_end(&mut payload)
                .ok()
                .and_then(|_| cache_codec::decode_rgb_f16(&payload, header.width as usize, len))
        } else {
            let mut halves = vec![f16::ZERO; len];
            reader
                .read_exact(bytemuck::cast_slice_mut(&mut halves))
                .ok()
                .map(|_| halves)
        };
        drop(reader);
        let Some(halves) = halves else {
            let _ = fs::remove_file(path);
            return None;
        };
        let data: Vec<f32> = halves.par_iter().map(|v| v.to_f32()).collect();
        drop(halves);
        let image = Rgb32FImage::from_raw(header.width, header.height, data)?;

        if let Ok(file) = File::options().write(true).open(path) {
            let _ = file.set_modified(SystemTime::now());
        }

        Some(CachedBase {
            key: key.to_string(),
            source: header.source,
            fingerprint: header.fingerprint,
            image: Arc::new(image),
        })
    }

    fn write_entry(&self, path: &Path, entry: &CachedBase) -> Result<(), String> {
        let tmp_path = path.with_extension("tmp");

        let halves: Vec<f16> = entry
            .image
            .as_raw()
            .par_iter()
            .map(|v| f16::from_f32(*v))
            .collect();
        let payload = cache_codec::encode_rgb_f16(&halves, entry.image.width() as usize)
            .map_err(|e| e.to_string())?;
        drop(halves);

        let mut file = BufWriter::new(File::create(&tmp_path).map_err(|e| e.to_string())?);
        let source = entry.source.as_bytes();
        file.write_all(self.magic)
            .and_then(|_| file.write_all(&(source.len() as u32).to_le_bytes()))
            .and_then(|_| file.write_all(source))
            .and_then(|_| file.write_all(&entry.fingerprint.to_le_bytes()))
            .and_then(|_| file.write_all(&entry.image.width().to_le_bytes()))
            .and_then(|_| file.write_all(&entry.image.height().to_le_bytes()))
            .and_then(|_| file.write_all(&payload))
            .and_then(|_| file.flush())
            .map_err(|e| e.to_string())?;
        drop(file);

        fs::rename(&tmp_path, path).map_err(|e| e.to_string())
    }

    fn evict_disk_cache(&self, keep: &Path) {
        let Some(read_dir) = keep.parent().and_then(|dir| fs::read_dir(dir).ok()) else {
            return;
        };

        let mut entries: Vec<(PathBuf, u64, SystemTime)> = read_dir
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .is_some_and(|ext| ext == self.extension)
            })
            .filter_map(|e| {
                let meta = e.metadata().ok()?;
                Some((e.path(), meta.len(), meta.modified().unwrap_or(UNIX_EPOCH)))
            })
            .collect();

        let mut total: u64 = entries.iter().map(|(_, len, _)| len).sum();
        entries.sort_by_key(|(_, _, modified)| *modified);

        for (path, len, _) in entries {
            if total <= self.disk_limit_bytes {
                break;
            }
            if path != keep && fs::remove_file(&path).is_ok() {
                total = total.saturating_sub(len);
            }
        }
    }

    /// The cached result for `key`, from memory or disk.
    pub fn load(&self, key: &str, source: &str) -> Option<Arc<CachedBase>> {
        if let Some(entry) = self.memory_get(key) {
            return (entry.source == source).then_some(entry);
        }

        let entry = Arc::new(self.read_entry(&self.entry_path(key)?, key, source)?);
        self.memory_insert(Arc::clone(&entry));
        Some(entry)
    }

    /// Whether a result made from this exact base exists, without reading
    /// its pixels from disk.
    pub fn is_ready(&self, key: &str, source: &str, fingerprint: u64) -> bool {
        if let Some(entry) = self.memory_get(key) {
            return entry.source == source && entry.fingerprint == fingerprint;
        }
        self.entry_path(key)
            .and_then(|path| File::open(path).ok())
            .and_then(|file| self.read_header(&mut BufReader::new(file)))
            .is_some_and(|h| h.source == source && h.fingerprint == fingerprint)
    }

    pub fn is_pending(&self, key: &str) -> bool {
        self.state().pending.contains(key)
    }

    /// Stores a new result in memory and on disk.
    pub fn store(&self, entry: CachedBase) {
        let entry = Arc::new(entry);
        match self.entry_path(&entry.key) {
            Some(path) => match self.write_entry(&path, &entry) {
                Ok(()) => self.evict_disk_cache(&path),
                Err(e) => log::warn!("Failed to persist {} cache: {}", self.label, e),
            },
            None => log::warn!("{} cache directory is not initialized", self.label),
        }
        self.memory_insert(entry);
        self.state().epoch += 1;
    }

    /// Emits this cache's progress event for `path`.
    pub fn emit_progress(&self, app_handle: &tauri::AppHandle, path: &str, progress: f32) {
        let _ = app_handle.emit(
            &format!("{}-progress", self.event_prefix),
            serde_json::json!({ "path": path, "progress": progress }),
        );
    }

    /// Runs `task` in the background unless `key` is already being
    /// generated, then announces the result and refreshes the thumbnail.
    pub fn spawn(
        &'static self,
        app_handle: &tauri::AppHandle,
        path: String,
        key: String,
        task: impl std::future::Future<Output = Result<(), String>> + Send + 'static,
    ) {
        if !self.state().pending.insert(key.clone()) {
            return;
        }
        self.emit_progress(app_handle, &path, 0.0);

        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let result = task.await;
            self.state().pending.remove(&key);
            match result {
                Ok(()) => {
                    let _ = app_handle.emit(&format!("{}-ready", self.event_prefix), &path);
                    // The thumbnail cache is keyed on the adjustment bytes, which do
                    // not change when the result appears, so force a render.
                    if let Err(error) = crate::file_management::regenerate_thumbnails(
                        vec![path.clone()],
                        app_handle,
                    )
                    .await
                    {
                        log::warn!(
                            "Failed to refresh thumbnail after {}: {}",
                            self.label,
                            error
                        );
                    }
                }
                Err(error) => {
                    log::error!("{} failed for {}: {}", self.label, path, error);
                    let _ = app_handle.emit(
                        &format!("{}-error", self.event_prefix),
                        serde_json::json!({ "path": path, "error": error }),
                    );
                }
            }
        });
    }

    fn cache_files(&self) -> Vec<(PathBuf, u64)> {
        let Some(read_dir) = self
            .state()
            .dir
            .clone()
            .and_then(|dir| fs::read_dir(dir).ok())
        else {
            return Vec::new();
        };
        read_dir
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .is_some_and(|ext| ext == self.extension || ext == "tmp")
            })
            .filter_map(|e| Some((e.path(), e.metadata().ok()?.len())))
            .collect()
    }

    pub fn size(&self) -> u64 {
        self.cache_files().iter().map(|(_, len)| len).sum()
    }

    pub fn clear(&self) -> Result<(), String> {
        for (path, _) in self.cache_files() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
        }
        let mut state = self.state();
        state.entries.clear();
        state.epoch += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{BaseCache, CachedBase};
    use half::f16;
    use image::Rgb32FImage;
    use std::fs;
    use std::sync::Arc;

    const SOURCE: &str = "/photos/IMG_0001.CR3";
    const MAGIC: &[u8; 8] = b"TEST0002";
    const LEGACY_MAGIC: &[u8; 8] = b"TEST0001";
    static CACHE: BaseCache = BaseCache::new(
        "test",
        "test",
        MAGIC,
        Some(LEGACY_MAGIC),
        u64::MAX,
        2,
        "test",
        "Test",
    );

    fn sample_entry() -> CachedBase {
        let (width, height) = (23, 19);
        let data = (0..width * height * 3)
            .map(|i| f16::from_f32(i as f32 * 0.37 - 40.0).to_f32())
            .collect();
        CachedBase {
            key: "key".to_string(),
            source: SOURCE.to_string(),
            fingerprint: 0x1234_5678_9ABC_DEF0,
            image: Arc::new(Rgb32FImage::from_raw(width, height, data).expect("image")),
        }
    }

    fn header(magic: &[u8; 8], entry: &CachedBase) -> Vec<u8> {
        let mut bytes = magic.to_vec();
        bytes.extend_from_slice(&(entry.source.len() as u32).to_le_bytes());
        bytes.extend_from_slice(entry.source.as_bytes());
        bytes.extend_from_slice(&entry.fingerprint.to_le_bytes());
        bytes.extend_from_slice(&entry.image.width().to_le_bytes());
        bytes.extend_from_slice(&entry.image.height().to_le_bytes());
        bytes
    }

    fn assert_same_entry(read: &CachedBase, written: &CachedBase) {
        assert_eq!(read.source, written.source);
        assert_eq!(read.fingerprint, written.fingerprint);
        assert_eq!(read.image.dimensions(), written.image.dimensions());
        assert_eq!(read.image.as_raw(), written.image.as_raw());
    }

    #[test]
    fn cache_entries_are_compressed_and_read_back_exactly() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("entry.test");
        let entry = sample_entry();
        CACHE.write_entry(&path, &entry).expect("writes");

        let bytes = fs::read(&path).expect("file");
        assert!(bytes.starts_with(MAGIC));
        assert!(bytes.len() < header(MAGIC, &entry).len() + entry.image.as_raw().len() * 2);
        assert_same_entry(
            &CACHE.read_entry(&path, "key", SOURCE).expect("reads"),
            &entry,
        );
        assert!(
            CACHE
                .read_entry(&path, "key", "/photos/other.CR3")
                .is_none()
        );
        assert!(path.exists());
    }

    #[test]
    fn uncompressed_entries_from_older_builds_are_still_read() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("legacy.test");
        let entry = sample_entry();
        let mut bytes = header(LEGACY_MAGIC, &entry);
        for value in entry.image.as_raw() {
            bytes.extend_from_slice(&f16::from_f32(*value).to_le_bytes());
        }
        fs::write(&path, bytes).expect("writes");

        assert_same_entry(
            &CACHE.read_entry(&path, "key", SOURCE).expect("reads"),
            &entry,
        );
    }

    #[test]
    fn unreadable_cache_entries_are_deleted() {
        let dir = tempfile::tempdir().expect("temp dir");
        let entry = sample_entry();

        let compressed = dir.path().join("compressed.test");
        CACHE.write_entry(&compressed, &entry).expect("writes");
        let bytes = fs::read(&compressed).expect("file");
        fs::write(&compressed, &bytes[..bytes.len() - 5]).expect("truncates");
        assert!(CACHE.read_entry(&compressed, "key", SOURCE).is_none());
        assert!(!compressed.exists());

        let legacy = dir.path().join("legacy.test");
        let mut bytes = header(LEGACY_MAGIC, &entry);
        bytes.extend_from_slice(&[0u8; 10]);
        fs::write(&legacy, bytes).expect("writes");
        assert!(CACHE.read_entry(&legacy, "key", SOURCE).is_none());
        assert!(!legacy.exists());
    }

    #[test]
    fn entries_with_another_magic_are_not_read() {
        static OTHER: BaseCache =
            BaseCache::new("other", "other", b"OTHR0001", None, u64::MAX, 2, "o", "O");
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("entry.test");
        CACHE.write_entry(&path, &sample_entry()).expect("writes");
        assert!(OTHER.read_entry(&path, "key", SOURCE).is_none());
    }
}
