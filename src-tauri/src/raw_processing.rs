use anyhow::Result;
use image::DynamicImage;
use rawler::{
    decoders::{Orientation, RawDecodeParams},
    imgop::develop::{DemosaicAlgorithm, Intermediate, ProcessingStep, RawDevelop},
    rawimage::RawImage,
    rawsource::RawSource,
};
use crate::image_processing::apply_orientation;

pub fn develop_raw_image(file_bytes: &[u8], fast_demosaic: bool) -> Result<DynamicImage> {
    let (developed_image, orientation) = develop_internal(file_bytes, fast_demosaic)?;
    Ok(apply_orientation(developed_image, orientation))
}

fn process_and_rescale_pixel_channel(value_from_rawler: f32, rescale_factor: f32) -> f32 {
    let linear_val = (value_from_rawler * rescale_factor).max(0.0);

    let x = linear_val;
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    let tonemapped = (x * (a * x + b)) / (x * (c * x + d) + e);
    let tonemapped = tonemapped.max(0.0);

    if tonemapped <= 0.0031308 {
        tonemapped * 12.92
    } else {
        1.055 * tonemapped.powf(1.0 / 2.4) - 0.055
    }
}

fn develop_internal(file_bytes: &[u8], fast_demosaic: bool) -> Result<(DynamicImage, Orientation)> {
    let source = RawSource::new_from_slice(file_bytes);
    let decoder = rawler::get_decoder(&source)?;
    let mut raw_image: RawImage = decoder.raw_image(&source, &RawDecodeParams::default(), false)?;

    let metadata = decoder.raw_metadata(&source, &RawDecodeParams::default())?;
    let orientation = metadata
        .exif
        .orientation
        .map(Orientation::from_u16)
        .unwrap_or(Orientation::Normal);

    let original_white_level = raw_image.whitelevel.0.get(0).cloned().unwrap_or(u16::MAX as u32) as f32;
    let original_black_level = raw_image.blacklevel.levels.get(0).map(|r| r.as_f32()).unwrap_or(0.0);

    let headroom_white_level = u32::MAX as f32;
    for level in raw_image.whitelevel.0.iter_mut() {
        *level = u32::MAX;
    }

    let mut developer = RawDevelop::default();
    if fast_demosaic {
        developer.demosaic_algorithm = DemosaicAlgorithm::Speed;
    }
    developer.steps.retain(|&step| step != ProcessingStep::SRgb);

    let mut dark_intermediate = developer.develop_intermediate(&raw_image)?;

    let denominator = (original_white_level - original_black_level).max(1.0);
    let rescale_factor = (headroom_white_level - original_black_level) / denominator;

    match &mut dark_intermediate {
        Intermediate::Monochrome(pixels) => {
            pixels.data.iter_mut().for_each(|p| *p = process_and_rescale_pixel_channel(*p, rescale_factor));
        }
        Intermediate::ThreeColor(pixels) => {
            pixels.data.iter_mut().for_each(|p| {
                p.iter_mut().for_each(|c| *c = process_and_rescale_pixel_channel(*c, rescale_factor));
            });
        }
        Intermediate::FourColor(pixels) => {
            pixels.data.iter_mut().for_each(|p| {
                p.iter_mut().for_each(|c| *c = process_and_rescale_pixel_channel(*c, rescale_factor));
            });
        }
    }

    let dynamic_image = dark_intermediate
        .to_dynamic_image()
        .ok_or_else(|| anyhow::anyhow!("Failed to convert developed image to DynamicImage"))?;

    Ok((dynamic_image, orientation))
}