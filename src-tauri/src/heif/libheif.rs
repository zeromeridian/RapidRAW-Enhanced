//! HEIF decoding through the system's libheif, loaded at run time (owner decision
//! 2026-11-17: not bundled). Decoding asks libheif to skip the image transforms, which
//! `container` applies on every platform.

use anyhow::{Result, anyhow};
use image::{DynamicImage, ImageBuffer, Rgb};
use libloading::{Library, Symbol};
use std::ffi::{CStr, c_char, c_int, c_void};
use std::ptr;
use std::sync::OnceLock;

/// Shown with any failure that a missing libheif or HEVC plugin explains (owner decision
/// 2026-11-18, Plan item 48).
const INSTALL_HINT: &str = "HEIF images on Linux need libheif and its HEVC decoder, e.g. the \
     packages libheif1 and libheif-plugin-libde265 (Debian, Ubuntu, Linux Mint) or libheif \
     (Fedora, Arch).";

const LIBRARY_NAMES: [&str; 2] = ["libheif.so.1", "libheif.so"];

// libheif's C API (heif.h), stable since libheif 1.0.
const HEIF_COLORSPACE_RGB: c_int = 1;
const HEIF_CHROMA_INTERLEAVED_RGB: c_int = 10;
const HEIF_CHROMA_INTERLEAVED_RRGGBB_LE: c_int = 14;
const HEIF_CHANNEL_INTERLEAVED: c_int = 10;
const HEIF_ERROR_OK: c_int = 0;
const HEIF_ERROR_UNSUPPORTED_FEATURE: c_int = 4;
const HEIF_ERROR_PLUGIN_LOADING_ERROR: c_int = 11;

#[repr(C)]
struct HeifError {
    code: c_int,
    subcode: c_int,
    message: *const c_char,
}

/// The leading fields of `heif_decoding_options`, which every version starts with.
#[repr(C)]
struct DecodingOptionsPrefix {
    version: u8,
    ignore_transformations: u8,
}

type ContextAlloc = unsafe extern "C" fn() -> *mut c_void;
type ReadFromMemory =
    unsafe extern "C" fn(*mut c_void, *const c_void, usize, *const c_void) -> HeifError;
type PrimaryHandle = unsafe extern "C" fn(*mut c_void, *mut *mut c_void) -> HeifError;
type Release = unsafe extern "C" fn(*const c_void);
type LumaBits = unsafe extern "C" fn(*const c_void) -> c_int;
type OptionsAlloc = unsafe extern "C" fn() -> *mut DecodingOptionsPrefix;
type OptionsFree = unsafe extern "C" fn(*mut DecodingOptionsPrefix);
type DecodeImage = unsafe extern "C" fn(
    *const c_void,
    *mut *mut c_void,
    c_int,
    c_int,
    *const DecodingOptionsPrefix,
) -> HeifError;
type PlaneReadonly = unsafe extern "C" fn(*const c_void, c_int, *mut c_int) -> *const u8;
type ChannelInt = unsafe extern "C" fn(*const c_void, c_int) -> c_int;
type Init = unsafe extern "C" fn(*const c_void) -> HeifError;

fn library() -> Result<&'static Library> {
    static LIBRARY: OnceLock<Option<Library>> = OnceLock::new();
    LIBRARY
        .get_or_init(|| {
            let library = LIBRARY_NAMES.iter().find_map(|name| {
                // SAFETY: libheif's initialisers have no preconditions.
                unsafe { Library::new(name) }.ok()
            })?;
            // Since libheif 1.13 plugins (the HEVC decoder among them) load in `heif_init`;
            // older versions have no such function and need no call.
            // SAFETY: the signature matches heif.h; a null parameter pointer is allowed.
            if let Ok(init) = unsafe { library.get::<Init>(b"heif_init\0") } {
                let error = unsafe { init(ptr::null()) };
                if error.code != HEIF_ERROR_OK {
                    log::warn!("heif_init failed: {}", message(&error));
                }
            }
            Some(library)
        })
        .as_ref()
        .ok_or_else(|| anyhow!("libheif is not installed. {INSTALL_HINT}"))
}

fn message(error: &HeifError) -> String {
    if error.message.is_null() {
        return format!("libheif error {}.{}", error.code, error.subcode);
    }
    // SAFETY: libheif's messages are static, NUL-terminated strings.
    unsafe { CStr::from_ptr(error.message) }
        .to_string_lossy()
        .into_owned()
}

fn check(error: HeifError) -> Result<()> {
    match error.code {
        HEIF_ERROR_OK => Ok(()),
        HEIF_ERROR_UNSUPPORTED_FEATURE | HEIF_ERROR_PLUGIN_LOADING_ERROR => Err(anyhow!(
            "libheif cannot decode this HEIF image: {}. {INSTALL_HINT}",
            message(&error)
        )),
        _ => Err(anyhow!(
            "libheif failed to decode this HEIF image: {}",
            message(&error)
        )),
    }
}

fn symbol<'a, T>(library: &'a Library, name: &[u8]) -> Result<Symbol<'a, T>> {
    // SAFETY: each caller names a libheif function with the matching signature.
    unsafe { library.get::<T>(name) }.map_err(|e| {
        anyhow!(
            "libheif lacks {}: {e}",
            String::from_utf8_lossy(&name[..name.len() - 1])
        )
    })
}

