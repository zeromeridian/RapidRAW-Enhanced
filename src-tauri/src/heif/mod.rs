//! HEIF, HEIC and HIF images (Plan item 48), read-only.
//!
//! Each operating system's own decoder decodes the coded image (owner decision 2026-11-17):
//! Apple ImageIO on macOS, the system's libheif loaded at run time on Linux, the Windows
//! Imaging Component with Microsoft's HEVC extension on Windows. Nothing is bundled. A
//! platform decoder returns the stored pixel values of the primary image without its
//! transforms or colour conversion; this module then applies the container's transforms and
//! converts the colours, so every platform gives the same pixels. HDR gain maps are ignored
//! (the primary image is the SDR one) and HDR curves are left as they are.

mod colour;
mod container;
#[cfg(target_os = "macos")]
mod image_io;
#[cfg(target_os = "linux")]
mod libheif;
#[cfg(target_os = "windows")]
mod wic;

use anyhow::Result;
use image::DynamicImage;

pub struct DecodedHeif {
    /// Oriented, in the working space of non-RAW images (sRGB-encoded `Rgb32F`).
    pub image: DynamicImage,
    /// The file uses an HDR curve (PQ or HLG), which is not decoded yet.
    pub is_hdr: bool,
}

// `decode_coded(bytes)` decodes the coded primary image with the platform's decoder: 8-bit
// `Rgb8` or, for more bits, `Rgb16` scaled to the full 16-bit range; no transforms, no
// colour conversion.
#[cfg(target_os = "macos")]
use image_io::decode_coded;

#[cfg(target_os = "linux")]
use libheif::decode_coded;

#[cfg(target_os = "windows")]
use wic::decode_coded;

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn decode_coded(_bytes: &[u8]) -> Result<DynamicImage> {
    Err(anyhow::anyhow!(
        "HEIF images are not supported on this platform"
    ))
}

pub fn decode(bytes: &[u8]) -> Result<DecodedHeif> {
    let info = container::parse(bytes)?;
    let coded = decode_coded(bytes)?;
    let oriented = container::apply_transforms(coded, &info);
    let image = colour::to_working_space(oriented.into_rgb32f(), info.colour.as_ref())?;
    Ok(DecodedHeif {
        image: DynamicImage::ImageRgb32F(image),
        is_hdr: colour::is_hdr(info.colour.as_ref()),
    })
}
