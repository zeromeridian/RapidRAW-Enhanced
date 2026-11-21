use std::convert::AsRef;
use std::path::Path;

pub const RAW_EXTENSIONS: &[(&str, &str)] = &[
    // Adobe
    ("dng", "Adobe Digital Negative"),
    // Apple
    ("pro", "Apple ProRAW"),
    // Arri
    ("ari", "ARRI Raw"),
    // Canon
    ("crw", "Canon Raw"),
    ("cr2", "Canon Raw 2"),
    ("cr3", "Canon Raw 3"),
    // Casio
    ("bay", "Casio"),
    // Contax
    ("raw", "Contax"),
    // DJI
    // ("dng", "DJI (uses DNG)"), // Covered by Adobe

    // Epson
    ("erf", "Epson Raw"),
    // Fuji
    ("raf", "Fuji Raw"),
    // Hasselblad
    ("3fr", "Hasselblad"),
    ("fff", "Hasselblad"),
    // Imacon / Phase One
    ("iiq", "Imacon/Phase One"),
    // Kodak
    ("kdc", "Kodak"),
    ("k25", "Kodak"),
    ("dcs", "Kodak"),
    ("dcr", "Kodak"),
    // Leaf
    ("mos", "Leaf"),
    // Leica
    ("rwl", "Leica Raw"),
    // ("dng", "Leica (uses DNG)"), // Covered by Adobe

    // Mamiya
    ("mef", "Mamiya"),
    // Minolta
    ("mrw", "Minolta Raw"),
    // Nikon
    ("nef", "Nikon Electronic Format"),
    ("nrw", "Nikon Raw"),
    // Olympus
    ("orf", "Olympus Raw"),
    // Panasonic
    ("rw2", "Panasonic Raw 2"),
    ("raw", "Panasonic Raw"),
    // Pentax
    ("pef", "Pentax Electronic File"),
    ("ptx", "Pentax"),
    // Phase One
    // ("iiq", "Phase One (same as Imacon)"), // Covered by Imacon

    // Ricoh
    // ("dng", "Ricoh (uses DNG)"), // Covered by Adobe

    // Samsung
    ("srw", "Samsung Raw"),
    // Sigma
    ("x3f", "Sigma"),
    // Sony
    ("arw", "Sony Alpha Raw"),
    ("srf", "Sony Raw"),
    ("sr2", "Sony Raw 2"),
]; // Tell me if your's is missing.

pub const NON_RAW_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "tiff", "tif", "webp", "jxl", // Standard formats
    "exr", "hdr", // High Dynamic Range / Wide Gamut
    "tga", "ico", "dds", // Graphics & Icons
    "qoi", "ff", // Simple/Specialist formats
    "pnm", "pbm", "pgm", "ppm", "pam", // Netpbm family
];

/// Non-RAW extensions decoded by the operating system's HEIF decoder (`crate::heif`), not
/// the `image` crate; `hif` is the extension of Canon, Sony and Fujifilm cameras.
pub const HEIF_EXTENSIONS: &[&str] = &["heic", "heif", "hif"];

/// Every non-RAW extension ThisIsRAW opens.
pub fn non_raw_extensions() -> impl Iterator<Item = &'static str> {
    NON_RAW_EXTENSIONS.iter().chain(HEIF_EXTENSIONS).copied()
}

pub fn is_heif_file<P: AsRef<Path>>(path: P) -> bool {
    path.as_ref()
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| HEIF_EXTENSIONS.iter().any(|h| h.eq_ignore_ascii_case(ext)))
}

pub fn is_raw_file<P: AsRef<Path>>(path: P) -> bool {
    let ext = match path.as_ref().extension().and_then(|s| s.to_str()) {
        Some(e) => e,
        None => return false,
    };

    RAW_EXTENSIONS
        .iter()
        .any(|(raw_ext, _)| raw_ext.eq_ignore_ascii_case(ext))
}

/// Whether `path` names a hidden file (`.name`), which the Library never lists, as the folder
/// tree skips hidden entries: an AppleDouble file (`._photo.CR3`, which macOS writes beside each
/// file it copies to a volume without native metadata support; metadata only, though it keeps
/// the image's extension), or an external edit's working copy (`editor_round_trip.rs`).
fn is_hidden_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

pub fn is_supported_image_file<P: AsRef<Path>>(path: P) -> bool {
    let path = path.as_ref();

    if is_hidden_file(path) {
        return false;
    }

    let ext = match path.extension().and_then(|s| s.to_str()) {
        Some(e) => e,
        None => return false,
    };

    if RAW_EXTENSIONS
        .iter()
        .any(|(raw_ext, _)| raw_ext.eq_ignore_ascii_case(ext))
    {
        return true;
    }

    non_raw_extensions().any(|non_raw_ext| non_raw_ext.eq_ignore_ascii_case(ext))
}

#[cfg(test)]
mod tests {
    use super::{is_heif_file, is_supported_image_file};

    #[test]
    fn heif_files_are_supported_in_any_case() {
        for name in ["/photos/IMG_0001.HEIC", "a.heif", "R5_0001.HIF"] {
            assert!(is_heif_file(name), "{name}");
            assert!(is_supported_image_file(name), "{name}");
        }
        assert!(!is_heif_file("a.jpg"));
        assert!(!is_heif_file("heic"));
    }

    #[test]
    fn hidden_files_are_not_images() {
        assert!(!is_supported_image_file("._260102-0143-R7-RAW.CR3"));
        assert!(!is_supported_image_file(
            "/Volumes/Card/DCIM/._IMG_0001.JPG"
        ));
        assert!(!is_supported_image_file("/photos/.IMG_0001-Edit.tif"));
        assert!(is_supported_image_file("/Volumes/Card/DCIM/IMG_0001.JPG"));
        assert!(is_supported_image_file("260102-0143-R7-RAW.CR3"));
        assert!(is_supported_image_file("/photos/IMG_0001-Edit.tif"));
    }
}
