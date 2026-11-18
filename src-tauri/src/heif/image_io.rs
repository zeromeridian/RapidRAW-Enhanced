//! HEIF decoding through Apple ImageIO. `CGImageSourceCreateImageAtIndex` returns the stored
//! image: not rotated (ImageIO reports the orientation separately) and in the file's own
//! colour space, so its pixels are read as they are.

use anyhow::{Result, anyhow};
use image::{DynamicImage, ImageBuffer, Rgb};
use objc2_core_foundation::CFData;
use objc2_core_graphics::{
    CGDataProvider, CGImage, CGImageAlphaInfo, CGImageByteOrderInfo, CGImageComponentInfo,
    CGImagePixelFormatInfo,
};
use objc2_image_io::CGImageSource;
use rayon::prelude::*;

/// How the channels of a pixel are stored.
#[derive(Clone, Copy)]
enum Encoding {
    /// One byte per channel; `reversed` for pixels stored as a little-endian 32-bit word.
    Bytes { reversed: bool },
    /// Two bytes per channel.
    Words { little_endian: bool },
    /// `RGB101010`: three 10-bit channels in one 32-bit word, the two spare bits first
    /// (most significant) or last. ImageIO returns 10-bit HEIF (Fujifilm, Sony) this way.
    Packed10 { little_endian: bool },
}

/// Where each channel of a pixel sits in its bytes.
struct Layout {
    bytes_per_pixel: usize,
    encoding: Encoding,
    /// Index of the first colour channel (1 when alpha comes first).
    first_colour: usize,
    grey: bool,
}

impl Layout {
    fn of(image: &CGImage) -> Result<Self> {
        let image = Some(image);
        let bits_per_component = CGImage::bits_per_component(image);
        let bits_per_pixel = CGImage::bits_per_pixel(image);
        let alpha = CGImage::alpha_info(image);
        let order = CGImage::byte_order_info(image);
        let format = CGImage::pixel_format_info(image);
        let unsupported = || {
            anyhow!(
                "Unsupported HEIF pixel layout from ImageIO ({bits_per_component} bits per \
                 component, {bits_per_pixel} per pixel, alpha {}, byte order {:#x}, \
                 format {:#x})",
                alpha.0,
                order.0,
                format.0
            )
        };

        let is_float = CGImage::bitmap_info(image).bits() & CGImageComponentInfo::Float.0 != 0;
        if is_float || alpha == CGImageAlphaInfo::Only {
            return Err(unsupported());
        }
        let alpha_first = matches!(
            alpha,
            CGImageAlphaInfo::PremultipliedFirst
                | CGImageAlphaInfo::First
                | CGImageAlphaInfo::NoneSkipFirst
        );

        if format == CGImagePixelFormatInfo::RGB101010 {
            let little_endian = match order {
                CGImageByteOrderInfo::Order32Little => true,
                CGImageByteOrderInfo::OrderDefault | CGImageByteOrderInfo::Order32Big => false,
                _ => return Err(unsupported()),
            };
            if bits_per_component != 10 || bits_per_pixel != 32 {
                return Err(unsupported());
            }
            return Ok(Self {
                bytes_per_pixel: 4,
                encoding: Encoding::Packed10 { little_endian },
                first_colour: usize::from(alpha_first),
                grey: false,
            });
        }

        if format != CGImagePixelFormatInfo::Packed
            || !matches!(bits_per_component, 8 | 16)
            || !bits_per_pixel.is_multiple_of(bits_per_component)
        {
            return Err(unsupported());
        }
        let channels = bits_per_pixel / bits_per_component;
        let has_alpha = alpha != CGImageAlphaInfo::None;
        let colour_channels = channels - usize::from(has_alpha);
        if !matches!(colour_channels, 1 | 3) {
            return Err(unsupported());
        }

        let encoding = match (bits_per_component, order) {
            (16, CGImageByteOrderInfo::Order16Little) => Encoding::Words {
                little_endian: true,
            },
            (16, CGImageByteOrderInfo::OrderDefault | CGImageByteOrderInfo::Order16Big) => {
                Encoding::Words {
                    little_endian: false,
                }
            }
            (8, CGImageByteOrderInfo::Order32Little) if channels == 4 => {
                Encoding::Bytes { reversed: true }
            }
            (8, CGImageByteOrderInfo::OrderDefault | CGImageByteOrderInfo::Order32Big) => {
                Encoding::Bytes { reversed: false }
            }
            _ => return Err(unsupported()),
        };

        Ok(Self {
            bytes_per_pixel: bits_per_pixel / 8,
            encoding,
            first_colour: usize::from(alpha_first),
            grey: colour_channels == 1,
        })
    }

