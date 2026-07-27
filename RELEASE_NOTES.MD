# RapidRAW - Enhanced Release Notes

This is the continuous release history for production builds of RapidRAW -
Enhanced. The newest release appears first. Existing release entries are
historical records and should not be rewritten except to correct factual
errors.

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
