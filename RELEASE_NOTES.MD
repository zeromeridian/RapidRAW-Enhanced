# RapidRAW - Enhanced Release Notes

This is the continuous release history for production builds of RapidRAW -
Enhanced. The newest release appears first. Existing release entries are
historical records and should not be rewritten except to correct factual
errors.

## 1.6.1-colrbent.20 — 2026-07-27

### Export metadata controls

- Removed the redundant standalone Metadata section and the separate
  full/safe inheritance switch.
- JPEG and TIFF now expose one **Include EXIF metadata** toggle inside
  **Advanced → Export Settings**, with **Remove GPS Data** nested below it.
- The single toggle automatically selects the correct implementation: complete
  readable EXIF for JPEG and the validated safe allowlist for TIFF.
- Export presets retain only the existing `keepMetadata` choice as the active
  source of truth. Older presets remain compatible.

### Validation and artifact

- Frontend production build, Rust compilation, locale runtime validation,
  relevant-file TypeScript diagnostics, and AppImage packaging passed.
- Artifact:
  `src-tauri/target/release/bundle/appimage/RapidRAW - Enhanced_1.6.1-colrbent.20_amd64.AppImage`
- SHA-256:
  `98249d9b65150eea6c1a8d956e405aa32283db42e5bcb119240049973e03e492`
- Platform: Linux x86-64 AppImage.

## 1.6.1-colrbent.19 — 2026-07-27

### TIFF metadata

- Added **Preserve safe EXIF data from source** for TIFF exports.
- TIFF exports can preserve camera make/model, lens make/model, capture and
  creation dates, exposure time, aperture, ISO, exposure compensation, focal
  lengths, artist, copyright, description, and GPS when GPS removal is
  disabled.
- Software is rewritten as `RapidRAW - Enhanced`.
- Structural TIFF fields, embedded previews, MakerNote, and other
  source-layout-dependent metadata are not copied.
- Metadata is merged into the newly encoded TIFF's own structural directories.
  RapidRAW then fully decodes the result; if metadata writing or validation
  fails, it safely uses the metadata-free encoded TIFF.

### Validation and artifact

- Frontend production build, locale runtime validation, relevant-file
  TypeScript diagnostics, focused TIFF metadata/decoding/GPS tests, and
  AppImage packaging passed.
- Artifact:
  `src-tauri/target/release/bundle/appimage/RapidRAW - Enhanced_1.6.1-colrbent.19_amd64.AppImage`
- SHA-256:
  `f0f68eaa31f34ab78ec8b6eb33ef71e2c5439e3e49253b64e7c3a0164ed3d3cc`
- Platform: Linux x86-64 AppImage.

## 1.6.1-colrbent.18 — 2026-07-27

### Export workflow

- Added **Inherit all EXIF data from source** for JPEG exports. Supported
  source formats copy their complete readable EXIF structure; RAW and
  unsupported sources retain the established camera/capture metadata fallback.
- **Remove GPS Data** remains authoritative when complete EXIF inheritance is
  enabled.
- Added **Export to same folder as source**. Batch exports resolve each output
  beside its corresponding source, even when sources span multiple folders.
- Same-folder export is mutually exclusive with Preserve Folder Structure and
  prevents accidental source-file replacement.
- Both new export choices are retained by named and last-used export presets.

### Naming and stacking

- When the optional export suffix is enabled, the untouched built-in
  `_edited` suffix is omitted. Custom filename templates are unchanged.
- Successful exports now wait for automatic-stack persistence and library
  refresh, allowing new same-folder outputs and their expanded stacks to
  appear immediately in the Editor/Develop filmstrip.

### Validation and artifact

- Frontend production build, Rust compilation, focused settings test,
  relevant-file TypeScript diagnostics, locale runtime validation, and
  AppImage packaging passed.
- Artifact:
  `src-tauri/target/release/bundle/appimage/RapidRAW - Enhanced_1.6.1-colrbent.18_amd64.AppImage`
- SHA-256:
  `55606953adb0cb343128ff865238659d2b366dc37b6eb50a880238da8469aecd`
- Platform: Linux x86-64 AppImage.