    /// Whether channels are read at 16 bits (scaled up for 10-bit data).
    fn is_deep(&self) -> bool {
        !matches!(self.encoding, Encoding::Bytes { .. })
    }

    /// Channel `c` (in the declared order, spare bits or alpha counted) of `pixel`.
    fn channel(&self, pixel: &[u8], c: usize) -> u16 {
        match self.encoding {
            Encoding::Bytes { reversed: false } => pixel[c] as u16,
            Encoding::Bytes { reversed: true } => pixel[self.bytes_per_pixel - 1 - c] as u16,
            Encoding::Words { little_endian } => {
                let bytes = [pixel[2 * c], pixel[2 * c + 1]];
                if little_endian {
                    u16::from_le_bytes(bytes)
                } else {
                    u16::from_be_bytes(bytes)
                }
            }
            Encoding::Packed10 { little_endian } => {
                let bytes = [pixel[0], pixel[1], pixel[2], pixel[3]];
                let word = if little_endian {
                    u32::from_le_bytes(bytes)
                } else {
                    u32::from_be_bytes(bytes)
                };
                // Channels from the most significant bits down; the spare 2 bits are
                // channel 0 when they come first, else they follow channel 2.
                let shift = if self.first_colour == 1 {
                    30 - 10 * c as u32
                } else {
                    22 - 10 * c as u32
                };
                let v = ((word >> shift) & 0x3ff) as u16;
                (v << 6) | (v >> 4)
            }
        }
    }

    fn rgb(&self, pixel: &[u8]) -> [u16; 3] {
        if self.grey {
            [self.channel(pixel, self.first_colour); 3]
        } else {
            [0, 1, 2].map(|i| self.channel(pixel, self.first_colour + i))
        }
    }
}

fn rows<T: Send + Copy + Default>(
    data: &[u8],
    (width, height): (usize, usize),
    bytes_per_row: usize,
    layout: &Layout,
    convert: impl Fn([u16; 3]) -> [T; 3] + Sync,
) -> Vec<T> {
    let mut out = vec![T::default(); width * height * 3];
    out.par_chunks_mut(width * 3)
        .enumerate()
        .for_each(|(y, row)| {
            let source = &data[y * bytes_per_row..];
            for (x, pixel_out) in row.chunks_exact_mut(3).enumerate() {
                let start = x * layout.bytes_per_pixel;
                let pixel = &source[start..start + layout.bytes_per_pixel];
                pixel_out.copy_from_slice(&convert(layout.rgb(pixel)));
            }
        });
    out
}

