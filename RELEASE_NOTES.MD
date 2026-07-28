# RapidRAW - Enhanced Release Notes

This is the continuous release history for production builds of RapidRAW -
Enhanced. The newest release appears first. Entries contain only concise,
user-facing changes so each version can be copied directly into a GitHub
Release description.

## 1.6.1-colrbent.38 — 2026-07-28

### Explicit folder XMP import

- Folder-tree context menus now provide **Read XMP from Folder** directly below
  **Refresh Folders**.
- The action reads only physical images directly inside the selected folder;
  it does not recurse into subfolders.
- XMP is treated as authoritative for ratings, labels, keywords, flags and
  physical stack metadata, replacing the corresponding local sidecar values.
- The current Library view refreshes automatically when its folder is
  imported, and a completion message reports the number of XMP files read.

## 1.6.1-colrbent.37 — 2026-07-28

### Portable XMP flags and stacks

- Physical-image flags now synchronize through RapidRAW-specific XMP metadata
  and are restored by another RapidRAW - Enhanced installation.
- Physical stacks now store a shared stack identifier, member order, cover
  status and collapsed state in each member's XMP sidecar.
- Existing stacks are backfilled when settings load, and stacks discovered in
  XMP are reconstructed using the paths available on the current machine.
- Virtual copies continue using their independent RapidRAW sidecars because
  multiple virtual copies share one physical XMP file.

## 1.6.1-colrbent.36 — 2026-07-28

### CI lint reliability

- Updated the tone-curve preset settings test to follow the enforced Rust
  linting rules without changing application behavior.

## 1.6.1-colrbent.33 — 2026-07-28

### Caps Lock auto-advance

- With Caps Lock enabled, keyboard-applied ratings, color labels, and flags now
  advance to the next visible image in Library and Develop.
- Auto-advance stops at the final visible image and suppresses held-key repeats
  to prevent unintended rapid changes.
- Grid navigation and all four flag shortcuts remain independently
  configurable in Main Settings with conflict detection and reset support.

## 1.6.1-colrbent.32 — 2026-07-28

### Splash ownership notice

- The launch-screen footer now identifies ColrBent's copyright ownership of
  RapidRAW - Enhanced modifications beside the current application version.
- The notice uses the current year automatically, remains visually subtle, and
  can wrap without overflowing narrower layouts.
- Its wording limits the ownership claim to fork modifications and does not
  claim the original RapidRAW work.

## 1.6.1-colrbent.31 — 2026-07-28

### Fork branding cleanup

- Removed the inherited funding configuration and donation link.
- Removed upstream personal promotional links and attribution from the launch
  screen while preserving required upstream attribution in project
  documentation.
- Update checks, release downloads, contribution links, ownership metadata,
  package authorship, and packaging sources now point to or identify the
  RapidRAW - Enhanced fork.
- Upstream compatibility identifiers and required technical dependencies
  remain unchanged.

## 1.6.1-colrbent.30 — 2026-07-28

### Build automation

- Continuous, pull-request, and release packaging matrices now contain only
  the four currently supported desktop targets.
- Main-branch builds can also be started manually for reliable pipeline
  testing.
- Workflow artifacts are uploaded from the packaging action's reported output
  paths, and a missing bundle now fails the job instead of completing without a
  downloadable build.
- The reusable build uses deterministic dependency installation, exact
  caller-commit checkout, and a current immutable packaging-action release.

## 1.6.1-colrbent.29 — 2026-07-28

### Clear active filters

- A subtle **Clear all filters** action now appears beside the Library header's
  active-filter summary.
- The action resets rating, file-type, edit-state, color, and flag filters
  together, then disappears with the summary.
- Filter chips continue to clip before the action and the header retains its
  existing height.

## 1.6.1-colrbent.28 — 2026-07-28

### Active filter summary

- The Library header now lists active rating, file-type, edit-state, color, and
  flag filters as subtle compact chips beside the current folder path.
- The summary remains on the header's existing second line and cannot increase
  header height.
- Long combinations are clipped to the available width, with the complete
  filter list available in a tooltip.

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

## 1.6.1-colrbent.24 — 2026-07-27

### Flag badge refinement

- Removed the bright circular outline that made flag badges resemble a halo or
  contour.
- Flag badges now use a compact translucent dark square with a colored glyph,
  retaining visibility without obscuring the thumbnail.

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

## 1.6.1-colrbent.22 — 2026-07-27

### Stack presentation and ordering

- Added the Library grid's stack presentation to the Develop filmstrip:
  collapsed stacks use the same high-contrast count badge, while expanded
  stacks use the same orange spine and cover cue.
- Renamed **Set as Stack Cover** to **Move to Top of Stack**.
- Moving an image to the top now updates both the persisted stack order and its
  cover. New stacks and loaded legacy stacks also keep their cover in the first
  position.

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
