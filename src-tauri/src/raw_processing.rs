use anyhow::Result;
use image::DynamicImage;
use rawler::{
    decoders::{Orientation, RawDecodeParams},
    imgop::develop::{DemosaicAlgorithm, RawDevelop},
    rawsource::RawSource,
};

pub fn develop_raw_image(file_bytes: &[u8], fast_demosaic: bool) -> Result<DynamicImage> {
    let (developed_image, orientation) = develop_internal(file_bytes, fast_demosaic)?;
    Ok(apply_orientation(developed_image, orientation))
}

fn develop_internal(file_bytes: &[u8], fast_demosaic: bool) -> Result<(DynamicImage, Orientation)> {
    let source = RawSource::new_from_slice(file_bytes);
    let decoder = rawler::get_decoder(&source)?;
    let raw_image = decoder.raw_image(&source, &RawDecodeParams::default(), false)?;

    let metadata = decoder.raw_metadata(&source, &RawDecodeParams::default())?;
    let orientation = metadata
        .exif
        .orientation
        .map(Orientation::from_u16)
        .unwrap_or(Orientation::Normal);

    let mut developer = RawDevelop::default();
    if fast_demosaic {
        developer.demosaic_algorithm = DemosaicAlgorithm::Speed;
    }
    let developed_image = developer.develop_intermediate(&raw_image)?;

    let dynamic_image = developed_image
        .to_dynamic_image()
        .ok_or_else(|| anyhow::anyhow!("Failed to convert developed image to DynamicImage"))?;

    Ok((dynamic_image, orientation))
}

fn apply_orientation(image: DynamicImage, orientation: Orientation) -> DynamicImage {
    match orientation {
        Orientation::Normal | Orientation::Unknown => image,
        Orientation::HorizontalFlip => image.fliph(),
        Orientation::Rotate180 => image.rotate180(),
        Orientation::VerticalFlip => image.flipv(),
        Orientation::Transpose => image.rotate90().flipv(),
        Orientation::Rotate90 => image.rotate90(),
        Orientation::Transverse => image.rotate90().fliph(),
        Orientation::Rotate270 => image.rotate270(),
    }
}

// Yes, I researched and implemented large and complex demosaicing algorithms to later find out that the new rawler library already provides them internally. Ha ha ha.