fn read_pixels(image: &CGImage) -> Result<DynamicImage> {
    let layout = Layout::of(image)?;
    let width = CGImage::width(Some(image));
    let height = CGImage::height(Some(image));
    let bytes_per_row = CGImage::bytes_per_row(Some(image));
    let provider = CGImage::data_provider(Some(image))
        .ok_or_else(|| anyhow!("ImageIO returned a HEIF image without pixel data"))?;
    let data = CGDataProvider::data(Some(&provider))
        .ok_or_else(|| anyhow!("ImageIO could not decode this HEIF image"))?;
    // SAFETY: `data` is an immutable copy owned here and outlives `bytes`.
    let bytes = unsafe { data.as_bytes_unchecked() };
    let needed = height.checked_sub(1).map_or(0, |last| {
        last * bytes_per_row + width * layout.bytes_per_pixel
    });
    if bytes.len() < needed || width * layout.bytes_per_pixel > bytes_per_row {
        return Err(anyhow!("ImageIO returned truncated HEIF pixel data"));
    }

    let (w, h) = (width as u32, height as u32);
    let size = (width, height);
    let image = if layout.is_deep() {
        let values = rows(bytes, size, bytes_per_row, &layout, |rgb| rgb);
        ImageBuffer::<Rgb<u16>, _>::from_raw(w, h, values).map(DynamicImage::ImageRgb16)
    } else {
        let values = rows(bytes, size, bytes_per_row, &layout, |rgb| {
            rgb.map(|v| v as u8)
        });
        ImageBuffer::<Rgb<u8>, _>::from_raw(w, h, values).map(DynamicImage::ImageRgb8)
    };
    image.ok_or_else(|| anyhow!("ImageIO returned a HEIF image of the wrong size"))
}

pub fn decode_coded(bytes: &[u8]) -> Result<DynamicImage> {
    let data = CFData::from_bytes(bytes);
    // SAFETY: no options dictionary is passed.
    let source = unsafe { CGImageSource::with_data(&data, None) }
        .ok_or_else(|| anyhow!("ImageIO could not read this HEIF file"))?;
    // SAFETY: `source` is a valid image source; no options dictionary is passed.
    let image = unsafe {
        let index = source.primary_image_index();
        source.image_at_index(index, None)
    }
    .ok_or_else(|| anyhow!("ImageIO could not decode this HEIF file"))?;
    read_pixels(&image)
}

#[cfg(test)]
mod tests {
    use super::super::container::ColourInfo;
    use super::super::{colour, decode};
    use super::*;
    use image::{GenericImageView, Rgb32FImage};
    use objc2_core_foundation::{
        CFDictionary, CFMutableData, CFNumber, CFString, CGPoint, CGRect, CGSize,
    };
    use objc2_core_graphics::{
        CGBitmapContextCreate, CGBitmapContextGetData, CGBitmapInfo, CGColorRenderingIntent,
        CGColorSpace, CGContext, kCGColorSpaceDisplayP3, kCGColorSpaceSRGB,
    };
    use objc2_image_io::{CGImageDestination, kCGImagePropertyOrientation};

    const LEFT: [u8; 3] = [200, 60, 40];
    const RIGHT: [u8; 3] = [40, 120, 220];
    const WIDTH: usize = 64;
    const HEIGHT: usize = 32;

    /// A HEIC made by ImageIO's own encoder: the left half `LEFT`, the right half `RIGHT`,
    /// tagged with `space` and the EXIF-style `orientation`.
    fn encode_heic(space: &CFString, orientation: i32) -> Option<Vec<u8>> {
        let mut rgb = Vec::with_capacity(WIDTH * HEIGHT * 3);
        for _ in 0..HEIGHT {
            for x in 0..WIDTH {
                rgb.extend_from_slice(if x < WIDTH / 2 { &LEFT } else { &RIGHT });
            }
        }
        // SAFETY: plain ImageIO and Core Graphics calls with valid, owned arguments.
        unsafe {
            let colour_space = CGColorSpace::with_name(Some(space))?;
            let pixels = CFData::from_bytes(&rgb);
            let provider = CGDataProvider::with_cf_data(Some(&pixels))?;
            let image = CGImage::new(
                WIDTH,
                HEIGHT,
                8,
                24,
                WIDTH * 3,
                Some(&colour_space),
                CGBitmapInfo(CGImageAlphaInfo::None.0),
                Some(&provider),
                std::ptr::null(),
                false,
                CGColorRenderingIntent::RenderingIntentDefault,
            )?;
            let out = CFMutableData::new(None, 0)?;
            let heic = CFString::from_static_str("public.heic");
            let destination = CGImageDestination::with_data(&out, &heic, 1, None)?;
            let value = CFNumber::new_i32(orientation);
            let properties = CFDictionary::from_slices(&[kCGImagePropertyOrientation], &[&*value]);
            destination.add_image(&image, Some(properties.as_opaque()));
            destination.finalize().then(|| out.to_vec())
        }
    }

