# ThisIsRAW Features

This is the concise, current inventory of features added to ThisIsRAW. It
describes the application as it exists now; release history and validation
details are in `RELEASE_NOTES.MD`.

## Library and workflow

- Lightroom-style **Lights Out** viewing across Library and Develop, with
  session-only Normal, Dim, and Black states; forward/reverse configurable
  shortcuts; Escape-first restoration; a full-brightness photograph while Dim
  darkens only surrounding application chrome; and a distraction-free Develop
  Black state that removes application chrome from layout so the photograph
  uses all available space and forces both the web and native GPU surrounds to
  true black. The native preview retains its last valid frame during a Black
  layout transition, so it is never replaced by a blank surface. Black
  automatically enters fullscreen (using focus-preserving simple fullscreen
  on macOS) and restores the prior window/fullscreen state on exit. Normal and Dim retain the complete
  interface. General Settings provides a persistent configurable Black-mode
  frame with presets, percentage or pixel units, locked or independent sides,
  precise values, live preview, and reset; Fit reserves the chosen four-sided
  margins through the established renderer geometry path; previous/next
  navigation invalidates the outgoing preview immediately and keeps those
  margins in place from the new photograph's first visible frame. Active Lights
  Out cycling and Escape
  restoration bypass stale focus held by chrome hidden in Black mode.
- Customizable bottom toolbar shared by Library and Develop, with Productivity,
  Copy, Stacking, Flags, direct color-label controls, and a visually distinct
  expandable **Select by** control. Select by replaces the current selection
  using any rating, RAW/non-RAW, edit-status, color-label, or flag criterion
  without changing active filters. It follows the Quick Filter inline design,
  exposes match counts in tooltips, and provides an in-place clear-selection
  action. The chosen criterion remains visibly active and acts as a toggle;
  clicking it again clears its selection, while manual selection changes remove
  stale criterion highlighting.
- Manual image stacks with collapse/expand, visible stack cues, drag ordering,
  move-to-top covers, and matching Develop-filmstrip presentation.
- Automatic stacking of physical copies, virtual copies, and exported images,
  with optional automatic expansion.
- Rejected, Selected, Deferred, and Unflagged states with keyboard shortcuts,
  thumbnail badges, rejected-image dimming, filtering, and rejected-file
  deletion for the currently loaded folder view.
- Unified bottom **Quick Filter** controls for unrated and rating thresholds,
  RAW/non-RAW files, edited/original status, color labels, and flags, with an
  in-place clear-all action and a persistent active-filter indicator. Rating
  filters and rating-based selection provide explicit **up to (≤)** and **and
  up (≥)** comparisons, with star highlights matching the selected range. The
  top **View Options** menu remains focused on display, sorting, metadata, and
  grouping controls, while the Library header retains its compact active-filter
  summary.
- Compact neutral file-type badges in Library grid and list metadata, using a
  shared `RAW` label for camera formats and normalized labels such as `JPG` and
  `TIF` for rendered files.
- Configurable shortcuts for Library Grid and flag actions.
- Caps Lock auto-advance after applying ratings, color labels, or flags.
- Main Settings access from both Library and Develop.
- Optional launch directly into the last library, bypassing the splash screen.
- Proprietary `.tirdata` sidecars keep ThisIsRAW edits, metadata, and virtual
  copies separate from RapidRAW. Settings provides an explicit non-destructive
  importer for compatible `.rrdata` files that never overwrites existing
  `.tirdata` data or alters the RapidRAW originals.
- Non-destructive Lightroom Classic XMP translation preview for selected
  physical images. The review lists every proposed mapping and its confidence,
  leaves `.tirdata` and Lightroom XMP untouched until explicit approval, then
  merges only approved supported fields while preserving ThisIsRAW-only edits.
  Successfully changed images regenerate their grid thumbnails from the new
  adjustments without reloading or blocking the complete Library.
