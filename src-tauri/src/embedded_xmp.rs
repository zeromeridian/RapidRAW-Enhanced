//! Reads the XMP packet that Lightroom Classic and other applications embed in JPEG, TIFF, DNG,
//! and PNG files instead of writing a sidecar.
//!
//! Only the file headers are read: JPEG segments up to the image data, TIFF IFD0, and PNG chunk
//! headers. ThisIsRAW never writes embedded XMP; its own XMP stays in sidecars.

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

const EMBEDDED_XMP_EXTENSIONS: &[&str] = &["jpg", "jpeg", "tif", "tiff", "dng", "png"];
const JPEG_XMP_SIGNATURE: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const PNG_XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";
const TIFF_XMP_TAG: u16 = 700;
/// Real packets are far smaller; this only bounds what a corrupt header can make us allocate.
const MAX_XMP_BYTES: u32 = 16 * 1024 * 1024;

/// Whether `path` is a format that can carry embedded XMP.
pub fn can_embed_xmp(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            EMBEDDED_XMP_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
}

/// The XMP packet embedded in `path`, if it has one.
pub fn read_embedded_xmp(path: &Path) -> Option<String> {
    if !can_embed_xmp(path) {
        return None;
    }
    let mut reader = BufReader::new(File::open(path).ok()?);
    let mut signature = [0u8; 8];
    reader.read_exact(&mut signature).ok()?;
    reader.rewind().ok()?;

    let packet = match signature {
        [0xFF, 0xD8, ..] => read_jpeg_xmp(&mut reader),
        [b'I', b'I', 42, 0, ..] | [b'M', b'M', 0, 42, ..] => read_tiff_xmp(&mut reader),
        _ if signature == PNG_SIGNATURE => read_png_xmp(&mut reader),
        _ => None,
    }?;
    String::from_utf8(packet)
        .ok()
        .filter(|xmp| xmp.contains("<x:xmpmeta") || xmp.contains("<rdf:RDF"))
}

fn read_bytes(reader: &mut impl Read, length: u32) -> Option<Vec<u8>> {
    if length > MAX_XMP_BYTES {
        return None;
    }
    let mut bytes = vec![0u8; length as usize];
    reader.read_exact(&mut bytes).ok()?;
    Some(bytes)
}

fn read_jpeg_xmp(reader: &mut (impl Read + Seek)) -> Option<Vec<u8>> {
    reader.seek(SeekFrom::Start(2)).ok()?;
    loop {
        let mut marker = [0u8; 2];
        reader.read_exact(&mut marker).ok()?;
        if marker[0] != 0xFF {
            return None;
        }
        match marker[1] {
            // Fill bytes and markers without a length.
            0xFF => {
                reader.seek(SeekFrom::Current(-1)).ok()?;
                continue;
            }
            0x01 | 0xD0..=0xD7 => continue,
            // Start of scan or end of image: metadata segments come before both.
            0xDA | 0xD9 => return None,
            _ => {}
        }
        let mut length = [0u8; 2];
        reader.read_exact(&mut length).ok()?;
        let payload_length = u16::from_be_bytes(length).checked_sub(2)?;
        if marker[1] == 0xE1 && usize::from(payload_length) > JPEG_XMP_SIGNATURE.len() {
            let payload = read_bytes(reader, u32::from(payload_length))?;
            if let Some(packet) = payload.strip_prefix(JPEG_XMP_SIGNATURE) {
                return Some(packet.to_vec());
            }
        } else {
            reader
                .seek(SeekFrom::Current(i64::from(payload_length)))
                .ok()?;
        }
    }
}

fn read_tiff_xmp(reader: &mut (impl Read + Seek)) -> Option<Vec<u8>> {
    let mut header = [0u8; 8];
    reader.read_exact(&mut header).ok()?;
    let big_endian = header[0] == b'M';
    let u16_at = |bytes: &[u8]| {
        let bytes = [bytes[0], bytes[1]];
        if big_endian {
            u16::from_be_bytes(bytes)
        } else {
            u16::from_le_bytes(bytes)
        }
    };
    let u32_at = |bytes: &[u8]| {
        let bytes = [bytes[0], bytes[1], bytes[2], bytes[3]];
        if big_endian {
            u32::from_be_bytes(bytes)
        } else {
            u32::from_le_bytes(bytes)
        }
    };

    reader
        .seek(SeekFrom::Start(u64::from(u32_at(&header[4..8]))))
        .ok()?;
    let mut count = [0u8; 2];
    reader.read_exact(&mut count).ok()?;
    for _ in 0..u16_at(&count) {
        let mut entry = [0u8; 12];
        reader.read_exact(&mut entry).ok()?;
        if u16_at(&entry[0..2]) != TIFF_XMP_TAG {
            continue;
        }
        // XMP is stored as BYTE (1) or UNDEFINED (7), so the count is its length in bytes.
        let length = u32_at(&entry[4..8]);
        if length <= 4 {
            return Some(entry[8..8 + length as usize].to_vec());
        }
        reader
            .seek(SeekFrom::Start(u64::from(u32_at(&entry[8..12]))))
            .ok()?;
        return read_bytes(reader, length);
    }
    None
}