    fn pixel(image: &DynamicImage, x: u32, y: u32) -> [f32; 3] {
        image.to_rgb32f().get_pixel(x, y).0
    }

    fn assert_close(actual: [f32; 3], expected: [f32; 3], what: &str) {
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 0.04, "{what}: {actual:?} vs {expected:?}");
        }
    }

    fn unit(rgb: [u8; 3]) -> [f32; 3] {
        rgb.map(|v| v as f32 / 255.0)
    }

    fn sample(space: &CFString, orientation: i32) -> Option<Vec<u8>> {
        let heic = encode_heic(space, orientation);
        if heic.is_none() {
            eprintln!("skipping: ImageIO cannot encode HEIC here");
        }
        heic
    }

    /// ImageIO decodes PNG without HEVC, so the pixel reader can be checked anywhere: every
    /// layout must read back the exact values.
    #[test]
    fn imageio_pixel_layouts_read_back_exactly() {
        let rgb16 = image::ImageBuffer::from_fn(5, 3, |x, y| {
            image::Rgb([x as u16 * 13_000, y as u16 * 30_000, 65_535 - x as u16 * 7])
        });
        let sources = [
            DynamicImage::ImageRgb8(DynamicImage::ImageRgb16(rgb16.clone()).to_rgb8()),
            DynamicImage::ImageRgba8(DynamicImage::ImageRgb16(rgb16.clone()).to_rgba8()),
            DynamicImage::ImageRgb16(rgb16.clone()),
            DynamicImage::ImageLuma8(DynamicImage::ImageRgb16(rgb16).to_luma8()),
        ];
        for source in sources {
            let mut png = Vec::new();
            source
                .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
                .unwrap();
            let read = decode_coded(&png).unwrap();
            let what = format!("{:?}", source.color());
            assert_eq!(read.dimensions(), source.dimensions(), "{what}");
            if read.color().bytes_per_pixel() >= 6 {
                assert_eq!(read.to_rgb16(), source.to_rgb16(), "{what}");
            } else {
                assert_eq!(read.to_rgb8(), source.to_rgb8(), "{what}");
            }
        }
    }

    /// Core Graphics renders the packed 10-bit layout into plain 16-bit RGB; the reader must
    /// agree with it for every spare-bit position and byte order.
    #[test]
    fn packed_ten_bit_layouts_read_as_core_graphics_draws_them() {
        let (width, height) = (7usize, 3usize);
        let values: Vec<[u32; 3]> = (0..width * height)
            .map(|i| {
                let i = i as u32;
                [(i * 37) % 1024, (i * 101 + 5) % 1024, (i * 13 + 900) % 1024]
            })
            .collect();
        let layouts = [
            (
                CGImageAlphaInfo::NoneSkipFirst,
                CGImageByteOrderInfo::Order32Little,
            ),
            (
                CGImageAlphaInfo::NoneSkipLast,
                CGImageByteOrderInfo::Order32Little,
            ),
            (
                CGImageAlphaInfo::NoneSkipFirst,
                CGImageByteOrderInfo::Order32Big,
            ),
            (
                CGImageAlphaInfo::NoneSkipLast,
                CGImageByteOrderInfo::Order32Big,
            ),
        ];
        let mut checked = 0;
        for (alpha, order) in layouts {
            let first = alpha == CGImageAlphaInfo::NoneSkipFirst;
            let bytes: Vec<u8> = values
                .iter()
                .flat_map(|&[r, g, b]| {
                    let word = if first {
                        (r << 20) | (g << 10) | b
                    } else {
                        (r << 22) | (g << 12) | (b << 2)
                    };
                    if order == CGImageByteOrderInfo::Order32Little {
                        word.to_le_bytes()
                    } else {
                        word.to_be_bytes()
                    }
                })
                .collect();
            // SAFETY: Core Graphics calls with valid, owned arguments; the context's buffer
            // is read only while the context lives.
            let (ours, drawn) = unsafe {
                let space = CGColorSpace::with_name(Some(kCGColorSpaceSRGB)).unwrap();
                let pixels = CFData::from_bytes(&bytes);
                let provider = CGDataProvider::with_cf_data(Some(&pixels)).unwrap();
                let Some(image) = CGImage::new(
                    width,
                    height,
                    10,
                    32,
                    width * 4,
                    Some(&space),
                    CGBitmapInfo(alpha.0 | order.0 | CGImagePixelFormatInfo::RGB101010.0),
                    Some(&provider),
                    std::ptr::null(),
                    false,
                    CGColorRenderingIntent::RenderingIntentDefault,
                ) else {
                    continue;
                };
                let context = CGBitmapContextCreate(
                    std::ptr::null_mut(),
                    width,
                    height,
                    16,
                    width * 8,
                    Some(&space),
                    CGImageAlphaInfo::NoneSkipLast.0 | CGImageByteOrderInfo::Order16Little.0,
                )
                .unwrap();
                let rect = CGRect::new(
                    CGPoint::new(0.0, 0.0),
                    CGSize::new(width as f64, height as f64),
                );
                CGContext::draw_image(Some(&context), rect, Some(&image));
                let data = CGBitmapContextGetData(Some(&context)) as *const u16;
                let drawn: Vec<u16> = std::slice::from_raw_parts(data, width * height * 4)
                    .chunks_exact(4)
                    .flat_map(|p| [p[0], p[1], p[2]])
                    .collect();
                (read_pixels(&image).unwrap().to_rgb16().into_raw(), drawn)
            };
            for (a, b) in ours.iter().zip(&drawn) {
                assert!(
                    a.abs_diff(*b) <= 2,
                    "alpha {} order {:#x}: {ours:?} vs {drawn:?}",
                    alpha.0,
                    order.0
                );
            }
            checked += 1;
        }
        assert_eq!(
            checked,
            layouts.len(),
            "Core Graphics refused a packed 10-bit layout"
        );
    }

    #[test]
    fn imageio_heic_round_trips_its_pixels() {
        // SAFETY: a static constant of ImageIO.
        let Some(heic) = sample(unsafe { kCGColorSpaceSRGB }, 1) else {
            return;
        };
        let decoded = decode(&heic).unwrap();
        assert!(!decoded.is_hdr);
        assert_eq!(decoded.image.dimensions(), (WIDTH as u32, HEIGHT as u32));
        assert_close(pixel(&decoded.image, 8, 16), unit(LEFT), "left");
        assert_close(pixel(&decoded.image, 56, 16), unit(RIGHT), "right");
    }

    #[test]
    fn imageio_heic_orientation_is_applied() {
        // Orientation 6 shows the stored image turned a quarter clockwise: its left half on top.
        let Some(heic) = sample(unsafe { kCGColorSpaceSRGB }, 6) else {
            return;
        };
        let decoded = decode(&heic).unwrap();
        assert_eq!(decoded.image.dimensions(), (HEIGHT as u32, WIDTH as u32));
        assert_close(pixel(&decoded.image, 16, 8), unit(LEFT), "top");
        assert_close(pixel(&decoded.image, 16, 56), unit(RIGHT), "bottom");
    }

    #[test]
    fn imageio_display_p3_heic_converts_to_srgb() {
        let Some(heic) = sample(unsafe { kCGColorSpaceDisplayP3 }, 1) else {
            return;
        };
        let decoded = decode(&heic).unwrap();
        let p3 = ColourInfo::Nclx {
            primaries: 12,
            transfer: 13,
        };
        let expected = |rgb| {
            let image = Rgb32FImage::from_pixel(1, 1, image::Rgb(unit(rgb)));
            colour::to_working_space(image, Some(&p3))
                .unwrap()
                .get_pixel(0, 0)
                .0
        };
        assert_close(pixel(&decoded.image, 8, 16), expected(LEFT), "left");
        assert_close(pixel(&decoded.image, 56, 16), expected(RIGHT), "right");
    }
}
