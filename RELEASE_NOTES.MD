# RapidRAW - Enhanced Release Notes

This is the continuous release history for production builds of RapidRAW -
Enhanced. The newest release appears first. Existing release entries are
historical records and should not be rewritten except to correct factual
errors.

## 1.6.1-colrbent.29 — 2026-07-28

### Clear active filters

- A subtle **Clear all filters** action now appears beside the Library header's
  active-filter summary.
- The action resets rating, file-type, edit-state, color, and flag filters
  together, then disappears with the summary.
- Filter chips continue to clip before the action and the header retains its
  existing height.

### Validation

- Frontend production build, locale runtime validation, formatting, and
  relevant-file TypeScript diagnostics passed.
- Release packaging passed.

## 1.6.1-colrbent.28 — 2026-07-28

### Active filter summary

- The Library header now lists active rating, file-type, edit-state, color, and
  flag filters as subtle compact chips beside the current folder path.
- The summary remains on the header's existing second line and cannot increase
  header height.
- Long combinations are clipped to the available width, with the complete
  filter list available in a tooltip.

### Validation

- Frontend production build, locale runtime validation, formatting, and
  relevant-file TypeScript diagnostics passed.
- Release packaging passed.

## 1.6.1-colrbent.26 — 2026-07-28

### Flag presentation and filtering

- Rejected images now use a neutral dark thumbnail overlay in the Library
  grid/list and Develop filmstrip, while badges and other thumbnail information
  remain readable.
- Flag badges and toolbar states now use monochrome icons consistent with the
  rest of RapidRAW.
- Added combinable Rejected, Selected, Deferred, and Unflagged filters to View
  Options and the bottom Quick Filter.
- Added advanced flag queries such as `flag:rejected`.

### Validation

- Frontend production build, locale runtime validation, backend compilation,
  relevant-file TypeScript diagnostics, focused flag-filter assertions, and
  formatting passed.
- Release packaging passed.

## 1.6.1-colrbent.24 — 2026-07-27

### Flag badge refinement

- Removed the bright circular outline that made flag badges resemble a halo or
  contour.
- Flag badges now use a compact translucent dark square with a colored glyph,
  retaining visibility without obscuring the thumbnail.

### Validation

- Frontend production build and formatting passed.
- Release packaging passed.

## 1.6.1-colrbent.23 — 2026-07-27

### Image flags

- Added persistent **Rejected**, **Selected**, **Deferred**, and **Unflagged**
  states for physical images and virtual copies.
- Added distinct flag badges to Library grid/list thumbnails and the Develop
  filmstrip.
- Added a separate Flags group to the bottom toolbar in both Library and
  Develop, including a confirmed action to permanently delete rejected files
  from the current folder only.
- Added configurable shortcuts: `X` for Rejected, `U` for Unflagged,
  `Shift+P` for Selected, and `Shift+D` for Deferred. The modified shortcuts
  avoid the existing `P` Presets and `D` Adjustments bindings.
- Flag metadata remains independent of color labels and ordinary editable
  tags.

### Validation

- Frontend production build, relevant-file TypeScript diagnostics, locale
  runtime validation, backend compilation, focused flag policy checks,
  formatting, and release packaging passed.

## 1.6.1-colrbent.22 — 2026-07-27

### Stack presentation and ordering

- Added the Library grid's stack presentation to the Develop filmstrip:
  collapsed stacks use the same high-contrast count badge, while expanded
  stacks use the same orange spine and cover cue.
- Renamed **Set as Stack Cover** to **Move to Top of Stack**.
- Moving an image to the top now updates both the persisted stack order and its
  cover. New stacks and loaded legacy stacks also keep their cover in the first
  position.

### Validation

- Frontend production build, stack-order assertions, formatting, relevant-file
  TypeScript diagnostics, locale runtime validation, Rust release compilation,
  and release packaging passed.

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

### Validation

- Frontend production build, Rust compilation, locale runtime validation,
  relevant-file TypeScript diagnostics, and release packaging passed.

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

### Validation

- Frontend production build, locale runtime validation, relevant-file
  TypeScript diagnostics, focused TIFF metadata/decoding/GPS tests, and
  release packaging passed.

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

### Validation

- Frontend production build, Rust compilation, focused settings test,
  relevant-file TypeScript diagnostics, locale runtime validation, and
  release packaging passed.
