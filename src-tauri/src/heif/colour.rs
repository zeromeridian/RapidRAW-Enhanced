//! Converts a decoded HEIF image from its own colour space into the working space of non-RAW
//! images (sRGB-encoded values in 0–1), the same way on every platform (owner decision
//! 2026-11-18, Plan item 48).

use super::container::ColourInfo;
use anyhow::{Result, anyhow};
use image::Rgb32FImage;
use moxcms::{
    CicpColorPrimaries, CicpProfile, ColorProfile, DataColorSpace, Layout, MatrixCoefficients,
    TransferCharacteristics, TransformOptions,
};
use rayon::prelude::*;

/// ITU-T H.273 transfer characteristics of HDR curves: PQ (SMPTE ST 2084) and HLG.
const HDR_TRANSFERS: [u8; 2] = [16, 18];

/// Whether the colour information describes an HDR (PQ or HLG) image.
pub fn is_hdr(colour: Option<&ColourInfo>) -> bool {
    match colour {
        Some(ColourInfo::Nclx { transfer, .. }) => HDR_TRANSFERS.contains(transfer),
        Some(ColourInfo::Icc(icc)) => ColorProfile::new_from_slice(icc)
            .ok()
            .and_then(|profile| profile.cicp)
            .is_some_and(|cicp| HDR_TRANSFERS.contains(&(cicp.transfer_characteristics as u8))),
        None => false,
    }
}

/// The profile the stored values are in, or `None` when they already are sRGB.
///
/// Code points convert only their primaries: the stored values keep the sRGB curve, so an
/// SDR file looks as viewers show it and an HDR curve is left as it is (owner decision
/// 2026-11-18; HDR decoding deferred).
fn source_profile(colour: Option<&ColourInfo>) -> Option<ColorProfile> {
    match colour? {
        ColourInfo::Icc(icc) => match ColorProfile::new_from_slice(icc) {
            Ok(profile) if profile.color_space == DataColorSpace::Rgb => Some(profile),
            Ok(_) => None,
            Err(e) => {
                log::warn!("Ignoring the unreadable ICC profile of a HEIF image: {e}");
                None
            }
        },
        ColourInfo::Nclx { primaries, .. } => {
            let primaries = CicpColorPrimaries::try_from(*primaries).ok()?;
            if matches!(
                primaries,
                CicpColorPrimaries::Bt709
                    | CicpColorPrimaries::Unspecified
                    | CicpColorPrimaries::Reserved
            ) {
                return None;
            }
            Some(ColorProfile::new_from_cicp(CicpProfile {
                color_primaries: primaries,
                transfer_characteristics: TransferCharacteristics::Srgb,
                matrix_coefficients: MatrixCoefficients::Bt709,
                full_range: true,
            }))
        }
    }
}

/// Converts `image` into the working space. Colours outside sRGB are clipped to it, as for
/// every other non-RAW image.
pub fn to_working_space(image: Rgb32FImage, colour: Option<&ColourInfo>) -> Result<Rgb32FImage> {
    let Some(source) = source_profile(colour) else {
        return Ok(image);
    };
    let options = TransformOptions {
        prefer_fixed_point: false,
        ..TransformOptions::default()
    };
    let transform = source
        .create_transform_f32(Layout::Rgb, &ColorProfile::new_srgb(), Layout::Rgb, options)
        .map_err(|e| anyhow!("Failed to convert the HEIF colour profile: {e}"))?;

    let (width, height) = image.dimensions();
    let row = width as usize * 3;
    let source_values = image.into_raw();
    let mut converted = vec![0.0f32; source_values.len()];
    converted
        .par_chunks_mut(row)
        .zip(source_values.par_chunks(row))
        .try_for_each(|(out, input)| {
            transform.transform(input, out)?;
            out.iter_mut().for_each(|v| *v = v.clamp(0.0, 1.0));
            Ok::<_, moxcms::CmsError>(())
        })
        .map_err(|e| anyhow!("Failed to convert the HEIF colour profile: {e}"))?;

    Rgb32FImage::from_raw(width, height, converted)
        .ok_or_else(|| anyhow!("Converted HEIF image has the wrong size"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    fn srgb_decode(v: f32) -> f32 {
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    }

    fn srgb_encode(v: f32) -> f32 {
        if v <= 0.0031308 {
            v * 12.92
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        }
    }

    /// Display P3 to sRGB by the published linear matrix (both D65).
    fn p3_to_srgb(rgb: [f32; 3]) -> [f32; 3] {
        let m = [
            [1.224_940_2, -0.224_940_4, 0.0],
            [-0.042_056_955, 1.042_057, 0.0],
            [-0.019_637_555, -0.078_636_05, 1.098_273_6],
        ];
        let lin = rgb.map(srgb_decode);
        let mut out = [0.0; 3];
        for (i, row) in m.iter().enumerate() {
            let v = row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2];
            out[i] = srgb_encode(v.clamp(0.0, 1.0));
        }
        out
    }

    fn single(rgb: [f32; 3]) -> Rgb32FImage {
        Rgb32FImage::from_pixel(2, 2, Rgb(rgb))
    }

    fn assert_close(actual: [f32; 3], expected: [f32; 3]) {
        for (a, e) in actual.iter().zip(expected) {
            assert!((a - e).abs() < 3e-3, "{actual:?} vs {expected:?}");
        }
    }

    #[test]
    fn display_p3_profiles_and_code_points_convert_alike() {
        let colour = [0.6, 0.4, 0.3];
        let expected = p3_to_srgb(colour);
        let icc = ColorProfile::new_display_p3().encode().unwrap();

        for info in [
            ColourInfo::Icc(icc),
            ColourInfo::Nclx {
                primaries: 12,
                transfer: 13,
            },
        ] {
            let out = to_working_space(single(colour), Some(&info)).unwrap();
            assert_close(out.get_pixel(1, 1).0, expected);
        }
    }

    #[test]
    fn srgb_and_unknown_colour_stay_unchanged() {
        let colour = [0.6, 0.4, 0.3];
        for info in [
            None,
            Some(ColourInfo::Nclx {
                primaries: 1,
                transfer: 1,
            }),
            Some(ColourInfo::Nclx {
                primaries: 2,
                transfer: 2,
            }),
            Some(ColourInfo::Icc(b"not a profile".to_vec())),
        ] {
            let out = to_working_space(single(colour), info.as_ref()).unwrap();
            assert_eq!(out.get_pixel(0, 0).0, colour);
        }
    }

    #[test]
    fn out_of_gamut_colours_clip_to_srgb() {
        let info = ColourInfo::Nclx {
            primaries: 9,
            transfer: 16,
        };
        let out = to_working_space(single([0.0, 1.0, 0.0]), Some(&info)).unwrap();
        assert!(
            out.pixels()
                .flat_map(|p| p.0)
                .all(|v| (0.0..=1.0).contains(&v))
        );
    }

    #[test]
    fn only_pq_and_hlg_count_as_hdr() {
        let nclx = |transfer| ColourInfo::Nclx {
            primaries: 9,
            transfer,
        };
        assert!(is_hdr(Some(&nclx(16))));
        assert!(is_hdr(Some(&nclx(18))));
        assert!(!is_hdr(Some(&nclx(13))));
        assert!(!is_hdr(Some(&nclx(1))));
        assert!(!is_hdr(None));
    }
}
