//! File-name templates shared by rename, export and import.
//!
//! A template is text with fields in braces: `{token:format|filter?fallback}`.
//! Only the token is required. `{{` and `}}` stand for literal braces. The
//! original tokens (`{original_filename}`, `{sequence}`, `{YYYY}`, …) keep
//! their meaning, and a field the parser does not understand stays in the
//! name as written, as it always did, so saved templates never stop working;
//! the parser reports it as an error for the rename dialog to show.
//!
//! Dates are the capture time exactly as the camera recorded it (a naive
//! local time, see `exif_processing::get_creation_date_from_path`), never
//! converted between time zones.

use std::cell::OnceCell;
use std::collections::HashMap;
use std::path::PathBuf;

use chrono::{Local, NaiveDateTime};
use serde::Serialize;

use crate::exif_processing;
use crate::file_management::parse_virtual_path;
use crate::image_processing::ImageMetadata;
use crate::tagging::COLOR_TAG_PREFIX;

/// Longest file stem a template produces, in bytes. File systems allow 255
/// bytes per name; the rest is left for the extension, export suffixes,
/// `_VC01` and clash numbers.
pub const MAX_STEM_BYTES: usize = 200;

const DEFAULT_DATE_FORMAT: &str = "YYYYMMDD";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Token {
    OriginalFilename,
    OriginalFilenameNumber,
    Sequence,
    Year,
    Month,
    Day,
    Hour,
    Minute,
    Second,
    Capture,
    FileDate,
    Today,
    Camera,
    Lens,
    Iso,
    Focal,
    Aperture,
    Shutter,
    Rating,
    Label,
    Text,
}

