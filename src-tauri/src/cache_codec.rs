//! Lossless compression for cached half-float RGB images (AI Denoise, later
//! RapidRes).
//!
//! Adapted from upstream RapidRAW `1e36f46f` without its mantissa rounding:
//! every f16 value is kept bit for bit, so a render from a cached entry is
//! identical to one from an uncompressed entry. The image is split into bands
//! of `BAND_ROWS` rows. In each row, every channel stores the wrapping
//! difference to the same channel of the previous pixel; the low and high
//! bytes go into separate planes and each band is compressed with zstd. The
//! payload starts with a table of the compressed band sizes, so bands decode
//! in parallel.

use half::f16;
use rayon::prelude::*;
use std::io;

const CHANNELS: usize = 3;
const BAND_ROWS: usize = 16;
const ZSTD_LEVEL: i32 = 3;

fn row_len(width: usize) -> usize {
    width * CHANNELS
}

fn band_len(width: usize) -> usize {
    BAND_ROWS * row_len(width)
}

fn is_valid_shape(len: usize, width: usize) -> bool {
    len == 0 || (width > 0 && len.is_multiple_of(row_len(width)))
}

fn encode_band(band: &[f16], width: usize) -> io::Result<Vec<u8>> {
    let mut planes = vec![0u8; band.len() * 2];
    let (lo, hi) = planes.split_at_mut(band.len());
    for ((row, lo), hi) in band
        .chunks_exact(row_len(width))
        .zip(lo.chunks_exact_mut(row_len(width)))
        .zip(hi.chunks_exact_mut(row_len(width)))
    {
        let mut prev = [0u16; CHANNELS];
        for ((px, lo), hi) in row
            .as_chunks::<CHANNELS>()
            .0
            .iter()
            .zip(lo.as_chunks_mut::<CHANNELS>().0)
            .zip(hi.as_chunks_mut::<CHANNELS>().0)
        {
            for c in 0..CHANNELS {
                let bits = px[c].to_bits();
                [lo[c], hi[c]] = bits.wrapping_sub(prev[c]).to_le_bytes();
                prev[c] = bits;
            }
        }
    }
    zstd::bulk::compress(&planes, ZSTD_LEVEL)
}

fn decode_band(
    decompressor: &mut zstd::bulk::Decompressor,
    planes: &mut Vec<u8>,
    compressed: &[u8],
    band: &mut [f16],
    width: usize,
) -> Option<()> {
    planes.clear();
    planes.reserve(band.len() * 2);
    decompressor.decompress_to_buffer(compressed, planes).ok()?;
    if planes.len() != band.len() * 2 {
        return None;
    }
    let (lo, hi) = planes.split_at(band.len());
    for ((row, lo), hi) in band
        .chunks_exact_mut(row_len(width))
        .zip(lo.chunks_exact(row_len(width)))
        .zip(hi.chunks_exact(row_len(width)))
    {
        let mut prev = [0u16; CHANNELS];
        for ((px, lo), hi) in row
            .as_chunks_mut::<CHANNELS>()
            .0
            .iter_mut()
            .zip(lo.as_chunks::<CHANNELS>().0)
            .zip(hi.as_chunks::<CHANNELS>().0)
        {
            for c in 0..CHANNELS {
                prev[c] = prev[c].wrapping_add(u16::from_le_bytes([lo[c], hi[c]]));
                px[c] = f16::from_bits(prev[c]);
            }
        }
    }
    Some(())
}

/// Compresses interleaved RGB half floats, `width` pixels per row.
pub fn encode_rgb_f16(data: &[f16], width: usize) -> io::Result<Vec<u8>> {
    if !is_valid_shape(data.len(), width) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "RGB data does not fill whole rows",
        ));
    }
    let bands = data
        .par_chunks(band_len(width).max(1))
        .map(|band| encode_band(band, width))
        .collect::<io::Result<Vec<_>>>()?;

    let total: usize = bands.iter().map(|band| 4 + band.len()).sum();
    let mut payload = Vec::with_capacity(total);
    for band in &bands {
        let size = u32::try_from(band.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "band too large"))?;
        payload.extend_from_slice(&size.to_le_bytes());
    }
    for band in &bands {
        payload.extend_from_slice(band);
    }
    Ok(payload)
}

