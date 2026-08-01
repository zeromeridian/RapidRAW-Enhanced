# ThisIsRAW Features

This is the concise, current inventory of features added to ThisIsRAW. It
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
- Responsive loading for large recursive folders, with scan and metadata
  reconciliation moved off the application event loop, bounded background
  filesystem work, and batched Library updates.
- Thumbnail-prioritized cold-folder loading with delayed, bounded, cancelable
  background EXIF extraction.

## Develop

- Dedicated **Crop** and **Geometry** modules separate composition from
  perspective work. Geometry includes full **Auto** correction that jointly
  balances rotation and both perspective axes, focused **Level** and
  **Vertical** correction, pair-based **Guided Transform**, editable **Manual Transform**
  controls, lens correction, and a persistent **Constrain Crop** option. Guided
  Transform operates directly on the full Develop image while its controls
  occupy the Geometry panel. Thin blue lines provide precise placement without
  visible endpoint markers, while enlarged invisible endpoint targets preserve
  easy adjustment. A Reset tile beside the transformation-mode buttons clears
  all transforms while retaining separate lens corrections. It accepts up to
  two vertical and two horizontal lines;
  either completed pair corrects its parallel structures, while both
  pairs produce a combined perpendicular correction. Guide coordinates and
  resolved geometry persist through presets, adjustment copying, and XMP.
  Active automatic modes remain highlighted; Guided also recognizes its
  completed persisted guide pairs when restored. All modes synchronize their
  rotation, vertical, and horizontal correction values through XMP. Adaptive
  contrast and line-length analysis recognizes shorter, lower-contrast
  structures, while robust grouped-line perspective estimation handles both
  parallel and converging architectural edges.
- The Masking module presents every mask source directly, without an additional
  **Others** submenu.
- A dedicated **Tagging** module adds and removes tags across the current image
  or multi-image selection, with common and mixed tags clearly distinguished.
- Persisted Color / Black & White mode in the global Color section.
- Named tone-curve presets with unique names, built-in Linear and contrast
  presets, modification indicators, update, save-as-new, and delete actions.
- Local masks support Black & White conversion, Color Calibration, Light
  Flares, Gaussian Blur, Vignette, and Grain in addition to the existing tonal,
  color, detail, curve, glow, and halation adjustments.
- Mask overlays can be hidden without disabling the selected mask through a
  dedicated Masking-panel control or configurable `O` shortcut.
- Mask containers can be drag-reordered and composited with Normal, darkening,
  lightening, contrast, and component blend modes. Mask order and blend mode
  persist with the complete editable state in XMP.
- Clear green enabled styling and dimmed neutral styling for shared toggle
  switches throughout the application.

## Files, export, and metadata

- A versioned ThisIsRAW XMP payload carries the complete editable adjustment
  document between installations, including ordered masks and blend modes.

- Optional, remembered filename suffixes for exports and separate suffixes for
  physical and virtual copies.
- Export directly beside each source image.
- Consolidated EXIF export controls with optional GPS removal.
- Complete readable EXIF preservation for JPEG and a safe allowlist for TIFF,
  with ThisIsRAW recorded as the exporting software.
- XMP synchronization for ratings, color labels, keywords, physical-image
  flags, and physical stack membership, order, cover, and collapsed state.
- Recursive **Read XMP from Folder** action that treats XMP as authoritative
  for matching images, recognizes basename and full-filename sidecars, reports
  the imported-image count, and refreshes the currently open folder.