impl Token {
    fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "original_filename" => Self::OriginalFilename,
            "original_filename_number" => Self::OriginalFilenameNumber,
            "sequence" | "seq" => Self::Sequence,
            "YYYY" => Self::Year,
            "MM" => Self::Month,
            "DD" => Self::Day,
            "hh" => Self::Hour,
            "mm" => Self::Minute,
            "ss" => Self::Second,
            "date" | "capture" => Self::Capture,
            "filedate" => Self::FileDate,
            "today" => Self::Today,
            "camera" => Self::Camera,
            "lens" => Self::Lens,
            "iso" => Self::Iso,
            "focal" => Self::Focal,
            "aperture" => Self::Aperture,
            "shutter" => Self::Shutter,
            "rating" => Self::Rating,
            "label" => Self::Label,
            "text" => Self::Text,
            _ => return None,
        })
    }

    fn takes_date_format(self) -> bool {
        matches!(self, Self::Capture | Self::FileDate | Self::Today)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SequenceFormat {
    /// Digits, zero-padded; `None` pads to the batch's last number.
    width: Option<usize>,
    start: usize,
}

impl Default for SequenceFormat {
    fn default() -> Self {
        Self {
            width: None,
            start: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum FieldFormat {
    None,
    Sequence(SequenceFormat),
    Date(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Filter {
    Upper,
    Lower,
    Slug,
    Trim(usize),
}

impl Filter {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "upper" => Some(Self::Upper),
            "lower" => Some(Self::Lower),
            "slug" => Some(Self::Slug),
            _ => {
                let count = text.strip_prefix("trim:")?.parse().ok()?;
                (count > 0).then_some(Self::Trim(count))
            }
        }
    }

    fn apply(self, value: String) -> String {
        match self {
            Self::Upper => value.to_uppercase(),
            Self::Lower => value.to_lowercase(),
            Self::Slug => slug(&value),
            Self::Trim(count) => value.chars().take(count).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Field {
    token: Token,
    name: String,
    format: FieldFormat,
    filters: Vec<Filter>,
    fallback: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Part {
    Text(String),
    Field(Field),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TemplateErrorKind {
    UnclosedBrace,
    UnmatchedClosingBrace,
    EmptyToken,
    UnknownToken,
    UnknownFilter,
    FormatNotAllowed,
    InvalidSequenceFormat,
}

/// A problem in a template. `position` counts characters from the start of
/// the template; `text` is the part that caused it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateError {
    pub kind: TemplateErrorKind,
    pub position: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Template {
    parts: Vec<Part>,
}

/// A parsed template and every problem found in it. The template is always
/// usable: a broken field is kept as literal text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedTemplate {
    pub template: Template,
    pub errors: Vec<TemplateError>,
}

/// A rendered file stem, cleaned for every supported file system.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RenderedName {
    pub stem: String,
    /// Tokens that had no value for this photo and no fallback, by name.
    pub missing: Vec<String>,
    /// Whether characters were replaced or removed to make a valid name.
    pub cleaned: bool,
}

impl Template {
    pub fn parse(template: &str) -> ParsedTemplate {
        let chars: Vec<char> = template.chars().collect();
        let mut parts = Vec::new();
        let mut errors = Vec::new();
        let mut text = String::new();
        let mut index = 0;

        while index < chars.len() {
            let next = chars.get(index + 1).copied();
            match chars[index] {
                '{' if next == Some('{') => {
                    text.push('{');
                    index += 2;
                }
                '}' if next == Some('}') => {
                    text.push('}');
                    index += 2;
                }
                '{' => {
                    let Some(close) = chars[index + 1..].iter().position(|&c| c == '}') else {
                        errors.push(TemplateError {
                            kind: TemplateErrorKind::UnclosedBrace,
                            position: index,
                            text: chars[index..].iter().collect(),
                        });
                        text.extend(&chars[index..]);
                        break;
                    };
                    let end = index + 1 + close;
                    let body: String = chars[index + 1..end].iter().collect();
                    match parse_field(&body, index + 1) {
                        Ok(field) => {
                            if !text.is_empty() {
                                parts.push(Part::Text(std::mem::take(&mut text)));
                            }
                            parts.push(Part::Field(field));
                        }
                        Err(error) => {
                            errors.push(error);
                            text.push('{');
                            text.push_str(&body);
                            text.push('}');
                        }
                    }
                    index = end + 1;
                }
                '}' => {
                    errors.push(TemplateError {
                        kind: TemplateErrorKind::UnmatchedClosingBrace,
                        position: index,
                        text: "}".to_string(),
                    });
                    text.push('}');
                    index += 1;
                }
                character => {
                    text.push(character);
                    index += 1;
                }
            }
        }
        if !text.is_empty() {
            parts.push(Part::Text(text));
        }

        ParsedTemplate {
            template: Template { parts },
            errors,
        }
    }

    /// The cleaned stem for one photo. It can be empty, e.g. for a template
    /// of only `{label}` on an unlabelled photo; `file_stem_from_template`
    /// then keeps the original name.
    pub fn render(&self, source: &NamingSource) -> RenderedName {
        let mut raw = String::new();
        let mut missing = Vec::new();
        for part in &self.parts {
            match part {
                Part::Text(text) => raw.push_str(text),
                Part::Field(field) => {
                    let value = match source.value(field) {
                        Some(value) if !value.is_empty() => value,
                        _ => match &field.fallback {
                            Some(fallback) => fallback.clone(),
                            None => {
                                if !missing.contains(&field.name) {
                                    missing.push(field.name.clone());
                                }
                                String::new()
                            }
                        },
                    };
                    let value = field
                        .filters
                        .iter()
                        .fold(value, |value, filter| filter.apply(value));
                    raw.push_str(&value);
                }
            }
        }
        let stem = clean_file_stem(&raw);
        RenderedName {
            cleaned: stem != raw,
            stem,
            missing,
        }
    }
}

fn parse_field(body: &str, offset: usize) -> Result<Field, TemplateError> {
    let error = |kind, position: usize, text: &str| TemplateError {
        kind,
        position,
        text: text.to_string(),
    };
    let (head, fallback) = match body.split_once('?') {
        Some((head, fallback)) => (head, Some(fallback.to_string())),
        None => (body, None),
    };
    let mut pieces = head.split('|');
    let token_text = pieces.next().unwrap_or_default();
    let (name, format) = match token_text.split_once(':') {
        Some((name, format)) => (name, Some(format)),
        None => (token_text, None),
    };
    if name.is_empty() {
        return Err(error(TemplateErrorKind::EmptyToken, offset, body));
    }
    let token = Token::from_name(name)
        .ok_or_else(|| error(TemplateErrorKind::UnknownToken, offset, name))?;

    let format_position = offset + name.chars().count() + 1;
    let format = match format {
        None if token == Token::Sequence => FieldFormat::Sequence(SequenceFormat::default()),
        None if token.takes_date_format() => FieldFormat::Date(DEFAULT_DATE_FORMAT.to_string()),
        None => FieldFormat::None,
        Some(format) if token == Token::Sequence => {
            FieldFormat::Sequence(parse_sequence_format(format).ok_or_else(|| {
                error(
                    TemplateErrorKind::InvalidSequenceFormat,
                    format_position,
                    format,
                )
            })?)
        }
        Some(format) if token.takes_date_format() => FieldFormat::Date(
            if format.is_empty() {
                DEFAULT_DATE_FORMAT
            } else {
                format
            }
            .to_string(),
        ),
        Some(format) => {
            return Err(error(
                TemplateErrorKind::FormatNotAllowed,
                format_position,
                format,
            ));
        }
    };

    let mut filters = Vec::new();
    let mut filter_position = offset + token_text.chars().count() + 1;
    for piece in pieces {
        filters.push(
            Filter::parse(piece)
                .ok_or_else(|| error(TemplateErrorKind::UnknownFilter, filter_position, piece))?,
        );
        filter_position += piece.chars().count() + 1;
    }

    Ok(Field {
        token,
        name: name.to_string(),
        format,
        filters,
        fallback,
    })
}

/// `4`, `start=101` or both, separated by `:` (`{seq:4:start=101}`).
fn parse_sequence_format(format: &str) -> Option<SequenceFormat> {
    let mut parsed = SequenceFormat::default();
    for piece in format.split(':') {
        if let Some(start) = piece.strip_prefix("start=") {
            parsed.start = start.parse().ok()?;
        } else {
            let width: usize = piece.parse().ok()?;
            if !(1..=10).contains(&width) {
                return None;
            }
            parsed.width = Some(width);
        }
    }
    Some(parsed)
}

/// `YYYY`, `YY`, `MMMM` (January), `MMM` (Jan), `MM`, `DD`, `hh`, `mm`, `ss`;
/// everything else is kept as written.
fn format_date(date: &NaiveDateTime, format: &str) -> String {
    const CODES: [(&str, &str); 9] = [
        ("YYYY", "%Y"),
        ("YY", "%y"),
        ("MMMM", "%B"),
        ("MMM", "%b"),
        ("MM", "%m"),
        ("DD", "%d"),
        ("hh", "%H"),
        ("mm", "%M"),
        ("ss", "%S"),
    ];
    let mut result = String::new();
    let mut rest = format;
    'outer: while let Some(character) = rest.chars().next() {
        for (code, strftime) in CODES {
            if let Some(after) = rest.strip_prefix(code) {
                result.push_str(&date.format(strftime).to_string());
                rest = after;
                continue 'outer;
            }
        }
        result.push(character);
        rest = &rest[character.len_utf8()..];
    }
    result
}

/// One photo as a template sees it. Its capture date, EXIF and library
/// metadata are read only when a token needs them, and nothing is written.
pub struct NamingSource {
    image_path: PathBuf,
    sidecar_path: PathBuf,
    sequence: usize,
    total: usize,
    text: Option<String>,
    capture: OnceCell<NaiveDateTime>,
    exif: OnceCell<HashMap<String, String>>,
    metadata: OnceCell<ImageMetadata>,
}

impl NamingSource {
    /// `path` may be a virtual copy's path; its rating and label are then
    /// the copy's own. `sequence` counts from 1 within a batch of `total`.
    pub fn new(path: &str, sequence: usize, total: usize) -> Self {
        let (image_path, sidecar_path) = parse_virtual_path(path);
        Self {
            image_path,
            sidecar_path,
            sequence,
            total,
            text: None,
            capture: OnceCell::new(),
            exif: OnceCell::new(),
            metadata: OnceCell::new(),
        }
    }

    /// Use this capture date instead of reading it from the file.
    pub fn with_capture_date(self, date: NaiveDateTime) -> Self {
        let _ = self.capture.set(date);
        self
    }

    /// The value of `{text}`.
    pub fn with_text(mut self, text: impl Into<String>) -> Self {
        self.text = Some(text.into());
        self
    }

    fn original_stem(&self) -> &str {
        self.image_path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("image")
    }

    fn capture(&self) -> &NaiveDateTime {
        self.capture
            .get_or_init(|| exif_processing::get_creation_date_from_path(&self.image_path))
    }

    fn exif(&self, keys: &[&str]) -> Option<&str> {
        let exif = self.exif.get_or_init(|| {
            exif_processing::read_exif_without_caching(&self.image_path).unwrap_or_default()
        });
        keys.iter()
            .filter_map(|key| exif.get(*key))
            .map(|value| value.trim())
            .find(|value| !value.is_empty())
    }

    fn metadata(&self) -> &ImageMetadata {
        self.metadata
            .get_or_init(|| exif_processing::load_sidecar(&self.sidecar_path))
    }

    fn value(&self, field: &Field) -> Option<String> {
        let capture_part = |strftime: &str| Some(self.capture().format(strftime).to_string());
        match field.token {
            Token::OriginalFilename => Some(self.original_stem().to_string()),
            Token::OriginalFilenameNumber => {
                let stem = self.original_stem();
                let prefix = stem.trim_end_matches(|c: char| c.is_ascii_digit());
                Some(stem[prefix.len()..].to_string())
            }
            Token::Sequence => {
                let FieldFormat::Sequence(format) = &field.format else {
                    return None;
                };
                let number = format.start + self.sequence.saturating_sub(1);
                let last = format.start + self.total.max(1) - 1;
                let width = format.width.unwrap_or_else(|| last.to_string().len());
                Some(format!("{number:0width$}"))
            }
            Token::Year => capture_part("%Y"),
            Token::Month => capture_part("%m"),
            Token::Day => capture_part("%d"),
            Token::Hour => capture_part("%H"),
            Token::Minute => capture_part("%M"),
            Token::Second => capture_part("%S"),
            Token::Capture | Token::FileDate | Token::Today => {
                let FieldFormat::Date(format) = &field.format else {
                    return None;
                };
                let date = match field.token {
                    Token::Capture => *self.capture(),
                    Token::FileDate => exif_processing::file_date(&self.image_path)?,
                    _ => Local::now().naive_local(),
                };
                Some(format_date(&date, format))
            }
            Token::Camera => self.exif(&["Model"]).map(str::to_string),
            Token::Lens => self.exif(&["LensModel"]).map(str::to_string),
            Token::Iso => self
                .exif(&["PhotographicSensitivity", "ISOSpeedRatings", "ISOSpeed"])
                .and_then(leading_number)
                .map(|iso| (iso.round() as u32).to_string()),
            Token::Focal => self
                .exif(&["FocalLength"])
                .and_then(leading_number)
                .map(|focal| format!("{}mm", short_number(focal))),
            Token::Aperture => self
                .exif(&["FNumber", "ApertureValue"])
                .map(|value| value.trim_start_matches("f/").trim_start_matches('f'))
                .and_then(leading_number)
                .map(|aperture| format!("f{}", short_number(aperture))),
            Token::Shutter => self.exif(&["ExposureTime"]).and_then(shutter_text),
            Token::Rating => {
                let rating = self.metadata().rating;
                (rating > 0).then(|| rating.to_string())
            }
            Token::Label => self
                .metadata()
                .tags
                .iter()
                .flatten()
                .find_map(|tag| tag.strip_prefix(COLOR_TAG_PREFIX))
                .map(capitalize),
            Token::Text => self.text.clone(),
        }
    }
}

/// The file stem `template` gives the photo; the original stem when the
/// template gives an empty one.
pub fn file_stem_from_template(template: &str, source: &NamingSource) -> String {
    let rendered = Template::parse(template).template.render(source);
    file_stem_from_rendered(&rendered, source)
}

/// The stem `rendered` gives the photo of `source`; its original stem when
/// `rendered` is empty.
pub fn file_stem_from_rendered(rendered: &RenderedName, source: &NamingSource) -> String {
    if rendered.stem.is_empty() {
        clean_file_stem(source.original_stem())
    } else {
        rendered.stem.clone()
    }
}

/// A stem valid on macOS, Linux and Windows: characters Windows forbids and
/// control characters become `_`, leading dots (hidden files) and trailing
/// dots and spaces are removed, Windows device names get a `_`, and the
/// length is capped at `MAX_STEM_BYTES`.
pub fn clean_file_stem(stem: &str) -> String {
    const RESERVED: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
    let trim = |text: &str| -> String {
        text.trim()
            .trim_start_matches('.')
            .trim_end_matches(['.', ' '])
            .to_string()
    };

    let replaced: String = stem
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let mut cleaned = trim(&replaced);

    if cleaned.len() > MAX_STEM_BYTES {
        let mut end = MAX_STEM_BYTES;
        while !cleaned.is_char_boundary(end) {
            end -= 1;
        }
        cleaned = trim(&cleaned[..end]);
    }

    // Windows reserves a device name before the first dot (`con`, `LPT1.x`),
    // so the `_` goes right after it.
    let device = cleaned
        .split('.')
        .next()
        .unwrap_or_default()
        .trim_end()
        .to_ascii_uppercase();
    let numbered_device = device.len() == 4
        && (device.starts_with("COM") || device.starts_with("LPT"))
        && matches!(device.as_bytes()[3], b'1'..=b'9');
    if RESERVED.contains(&device.as_str()) || numbered_device {
        cleaned.insert(device.len(), '_');
    }
    cleaned
}

fn slug(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            result.push(character);
        } else if !result.is_empty() && !result.ends_with('-') {
            result.push('-');
        }
    }
    result.trim_end_matches('-').to_string()
}

fn capitalize(value: &str) -> String {
    let mut characters = value.chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(characters).collect()
    })
}

/// The number at the start of an EXIF value such as `50 mm` or `2.8`.
fn leading_number(value: &str) -> Option<f64> {
    let value = value.trim();
    let end = value
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(value.len());
    value[..end]
        .parse()
        .ok()
        .filter(|number: &f64| number.is_finite())
}

/// `50`, `18.5`, `2.8`: at most one decimal, without a trailing `.0`.
fn short_number(number: f64) -> String {
    let rounded = (number * 10.0).round() / 10.0;
    if rounded.fract() == 0.0 {
        format!("{rounded:.0}")
    } else {
        format!("{rounded:.1}")
    }
}

/// `1/250 s` → `1-250s`, `2 s` → `2s`.
fn shutter_text(value: &str) -> Option<String> {
    let value = value
        .trim()
        .trim_end_matches("sec")
        .trim_end_matches('s')
        .trim();
    (!value.is_empty()).then(|| format!("{}s", value.replace('/', "-")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use std::fs;

    fn capture() -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 5, 3)
            .unwrap()
            .and_hms_opt(0, 30, 7)
            .unwrap()
    }

    fn render(template: &str, path: &str, sequence: usize, total: usize) -> RenderedName {
        let parsed = Template::parse(template);
        assert_eq!(parsed.errors, [], "template {template}");
        let source = NamingSource::new(path, sequence, total).with_capture_date(capture());
        parsed.template.render(&source)
    }

    fn stem(template: &str) -> String {
        render(template, "/photos/IMG_0042.CR3", 3, 120).stem
    }

    #[test]
    fn original_tokens_keep_their_meaning() {
        assert_eq!(
            stem("{original_filename}_{original_filename_number}_{sequence}"),
            "IMG_0042_0042_003"
        );
        assert_eq!(stem("{YYYY}-{MM}-{DD}_{hh}{mm}{ss}"), "2026-05-03_003007");
        assert_eq!(stem("{original_filename}_edited"), "IMG_0042_edited");
    }

    #[test]
    fn capture_time_is_used_as_the_camera_recorded_it() {
        // 00:30 stays 00:30 on the same day in every time zone.
        assert_eq!(stem("{date}"), "20260503");
        assert_eq!(stem("{capture:YYYY-MM-DD_hhmm}"), "2026-05-03_0030");
        assert_eq!(stem("{date:DD MMM YY}"), "03 May 26");
        assert_eq!(stem("{date:MMMM}"), "May");
    }

    #[test]
    fn sequences_take_a_width_and_a_start() {
        assert_eq!(stem("{seq}"), "003");
        assert_eq!(stem("{seq:5}"), "00003");
        assert_eq!(stem("{seq:start=101}"), "103");
        assert_eq!(stem("{seq:4:start=101}"), "0103");
        assert_eq!(render("{seq}", "/a.jpg", 1, 1).stem, "1");
        assert_eq!(render("{seq:start=98}", "/a.jpg", 1, 5).stem, "098");
    }

    #[test]
    fn filters_and_fallbacks_apply_in_order() {
        assert_eq!(stem("{original_filename|lower}"), "img_0042");
        assert_eq!(stem("{original_filename|trim:3|lower}"), "img");
        assert_eq!(stem("{date:MMMM|upper}"), "MAY");
        // The fallback replaces a missing value and then passes the filters.
        let missing = render("{text|upper?Holiday}_{camera}", "/none.jpg", 1, 1);
        assert_eq!(missing.stem, "HOLIDAY_");
        assert_eq!(missing.missing, ["camera"]);
        let source = NamingSource::new("/none.jpg", 1, 1).with_text("Côte d'Azur 2026!");
        let parsed = Template::parse("{text|slug}");
        assert_eq!(parsed.template.render(&source).stem, "côte-d-azur-2026");
        assert_eq!(stem("{date:}"), "20260503");
    }

    #[test]
    fn errors_report_their_position_and_keep_the_text() {
        let parsed = Template::parse("a_{foo}_{seq:x}_{camera:1}_{date|shout}_}_{{x}}_{open");
        let kinds: Vec<_> = parsed
            .errors
            .iter()
            .map(|e| (e.kind, e.position, e.text.as_str()))
            .collect();
        assert_eq!(
            kinds,
            [
                (TemplateErrorKind::UnknownToken, 3, "foo"),
                (TemplateErrorKind::InvalidSequenceFormat, 13, "x"),
                (TemplateErrorKind::FormatNotAllowed, 24, "1"),
                (TemplateErrorKind::UnknownFilter, 33, "shout"),
                (TemplateErrorKind::UnmatchedClosingBrace, 40, "}"),
                (TemplateErrorKind::UnclosedBrace, 48, "{open"),
            ]
        );
        let source = NamingSource::new("/a.jpg", 1, 1);
        assert_eq!(
            parsed.template.render(&source).stem,
            "a_{foo}_{seq_x}_{camera_1}_{date_shout}_}_{x}_{open"
        );
        assert_eq!(
            Template::parse("{}").errors[0].kind,
            TemplateErrorKind::EmptyToken
        );
    }

    #[test]
    fn names_are_cleaned_for_every_file_system() {
        assert_eq!(
            clean_file_stem("a/b:c*d?\"e\"<f>|g\\h"),
            "a_b_c_d__e__f__g_h"
        );
        assert_eq!(clean_file_stem("  ..hidden. . "), "hidden");
        assert_eq!(clean_file_stem("tab\there"), "tab_here");
        assert_eq!(clean_file_stem("con"), "con_");
        assert_eq!(clean_file_stem("LPT1.backup"), "LPT1_.backup");
        assert_eq!(clean_file_stem("Aux "), "Aux_");
        assert_eq!(clean_file_stem("COM0"), "COM0");
        assert_eq!(clean_file_stem("console"), "console");
        let long = "é".repeat(150);
        let capped = clean_file_stem(&long);
        assert_eq!(capped.len(), MAX_STEM_BYTES);
        assert!(capped.chars().all(|c| c == 'é'));

        let rendered = render("{YYYY}/{MM}", "/a.jpg", 1, 1);
        assert_eq!(rendered.stem, "2026_05");
        assert!(rendered.cleaned);
        assert!(!render("{YYYY}", "/a.jpg", 1, 1).cleaned);
    }

    #[test]
    fn an_empty_result_keeps_the_original_name() {
        let source = NamingSource::new("/photos/IMG_7.jpg", 1, 1);
        assert_eq!(file_stem_from_template("{label}", &source), "IMG_7");
        assert_eq!(file_stem_from_template("{label}_{seq}", &source), "_1");
    }

    #[test]
    fn exif_and_library_tokens_read_the_sidecar() {
        let folder = tempfile::tempdir().unwrap();
        let image = folder.path().join("DSC_1.jpg");
        fs::write(&image, []).unwrap();
        let exif: HashMap<String, String> = [
            ("Make", "NIKON CORPORATION"),
            ("Model", "NIKON Z 6"),
            ("LensModel", "NIKKOR Z 24-70mm f/4 S"),
            ("PhotographicSensitivity", "400"),
            ("FocalLength", "35 mm"),
            ("FNumber", "f/5.6"),
            ("ExposureTime", "1/250 s"),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
        let metadata = ImageMetadata {
            rating: 4,
            tags: Some(vec!["user:sky".to_string(), "color:red".to_string()]),
            exif: Some(exif),
            ..ImageMetadata::default()
        };
        fs::write(
            exif_processing::get_primary_sidecar_path(&image),
            serde_json::to_string(&metadata).unwrap(),
        )
        .unwrap();

        let path = image.to_string_lossy();
        let source = NamingSource::new(&path, 1, 1);
        let parsed = Template::parse(
            "{camera}_{lens}_ISO{iso}_{focal}_{aperture}_{shutter}_{rating}_{label}",
        );
        assert_eq!(parsed.errors, []);
        let rendered = parsed.template.render(&source);
        assert_eq!(
            rendered.stem,
            "NIKON Z 6_NIKKOR Z 24-70mm f_4 S_ISO400_35mm_f5.6_1-250s_4_Red"
        );
        assert!(rendered.missing.is_empty());

        // A virtual copy has its own rating and label, and no EXIF of its own.
        let copy = format!("{path}?vc=abc123");
        let copy_sidecar = parse_virtual_path(&copy).1;
        let copy_metadata = ImageMetadata {
            rating: 2,
            ..ImageMetadata::default()
        };
        fs::write(
            &copy_sidecar,
            serde_json::to_string(&copy_metadata).unwrap(),
        )
        .unwrap();
        let source = NamingSource::new(&copy, 1, 1);
        let parsed = Template::parse("{original_filename}_{camera}_{rating}_{label?none}");
        assert_eq!(
            parsed.template.render(&source).stem,
            "DSC_1_NIKON Z 6_2_none"
        );
    }

    #[test]
    fn exif_values_become_short_names() {
        assert_eq!(leading_number("50 mm"), Some(50.0));
        assert_eq!(leading_number("x"), None);
        assert_eq!(short_number(18.0), "18");
        assert_eq!(short_number(2.8), "2.8");
        assert_eq!(short_number(4.04), "4");
        assert_eq!(shutter_text("1/250 s").as_deref(), Some("1-250s"));
        assert_eq!(shutter_text("2 s").as_deref(), Some("2s"));
        assert_eq!(shutter_text("0.5").as_deref(), Some("0.5s"));
        assert_eq!(shutter_text(" s"), None);
    }
}