/// Releases a libheif object when dropped.
struct Owned<'a> {
    pointer: *mut c_void,
    release: Symbol<'a, Release>,
}

impl Drop for Owned<'_> {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // SAFETY: `pointer` came from libheif and is released once.
            unsafe { (self.release)(self.pointer) };
        }
    }
}

pub fn decode_coded(bytes: &[u8]) -> Result<DynamicImage> {
    let lib = library()?;
    let context_alloc = symbol::<ContextAlloc>(lib, b"heif_context_alloc\0")?;
    let read_from_memory =
        symbol::<ReadFromMemory>(lib, b"heif_context_read_from_memory_without_copy\0")?;
    let primary_handle = symbol::<PrimaryHandle>(lib, b"heif_context_get_primary_image_handle\0")?;
    let luma_bits = symbol::<LumaBits>(lib, b"heif_image_handle_get_luma_bits_per_pixel\0")?;
    let options_alloc = symbol::<OptionsAlloc>(lib, b"heif_decoding_options_alloc\0")?;
    let options_free = symbol::<OptionsFree>(lib, b"heif_decoding_options_free\0")?;
    let decode_image = symbol::<DecodeImage>(lib, b"heif_decode_image\0")?;
    let plane = symbol::<PlaneReadonly>(lib, b"heif_image_get_plane_readonly\0")?;
    let image_width = symbol::<ChannelInt>(lib, b"heif_image_get_width\0")?;
    let image_height = symbol::<ChannelInt>(lib, b"heif_image_get_height\0")?;
    let bit_range = symbol::<ChannelInt>(lib, b"heif_image_get_bits_per_pixel_range\0")?;

    // SAFETY: every call below follows heif.h; each object is released by its owner, the
    // context outlives the handle and image made from it, and `bytes` outlives the context
    // (it is read without a copy).
    unsafe {
        let context = Owned {
            pointer: context_alloc(),
            release: symbol::<Release>(lib, b"heif_context_free\0")?,
        };
        if context.pointer.is_null() {
            return Err(anyhow!("libheif could not allocate a context"));
        }
        check(read_from_memory(
            context.pointer,
            bytes.as_ptr().cast(),
            bytes.len(),
            ptr::null(),
        ))?;

        let mut handle_pointer = ptr::null_mut();
        check(primary_handle(context.pointer, &mut handle_pointer))?;
        let handle = Owned {
            pointer: handle_pointer,
            release: symbol::<Release>(lib, b"heif_image_handle_release\0")?,
        };

        let deep = luma_bits(handle.pointer) > 8;
        let chroma = if deep {
            HEIF_CHROMA_INTERLEAVED_RRGGBB_LE
        } else {
            HEIF_CHROMA_INTERLEAVED_RGB
        };
        let options = options_alloc();
        if options.is_null() {
            return Err(anyhow!("libheif could not allocate decoding options"));
        }
        (*options).ignore_transformations = 1;
        let mut image_pointer = ptr::null_mut();
        let decoded = decode_image(
            handle.pointer,
            &mut image_pointer,
            HEIF_COLORSPACE_RGB,
            chroma,
            options,
        );
        options_free(options);
        check(decoded)?;
        let image = Owned {
            pointer: image_pointer,
            release: symbol::<Release>(lib, b"heif_image_release\0")?,
        };

        let width = image_width(image.pointer, HEIF_CHANNEL_INTERLEAVED);
        let height = image_height(image.pointer, HEIF_CHANNEL_INTERLEAVED);
        let mut stride: c_int = 0;
        let data = plane(image.pointer, HEIF_CHANNEL_INTERLEAVED, &mut stride);
        if data.is_null() || width <= 0 || height <= 0 || stride <= 0 {
            return Err(anyhow!("libheif returned no pixels for this HEIF image"));
        }
        let (width, height, stride) = (width as usize, height as usize, stride as usize);
        let row_bytes = width * if deep { 6 } else { 3 };
        if stride < row_bytes {
            return Err(anyhow!("libheif returned truncated HEIF pixel data"));
        }
        let rows = std::slice::from_raw_parts(data, stride * (height - 1) + row_bytes);

        if deep {
            // Values use `bits` of each 16-bit word; scale them to the full range.
            let bits = bit_range(image.pointer, HEIF_CHANNEL_INTERLEAVED).clamp(9, 16);
            let max = ((1u32 << bits) - 1) as f32;
            let mut values = Vec::with_capacity(width * height * 3);
            for y in 0..height {
                let row = &rows[y * stride..y * stride + row_bytes];
                values.extend(row.chunks_exact(2).map(|b| {
                    let v = u16::from_le_bytes([b[0], b[1]]) as f32;
                    (v / max * 65535.0).round().min(65535.0) as u16
                }));
            }
            ImageBuffer::<Rgb<u16>, _>::from_raw(width as u32, height as u32, values)
                .map(DynamicImage::ImageRgb16)
        } else {
            let mut values = Vec::with_capacity(width * height * 3);
            for y in 0..height {
                values.extend_from_slice(&rows[y * stride..y * stride + row_bytes]);
            }
            ImageBuffer::<Rgb<u8>, _>::from_raw(width as u32, height as u32, values)
                .map(DynamicImage::ImageRgb8)
        }
        .ok_or_else(|| anyhow!("libheif returned a HEIF image of the wrong size"))
    }
}