fn read_png_xmp(reader: &mut (impl Read + Seek)) -> Option<Vec<u8>> {
    reader
        .seek(SeekFrom::Start(PNG_SIGNATURE.len() as u64))
        .ok()?;
    loop {
        let mut header = [0u8; 8];
        reader.read_exact(&mut header).ok()?;
        let length = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
        match &header[4..8] {
            b"IEND" => return None,
            b"iTXt" => {
                let chunk = read_bytes(reader, length)?;
                reader.seek(SeekFrom::Current(4)).ok()?;
                if let Some(packet) = png_itxt_xmp(&chunk) {
                    return Some(packet);
                }
            }
            _ => {
                reader.seek(SeekFrom::Current(i64::from(length) + 4)).ok()?;
            }
        }
    }
}

/// The text of an uncompressed `XML:com.adobe.xmp` iTXt chunk.
fn png_itxt_xmp(chunk: &[u8]) -> Option<Vec<u8>> {
    let rest = chunk.strip_prefix(PNG_XMP_KEYWORD)?.strip_prefix(&[0])?;
    let (&compressed, rest) = rest.split_first()?;
    if compressed != 0 {
        return None;
    }
    // Compression method, then the null-terminated language tag and translated keyword.
    let mut fields = rest.get(1..)?.splitn(3, |&byte| byte == 0);
    fields.next()?;
    fields.next()?;
    fields.next().map(<[u8]>::to_vec)
}

#[cfg(test)]
mod tests {
    use super::read_embedded_xmp;
    use std::fs;

    const PACKET: &str = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>"#;

    fn read(name: &str, bytes: &[u8]) -> Option<String> {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join(name);
        fs::write(&path, bytes).unwrap();
        read_embedded_xmp(&path)
    }

    #[test]
    fn reads_jpeg_app1_after_exif() {
        let mut jpeg = vec![0xFF, 0xD8];
        let exif = b"Exif\0\0padding";
        jpeg.extend([0xFF, 0xE1]);
        jpeg.extend(((exif.len() + 2) as u16).to_be_bytes());
        jpeg.extend(exif);
        let payload = [
            b"http://ns.adobe.com/xap/1.0/\0".as_slice(),
            PACKET.as_bytes(),
        ]
        .concat();
        jpeg.extend([0xFF, 0xE1]);
        jpeg.extend(((payload.len() + 2) as u16).to_be_bytes());
        jpeg.extend(&payload);
        jpeg.extend([0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9]);

        assert_eq!(read("a.JPG", &jpeg).as_deref(), Some(PACKET));
    }

    #[test]
    fn stops_at_jpeg_image_data() {
        let jpeg = [0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9];
        assert_eq!(read("a.jpg", &jpeg), None);
    }

    fn tiff(big_endian: bool) -> Vec<u8> {
        let u16b = |v: u16| {
            if big_endian {
                v.to_be_bytes()
            } else {
                v.to_le_bytes()
            }
        };
        let u32b = |v: u32| {
            if big_endian {
                v.to_be_bytes()
            } else {
                v.to_le_bytes()
            }
        };
        let mut tiff = if big_endian {
            b"MM".to_vec()
        } else {
            b"II".to_vec()
        };
        tiff.extend(u16b(42));
        tiff.extend(u32b(8));
        tiff.extend(u16b(2));
        // ImageWidth, then XMP pointing past the IFD.
        tiff.extend(u16b(256));
        tiff.extend(u16b(4));
        tiff.extend(u32b(1));
        tiff.extend(u32b(640));
        tiff.extend(u16b(700));
        tiff.extend(u16b(7));
        tiff.extend(u32b(PACKET.len() as u32));
        tiff.extend(u32b(8 + 2 + 2 * 12 + 4));
        tiff.extend(u32b(0));
        tiff.extend(PACKET.as_bytes());
        tiff
    }

    #[test]
    fn reads_tiff_and_dng_ifd0_in_both_byte_orders() {
        assert_eq!(read("a.tif", &tiff(false)).as_deref(), Some(PACKET));
        assert_eq!(read("a.dng", &tiff(true)).as_deref(), Some(PACKET));
    }

    #[test]
    fn reads_png_itxt() {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut chunk = |kind: &[u8], data: &[u8]| {
            png.extend((data.len() as u32).to_be_bytes());
            png.extend(kind);
            png.extend(data);
            png.extend([0u8; 4]);
        };
        chunk(b"IHDR", &[0u8; 13]);
        chunk(
            b"iTXt",
            &[b"XML:com.adobe.xmp\0\0\0\0\0".as_slice(), PACKET.as_bytes()].concat(),
        );
        chunk(b"IEND", &[]);

        assert_eq!(read("a.png", &png).as_deref(), Some(PACKET));
    }

    #[test]
    fn ignores_raw_formats_and_missing_files() {
        assert_eq!(read("a.cr3", &tiff(false)), None);
        assert_eq!(
            read_embedded_xmp(std::path::Path::new("/nonexistent/a.jpg")),
            None
        );
    }
}