/// Restores `len` interleaved RGB half floats from `encode_rgb_f16`'s
/// payload. Returns `None` for a payload that is damaged or does not match
/// the given shape.
pub fn decode_rgb_f16(payload: &[u8], width: usize, len: usize) -> Option<Vec<f16>> {
    if !is_valid_shape(len, width) {
        return None;
    }
    let band_len = band_len(width).max(1);
    let table_len = len.div_ceil(band_len) * 4;
    let mut offset = table_len;
    let mut spans = Vec::with_capacity(len.div_ceil(band_len));
    for size in payload.get(..table_len)?.as_chunks::<4>().0 {
        let size = u32::from_le_bytes(*size) as usize;
        let end = offset.checked_add(size)?;
        spans.push(payload.get(offset..end)?);
        offset = end;
    }
    if offset != payload.len() {
        return None;
    }

    let mut data = vec![f16::ZERO; len];
    data.par_chunks_mut(band_len)
        .zip(spans.par_iter())
        .map_init(
            || (zstd::bulk::Decompressor::new().ok(), Vec::new()),
            |(decompressor, planes), (band, span)| {
                decompressor
                    .as_mut()
                    .and_then(|d| decode_band(d, planes, span, band, width))
                    .is_some()
            },
        )
        .all(|ok| ok)
        .then_some(data)
}

#[cfg(test)]
mod tests {
    use super::{BAND_ROWS, decode_rgb_f16, encode_rgb_f16};
    use half::f16;

    fn sample(width: usize, height: usize) -> Vec<f16> {
        let mut data: Vec<f16> = (0..width * height * 3)
            .map(|i| {
                let x = (i / 3 % width) as f32 / width as f32;
                let y = (i / 3 / width) as f32 / height as f32;
                let noise = ((i as u32).wrapping_mul(2_654_435_761) >> 20) as f32 / 4096.0;
                f16::from_f32((x * 2.0 - y) * 1.7 + noise * 0.01)
            })
            .collect();
        data[0] = f16::NAN;
        data[1] = f16::INFINITY;
        data[2] = f16::NEG_INFINITY;
        data[3] = f16::MIN_POSITIVE_SUBNORMAL;
        data[4] = f16::NEG_ZERO;
        data[5] = f16::MAX;
        data
    }

    #[test]
    fn every_half_float_survives_compression_bit_for_bit() {
        let (width, height) = (37, BAND_ROWS * 2 + 5);
        let data = sample(width, height);
        let payload = encode_rgb_f16(&data, width).expect("encodes");
        let decoded = decode_rgb_f16(&payload, width, data.len()).expect("decodes");
        assert!(
            data.iter()
                .zip(&decoded)
                .all(|(a, b)| a.to_bits() == b.to_bits())
        );
        assert!(payload.len() < data.len() * 2);
    }

    #[test]
    fn damaged_or_mismatched_payloads_are_rejected() {
        let (width, height) = (20, BAND_ROWS + 3);
        let data = sample(width, height);
        let payload = encode_rgb_f16(&data, width).expect("encodes");

        assert!(decode_rgb_f16(&payload[..payload.len() - 1], width, data.len()).is_none());
        let mut longer = payload.clone();
        longer.push(0);
        assert!(decode_rgb_f16(&longer, width, data.len()).is_none());
        let mut flipped = payload.clone();
        let last = flipped.len() - 2;
        flipped[last] ^= 0xFF;
        assert!(decode_rgb_f16(&flipped, width, data.len()).is_none_or(|d| d != data));
        assert!(decode_rgb_f16(&payload, width + 1, data.len()).is_none());
        assert!(decode_rgb_f16(&payload, width, data.len() + 3).is_none());
        assert!(decode_rgb_f16(&[], 0, 0).is_some_and(|d| d.is_empty()));
    }

    #[test]
    fn data_that_does_not_fill_whole_rows_is_not_encoded() {
        assert!(encode_rgb_f16(&[f16::ZERO; 4], 1).is_err());
        assert!(encode_rgb_f16(&[f16::ZERO; 3], 0).is_err());
        assert!(encode_rgb_f16(&[], 0).is_ok_and(|p| p.is_empty()));
    }
}
