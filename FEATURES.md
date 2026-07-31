# This Is Raw Features

This is the concise, current inventory of features added to This Is Raw. It
describes the application as it exists now; release history and validation
details are in `RELEASE_NOTES.MD`.

## Library and workflow

- Customizable bottom toolbar shared by Library and Develop, with Productivity,
  Copy, Stacking, Flags, and direct color-label controls.
- Manual image stacks with collapse/expand, visible stack cues, drag ordering,
  move-to-top covers, and matching Develop-filmstrip presentation.
- Automatic stacking of physical copies, virtual copies, and exported images,
  with optional automatic expansion.
- Rejected, Selected, Deferred, and Unflagged states with keyboard shortcuts,
  thumbnail badges, rejected-image dimming, filtering, and rejected-file
  deletion for the currently loaded folder view.
- Compact active-filter summary in the Library header with one-click
  **Clear all filters**.
- Compact neutral file-type badges in Library grid and list metadata, using a
  shared `RAW` label for camera formats and normalized labels such as `JPG` and
  `TIF` for rendered files.
- Configurable shortcuts for Library Grid and flag actions.
- Caps Lock auto-advance after applying ratings, color labels, or flags.
- Main Settings access from both Library and Develop.
- Optional launch directly into the last library, bypassing the splash screen.
- Persistent Library and Develop sidebar widths.
- Optional empty-folder hiding that preserves configured and pinned roots while
  removing branches with no supported images.
- Progressive loading for large recursive folders, with background metadata
  reconciliation and batched Library updates so thumbnails can appear promptly.
- Thumbnail-prioritized cold-folder loading with delayed, bounded, cancelable
  background EXIF extraction.

## Develop

- Dedicated **Crop** and **Geometry** modules separate composition from
  perspective work. Geometry includes automatic **Level** and **Vertical**
  correction, editable **Manual Transform** controls, lens correction, and a
  persistent **Constrain Crop** option. Active automatic modes remain
  highlighted and synchronize their correction values through XMP.
- The Masking module presents every mask source directly, without an additional
  **Others** submenu.
- A dedicated **Tagging** module adds and removes tags across the current image
  or multi-image selection, with common and mixed tags clearly distinguished.
- Persisted Color / Black & White mode in the global Color section.
- Named tone-curve presets with unique names, built-in Linear and contrast
  presets, modification indicators, update, save-as-new, and delete actions.
- Local masks support Black & White conversion, Color Calibration, Light
  Flares, Vignette, and Grain in addition to the existing tonal, color,
  detail, curve, glow, and halation adjustments.
- Clear green enabled styling and dimmed neutral styling for shared toggle
  switches throughout the application.

## Files, export, and metadata

- Optional, remembered filename suffixes for exports and separate suffixes for
  physical and virtual copies.
- Export directly beside each source image.
- Consolidated EXIF export controls with optional GPS removal.
- Complete readable EXIF preservation for JPEG and a safe allowlist for TIFF,
  with This Is Raw recorded as the exporting software.
- XMP synchronization for ratings, color labels, keywords, physical-image
  flags, and physical stack membership, order, cover, and collapsed state.
- Recursive **Read XMP from Folder** action that treats XMP as authoritative
  for matching images, recognizes basename and full-filename sidecars, reports
  the imported-image count, and refreshes the currently open folder.