- Bulk preset application for selected images or multiple selected folders,
  with direct-folder and recursive scopes, search, progress, cancellation, and
  background continuation.
- Persistent Library and Develop sidebar widths.
- Optional empty-folder hiding that preserves configured and pinned roots while
  removing branches with no supported images.
- Responsive loading for large direct and recursive folders, with transactional
  folder/album navigation, embedded image and folder-tree catalog snapshots,
  persistent cross-launch thumbnail references, progressive root-tree
  refinement, and generation-guarded state commits. Cataloged content and
  navigation appear immediately while the filesystem is revalidated in the
  background; temporarily unavailable roots retain their last usable tree.
  Sidecar/XMP reconciliation uses bounded background workers, and optional AI
  indexing yields to visible thumbnails and cannot refresh an unrelated folder.
  Files, `.tirdata`, and XMP remain authoritative; the bundled SQLite catalog
  requires no server.
- The library catalog location is visible and customizable in General Settings;
  changing it safely moves the existing catalog, with an option to restore the
  platform-default location.
- Thumbnail-prioritized cold-folder loading with delayed, bounded, cancelable
  background EXIF extraction. Catalog thumbnails display immediately and
  visible Grid/Culling items are then validated against source and current
  sidecar adjustment cache keys. Develop autosaves coalesce superseded
  thumbnail renders so stale jobs cannot replace the latest edit. All adjusted
  thumbnail entry points reuse the Develop GPU pipeline and refuse to publish
  an inaccurate unprocessed fallback; renderer-version changes invalidate
  incompatible cached thumbnails once. Folder navigation replaces obsolete
  visible-thumbnail work with the new active folder's requests. Full-folder
  thumbnail generation occurs only through explicit **Refresh folders** and
  uses one separate low-priority worker; direct/recursive scope follows the
  current Library mode.

## Develop

- Dedicated **Crop** and **Geometry** modules separate composition from
  perspective work. Geometry includes full **Auto** correction that jointly
  balances rotation and both perspective axes, focused **Level** and
  **Vertical** correction, pair-based **Guided Transform**, editable **Manual Transform**
  controls, and a persistent **Constrain Crop** option. Guided
  Transform operates directly on the full Develop image while its controls
  occupy the Geometry panel. Thin blue lines provide precise placement without
  visible endpoint markers, while enlarged invisible endpoint targets preserve
  easy adjustment. A Reset tile beside the transformation-mode buttons clears
  all transforms while retaining separate lens corrections. It accepts up to
  two vertical and two horizontal lines. Apply and Cancel sit immediately below
  Clear All Guides so preview completion is explicit. Either completed pair
  corrects its parallel structures, while both
  pairs produce a combined perpendicular correction. Guide coordinates and
  resolved geometry persist through presets, adjustment copying, and XMP.
  Active automatic modes remain highlighted; Guided also recognizes its
  completed persisted guide pairs when restored. All modes synchronize their
  rotation, vertical, and horizontal correction values through XMP. Adaptive
  contrast and line-length analysis recognizes shorter, lower-contrast
  structures, while robust grouped-line perspective estimation handles both
  parallel and converging architectural edges.
- A dedicated **Lens Correction** sidebar module applies Auto detection or a
  manually selected Lensfun profile directly to the full Develop image, with
  independent distortion, chromatic-aberration, and vignetting controls. Lens
  settings, including Auto mode, persist in Tool and Style presets without
  requiring crop and transform data to be included.
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
- Initial Lightroom Classic translation covers global tone, presence, HSL,
  sharpening/noise reduction, color calibration, point curves, monochrome,
  grain, and post-crop vignette settings. The review identifies approximate
  mappings and warns about unsupported absolute white balance, profiles, lens
  corrections, crop/geometry, masks, and retouching.

## Application identity and data continuity

- Uses `io.github.ColrBent.ThisIsRAW` consistently across supported packaging.
- Automatically preserves settings, catalogs, and cached thumbnails from the
  previous application identifier without blocking the UI on large caches.
