# ThisIsRAW Release Notes

This is the continuous release history for production builds of ThisIsRAW.
The newest release appears first. Entries contain only concise, user-facing
changes so each version can be copied directly into a GitHub Release
description.

## 1.6.3-feature-lights-out — 2026-08-21

### Restorable fullscreen Black mode

- Entering Black Lights Out now places the application window in true
  fullscreen automatically.
- Leaving Black restores the previous window state: sessions that began
  windowed return to windowed mode, while existing fullscreen sessions remain
  fullscreen.
- Every remaining part of the image stage and application surround is forced to
  pure black without altering the photograph.

## 1.6.2-feature-lights-out — 2026-08-21

### True-black fullscreen surround

- Black Lights Out now also sets the native GPU preview surface and application
  window surround to true black, leaving only the photograph visible in the
  distraction-free fullscreen view.
- Photograph colors and brightness remain unchanged.

## 1.6.1-feature-lights-out — 2026-08-21

### Distraction-free Black mode

- Black Lights Out now removes the title bar, sidebars, editor toolbar, and
  filmstrip from the layout so the photograph expands into all available space.
- Normal and Dim modes retain the complete interface, and leaving Black mode
  restores every panel in its previous state.

## 1.6.0-feature-lights-out — 2026-08-21

### Lights Out viewing

- Added Lightroom-style **Lights Out** viewing in both Library and Develop.
- Press **L** to cycle Normal → Dim → Black, or **Shift+L** to cycle backward;
  both shortcuts are configurable in Settings.
- Photographs, thumbnails, selection indicators, and editing overlays remain
  fully visible while surrounding application chrome is subdued.
- **Escape** restores normal lighting before performing its existing action.

## 1.5.9-fix-filter-cleanup — 2026-08-21

### Consistent selected-rating highlights

- Rating-based selection now keeps every star in the active **≤** or **≥**
  range visibly enabled, even when an included star has no standalone matches.
- Filtering and selection now use the same shared star-range calculation.

## 1.5.8-fix-filter-cleanup — 2026-08-21

### Directional rating filters and selection

- Rating-based filtering and **Select by** now provide explicit **≤** and
  **≥** controls for choosing “up to” or “and up” behavior.
- Star highlights now match the actual criterion: **≤ 4** highlights stars
  one through four, while **≥ 4** highlights stars four and five.
- Changing the comparison direction immediately updates the visible images or
  the current rating-based selection.

## 1.5.7-fix-filter-cleanup — 2026-08-21

### Unified Library filtering

- The top **View Options** menu now contains only display, sorting, metadata,
  and grouping controls; all image-filter criteria live in the bottom toolbar.
- The expanded bottom **Quick Filter** now includes unrated and rating filters,
  RAW/non-RAW file types, edited/original status, color labels, and flags.
- **Clear all filters** is now available directly in the expanded Quick Filter,
  and the collapsed filter icon clearly indicates when any filter is active.

## 1.5.6-feature-selection — 2026-08-21

### Immediate Clear Selection

- **Clear selection** now updates the Library selection store directly and
  atomically, so thumbnail highlights disappear immediately without closing
  the expanded selection toolbar.
- Develop retains its existing current-image selection behavior.

## 1.5.5-feature-selection — 2026-08-21

### Cumulative rating highlight

- Selecting a rating threshold now fills every star through that threshold, so
  **3 & up** visibly activates stars one through three while retaining the
  existing toggle behavior.

## 1.5.4-feature-selection — 2026-08-21

### Toggleable selection criteria

- The active **Select by** criterion now has a clear visual highlight across
  rating, file type, edit status, color-label, and flag controls.
- Clicking the active criterion again deactivates it and clears its selected
  images; Clear Selection also removes the active state.
- Manually changing the resulting image selection removes a stale criterion
  highlight, and the inline selection bar remains open while criteria change.

## 1.5.3-feature-selection — 2026-08-21

### Rating-based selection fix

- Rating controls in the Library **Select by** bar now receive the loaded
  folder's rating data, show their correct match counts, and can select rated
  images.

## 1.5.2-feature-selection — 2026-08-21

### Clearer selection icon

- Replaced the generic pointer on **Select by** with a checklist icon that more
  clearly communicates selecting images by matching properties.

## 1.5.1-feature-selection — 2026-08-21

### Selection toolbar refinement

- **Select by** now expands inline using the same interaction, animation,
  spacing, grouped controls, and visual language as **Quick Filter**.
- Added **Clear selection** directly inside the expanded selection controls.
- Match counts remain available in each option's tooltip, while the compact
  selection icon retains its active-selection indicator.

## 1.5.0-feature-selection — 2026-08-21

### Select by image properties

- Added a compact expandable **Select by** control to the shared Library and
  Develop bottom toolbar.
- Images can be selected by every existing filter property—rating, file type,
  edit status, color label, or flag—without changing the active filters or
  hiding other images.
- Each choice shows its match count, unavailable choices are disabled, and the
  control gains a distinct accent treatment whenever an image selection is
  active.
- **Select by** can be shown or hidden through the existing toolbar
  customization menu.

## 1.4.4-develop — 2026-08-20

### Active-folder thumbnail priority

- Cached thumbnails display immediately when a folder is selected, while only
  missing visible thumbnails are generated and stored.
- Selecting another folder now discards queued work from the previous folder
  and gives the new active folder immediate priority.
- Full-folder thumbnail generation runs only after an explicit **Refresh
  folders** action, uses a dedicated low-priority worker, and follows the
  current direct or recursive Library mode.
- Missing thumbnail files referenced by the Library catalog are detected and
  regenerated instead of leaving permanent placeholders.

## 1.4.3-fix-thumbs-refresh — 2026-08-20

### Thumbnails match Develop edits

- All adjusted thumbnails now use the same GPU adjustment pipeline as Develop,
  including Lightroom imports, normal editing, presets, resets, and automatic
  adjustments.
- The app no longer publishes an unprocessed fallback when an adjusted
  thumbnail cannot be rendered accurately.
- Thumbnails created by the previous incomplete renderer are invalidated once
  and regenerated progressively as they become visible.

## 1.4.2-fix-thumbs-refresh — 2026-08-20

### Immediate folder navigation on launch

- Previously scanned folder trees now restore immediately from the Library
  catalog while filesystem counts and stale folders refresh in the background.
- A usable root tree appears even before the first catalog snapshot exists,
  and temporarily unavailable folders retain their last known navigation tree.
- Catalog thumbnail restoration now queries only the active folder's images,
  improving startup efficiency for large libraries.

## 1.4.1-fix-thumbs-refresh — 2026-08-20

### Accurate thumbnails after Lightroom edits

- Applying reviewed Lightroom Classic edits now regenerates every affected
  grid thumbnail from the updated ThisIsRAW adjustments.
- Thumbnail regeneration uses the existing cache and update events, refreshes
  only images whose edits were actually applied, and runs off the UI thread so
  Library navigation remains responsive.

## 1.4.0-feature-migrate-lrc — 2026-08-17

### Lightroom Classic edit translation trial

- Added **Preview Lightroom Edits** for selected physical images with matching
  XMP sidecars.
- Review proposed Lightroom-to-ThisIsRAW mappings, previous and proposed
  values, confidence levels, and unsupported settings before applying them.
- Previewing never changes `.tirdata` or Lightroom XMP files. Applying requires
  explicit per-image approval and merges only supported fields while preserving
  masks and other ThisIsRAW-only editing data.
- Added change detection that requires another review if the Lightroom XMP or
  ThisIsRAW sidecar changes after preview.
- The initial translator supports global tone, presence, HSL, sharpening and
  noise reduction, color calibration, point curves, monochrome, grain, and
  post-crop vignette settings.

## 1.3.1-feature-rename-sidecar — 2026-08-17

### ThisIsRAW sidecar format

- ThisIsRAW stores edits, metadata, and virtual copies in proprietary
  `.tirdata` sidecars, keeping its working data separate from RapidRAW.
- Added an explicit, non-destructive Settings action to import compatible
  RapidRAW `.rrdata` sidecars without overwriting `.tirdata` or changing the
  original RapidRAW files.
- File operations, folder scanning, tag management, and sidecar cleanup
  consistently handle `.tirdata` while preserving editing and XMP features.

## 1.2.21-fix-gui-density — 2026-08-14

### Reliable macOS installation

- Fixed the Apple Silicon package so ONNX Runtime is loaded only from inside
  ThisIsRAW instead of a Homebrew path from the build machine.
- Added package validation that rejects missing ONNX Runtime libraries and
  non-portable Mach-O dependencies before macOS artifacts are accepted.
- Fixed macOS CI packaging when Apple signing secrets are absent or incomplete;
  ordinary builds skip signing, while releases require complete credentials.
- Fixed post-build verification to inspect the application inside Tauri's DMG
  instead of a temporary app staging directory removed during packaging.

### Clearer editor toolbar grouping

- Added subtle spacing around the right editor toolbar separators so related
  tool groups are easier to distinguish while retaining the compact layout.

## 1.2.20-fix-gui-density — 2026-08-14

### More compact side panels

- Reduced desktop spacing throughout the folder browser and editor side panels
  so more controls and folders remain visible without scrolling.
- Refined default sidebar widths, section spacing, corner radii, and the editor
  tool switcher for a denser Lightroom Classic-style layout.
- Preserved comfortable touch layouts, resizable panel widths, control
  readability, and all existing editing features.

## 1.2.19-fix-responsiveness — 2026-08-14

### Responsive live histogram and waveform

- Histogram and waveform feedback now refreshes periodically while Develop
  sliders are dragged instead of waiting exclusively for release.
- Analytics refresh automatically slows when preview rendering is expensive,
  avoids building an analytics backlog, and keeps the visible image preview as
  the priority.
- Releasing a slider still triggers the exact full-quality preview, histogram,
  and waveform result.

## 1.2.18-fix-responsiveness — 2026-08-14

### Faster Develop slider response

- Coalesced rapid slider movements to the display refresh cycle while always
  applying the exact final value when dragging ends.
- Changed preview scheduling to keep only the newest pending adjustment instead
  of queuing obsolete intermediate frames behind the visible result.
- Improved the default interactive preview path with a temporary resolution
  reduction and deferred histogram/waveform analysis during active dragging;
  the full-quality preview and analytics still refresh immediately afterward.
- Removed the additional post-adjustment delay before the final Develop preview
  is requested.

## 1.2.17-fix-lint-error — 2026-08-11

### CI lint reliability

- Fixed all Rust diagnostics reported by the strict all-targets, all-features
  Clippy workflow with warnings treated as errors.
- Kept the thumbnail concurrency test at the end of its module and simplified
  equivalent migration and background-indexing control flow without changing
  runtime behavior.

## 1.2.16-fix-app-optimization — 2026-08-11

### Non-blocking thumbnail validation during folder scans

- Removed the renderer-wide thumbnail-cache invalidation introduced in 1.2.15,
  which could turn stale-folder validation into a large concurrent thumbnail
  rebuild while background scanning was already active.
- Existing catalog thumbnails remain immediately available and visible items
  are checked using their established source-and-sidecar cache identity, so
  unchanged thumbnails remain inexpensive cache hits.
- Develop thumbnail autosaves remain coalesced and latest-only, preserving the
  stale-thumbnail correction without allowing obsolete jobs to overwrite the
  newest edit.

## 1.2.15-fix-app-optimization — 2026-08-11

### Accurate, responsive Library thumbnails

- Catalog thumbnails still appear immediately, then visible Grid and Culling
  items are validated against the current image and sidecar adjustments in the
  background.
- A versioned thumbnail-cache identity replaces thumbnails produced by older
  rendering code without invalidating or eagerly rebuilding an entire large
  library.
- Develop autosaves now coalesce thumbnail work per image, skip superseded
  renders, and prevent an older render from replacing the newest thumbnail.
- The changes reduce redundant processing while preserving edits, sidecars,
  catalog persistence, and responsive navigation on Ubuntu, macOS ARM, and
  Windows x64.

## 1.2.14-fix-app-optimization — 2026-08-10

### Lens correction in the Develop sidebar

- Lens correction now has its own Develop-sidebar icon instead of opening a
  modal from Geometry.
- Auto detection, manual profile selection, correction toggles, amounts, and
  reset controls now update the full Develop image directly.
- Lens-correction settings, including Auto mode, are saved in Tool and Style
  presets independently of the optional crop/transform preset setting.
- The sidebar implementation retains Lensfun profile detection and works with
  the existing cross-platform image-processing and sidecar pipeline on Ubuntu,
  macOS ARM, and Windows x64.

## 1.2.13-fix-app-optimization — 2026-08-10

### Background preset application for images and folders

- Presets can now be applied to selected images from the Productivity context
  menu or the new customizable bottom-toolbar button.
- Multiple folders can be selected with Ctrl on Ubuntu/Windows or Command on
  macOS, with separate direct-folder and include-subfolders scopes.
- A shared searchable preset selector preserves unrelated adjustments and
  applies the preset to `.rrdata` and optional XMP metadata.
- Folder discovery and preset application run in a cancellable, deduplicated,
  single-worker background job that progressively refreshes thumbnails without
  blocking navigation or saturating the machine.
- Physical images and virtual copies are supported, while filters never cause
  images in a selected folder to be skipped.

## 1.2.12-fix-app-optimization — 2026-08-10

### Application identity migration

- Changed the application identifier to `io.github.ColrBent.ThisIsRAW` across
  desktop, mobile, and Flatpak packaging.
- Existing settings, catalogs, and application data migrate automatically and
  non-destructively from the previous identifier on Ubuntu, macOS, and Windows.
- Large thumbnail caches migrate in a retry-safe background task so the first
  launch under the new identity remains responsive and existing cached paths
  stay usable until migration completes.
- Custom catalog locations beneath an application-managed directory and stored
  thumbnail paths are rebased only after their files are safely copied. The
  previous application directories remain intact as a recovery copy.

## 1.2.11-fix-app-optimization — 2026-08-10

### Customizable library catalog location

- General Settings now shows the active catalog path and can safely move the
  existing catalog to a user-selected folder.
- The catalog can be moved back to the platform-default application-data
  location at any time.
- Catalog reads, background thumbnail writes, and moves are synchronized across
  Ubuntu, macOS, and Windows. A failed move preserves the original catalog and
  existing destination catalogs are never overwritten.

## 1.2.10-fix-app-optimization — 2026-08-09

### Immediate library restore with background revalidation

- Previously scanned folders and their generated thumbnails now restore from an
  embedded catalog immediately after launch and during navigation.
- Files, `.rrdata` sidecars, and XMP remain authoritative; the disposable
  catalog is refreshed only after successful filesystem scans.
- Folder-tree loading and filesystem revalidation no longer block restoration
  of the last visible folder.
- Thumbnail catalog writes are batched on a dedicated worker so large
  thumbnail runs do not add UI or filesystem pressure.
- Removed the redundant memory-only folder cache and eager startup image scan.
- The embedded SQLite library is bundled in the application and requires no
  database server on Ubuntu, macOS ARM64, or Windows x64.

## 1.2.9-fix-app-optimization — 2026-08-02

### Responsive navigation during very large background scans

- Previously scanned folders now reopen immediately from a bounded cache while
  their contents are safely revalidated in the background.
- Folder and album transitions retain the current usable view until the
  destination is ready, preventing false empty-folder messages and stale
  asynchronous results.
- Thumbnail references remain reusable across folder switches, while visible
  thumbnail work takes priority over optional AI indexing.
- Large direct and recursive folders defer persisted sidecar/XMP reconciliation
  to bounded background workers instead of saturating the machine.
- Large roots expose their initial folder tree first and refine optional image
  counts and empty-folder filtering in the background.
- Background indexing progress and completion are scoped to the job and folder
  that produced them, preventing unrelated folder refreshes.

## 1.2.8-fix-app-optimization — 2026-08-01

### Stable thumbnails during large scans

- Prevented an older delayed folder request from clearing the thumbnails and
  image list belonging to the folder currently visible during a large scan.
- Rapid folder switching remains responsive while stale loading completions no
  longer overwrite the current loading state or surface irrelevant errors.

## 1.2.7-feature-transform-add-auto — 2026-08-01

### Clearer Guided Transform completion

- Moved Apply and Cancel directly below Clear All Guides so the action required
  to retain a previewed Guided correction is immediately visible.

## 1.2.6-feature-transform-add-auto — 2026-08-01

### Transform reset placement

- Moved Reset into the Geometry mode-button grid so it is available beside the
  transformation choices.
- Reset clears every transform mode, guide, correction, offset, scale, aspect,
  and Constrain Crop setting while preserving separate lens corrections.

## 1.2.5-feature-transform-add-auto — 2026-08-01

### Guided Transform reset access

- Added the full Geometry reset button to the Guided Transform panel so every
  transform and lens correction can be reset while Guided editing is open.

## 1.2.4-feature-transform-add-auto — 2026-08-01

### Guided Transform active state

- The Guided button now remains highlighted whenever a completed Guided
  Transform is applied, including after persisted adjustments are restored.

## 1.2.3-feature-transform-add-auto — 2026-08-01

### Precise Guided Transform lines

- Replaced the heavy outlined Guided Transform markers with precise, thin blue
  guide lines and invisible endpoint drag targets.
- Drawing or adjusting a guide no longer triggers the Develop image click-zoom
  action.

## 1.2.2-feature-transform-add-auto — 2026-08-01

### Guided Transform on the Develop image

- Guided Transform lines are now drawn and adjusted directly on the full
  Develop image instead of inside a small preview popup.
- Guided controls remain available in the Geometry panel while the main image
  retains its normal zoom and pan workflow.
- Source/corrected preview, endpoint adjustment, guide removal, clearing,
  Apply, Cancel, Constrain Crop, and XMP synchronization are preserved.

## 1.2.0-feature-transform-add-auto — 2026-08-01

### Automatic perspective correction

- Added Auto geometry correction that jointly balances image rotation and
  converging vertical and horizontal structures.
- Auto correction uses the existing non-destructive transform and Constrain
  Crop pipeline, with its mode and resolved corrections synchronized through
  XMP for use on other ThisIsRAW installations.

## 1.1.9-fix-app-optimization — 2026-08-01

### Continuous library access during large-folder scans

- Previously loaded images and thumbnails now remain available while a newly
  added large folder is scanned in the background.
- The Library switches to the new folder only after its initial image list is
  ready, preserving responsive scanning without removing existing content.

## 1.1.8-fix-app-optimization — 2026-08-01

### macOS large-library compatibility

- Updated thumbnail disk readahead to use the native macOS mechanism while
  retaining the non-copying Linux implementation.
- Preserved the responsive background recursive scan and bounded filesystem
  reconciliation behavior across supported desktop platforms.

## 1.1.7-fix-app-optimization — 2026-08-01

### Responsive very large libraries

- Moved recursive folder discovery and reconciliation off the application event
  loop so opening very large libraries no longer blocks the rest of the
  interface.
- Large recursive libraries now reconcile files on a bounded background thread
  instead of saturating every CPU core, improving responsiveness on macOS and
  other platforms without skipping images or metadata.
- Thumbnail generation preserves visible-image request priority and no longer
  copies complete source files into temporary memory merely to trigger disk
  readahead.

## 1.1.6-fix-app-optimization — 2026-08-01

### Faster, more responsive large libraries

- Large recursive libraries no longer schedule unnecessary sidecar work for
  images that have no existing RapidRAW or XMP metadata.
- Thumbnail, sidecar, and EXIF results are applied in larger background batches
  so scrolling and other interface interactions remain responsive while
  metadata is discovered.
- Background EXIF extraction now yields to active interface work without
  removing metadata, search, sorting, or filtering capabilities.
- Reduced repeated filesystem checks while loading recursive libraries.

### Updated application icon

- Replaced the application icon across desktop and mobile packages with the
  latest ThisIsRAW artwork.

## 1.1.6-fix-ciisue — 2026-07-31

### Updated application identity

- Replaced the application icon across desktop and mobile packages with the
  new ThisIsRAW artwork.

## 1.1.5-fix-ciisue — 2026-07-31

### Reliable release packaging

- Release builds now retain their source-branch context throughout packaging,
  allowing detached release-tag checkouts to produce and upload application
  bundles correctly.

## 1.1.3-fix-ci — 2026-07-31

### CI compatibility

- Updated Rust formatting and resolved Rust 1.96 Clippy checks so builds pass
  the enforced CI quality gates.

## 1.1.2-feature-transform — 2026-07-31

### Refined Guided Transform controls

- Reduced the visual weight of Guided Transform lines for a clearer view of
  image details while positioning guides.

## 1.1.1-feature-transform — 2026-07-31

### Guided perspective correction

- Added Guided Transform with separate two-line vertical and horizontal pairs.
- Completed guide pairs correct parallelism; using both pairs also corrects the
  relationship between horizontal and vertical structures.
- Guided lines can be adjusted, removed, previewed, and used with Constrain
  Crop.
- Guided lines and their resolved perspective correction synchronize through
  XMP for use on other ThisIsRAW installations.

## 1.1.0-feature-transform — 2026-07-31

### Guided perspective correction

- Added Guided Transform with separate two-line vertical and horizontal pairs.
- Completed guide pairs correct parallelism; using both pairs also corrects the
  relationship between horizontal and vertical structures.
- Guided lines can be adjusted, removed, previewed, and used with Constrain
  Crop.
- Guided lines and their resolved perspective correction synchronize through
  XMP for use on other ThisIsRAW installations.

## 1.0.9-fix-transform — 2026-07-31

### More reliable automatic geometry

- Improved Level and Vertical detection for shorter and lower-contrast lines.
- Improved Vertical correction stability for parallel and subtly converging
  architectural structures.

## 1.0.7-feature-mask-enhancements — 2026-07-31

### Mask overlay and Gaussian Blur

- Added a configurable `O` shortcut and Masking-panel visibility button for
  hiding the colored mask overlay without disabling the mask or its edits.
- Added Gaussian Blur to local-mask Effects with a controllable Amount.
- Gaussian Blur settings persist with mask edits and synchronize through XMP.

## 1.0.6-feature-mask-enhancements — 2026-07-31

### Mask layers and blend modes

- Added per-mask blend modes: Normal; Darken, Multiply, Color Burn, and Linear
  Burn; Lighten, Screen, Color Dodge, and Linear Dodge; Overlay, Soft Light,
  and Hard Light; Vivid Light, Linear Light, Pin Light, and Hard Mix; and Hue,
  Saturation, Color, and Luminosity.
- Existing mask drag ordering now controls the order used for blend-mode
  compositing.
- Added a versioned ThisIsRAW XMP adjustment payload so mask ordering, blend
  modes, and the complete editable adjustment state can move between
  installations.

## 1.0.3-develop — 2026-07-30

### Branch-qualified build versions

- Development builds now append their active branch name to the application
  version and package filename.
- Builds from `main` retain the plain semantic version without a branch suffix.
- Local, pull-request, continuous-integration, and release workflows use the
  same automatic branch-versioning rule.

## 1.0.2 — 2026-07-30

### Editor toolbar customization

- Fixed the Customize Toolbar panel being clipped behind the image editor in
  Develop mode.
- The customization panel now remains fully visible above the editor while
  retaining the established filmstrip and fullscreen behavior.

## 1.0.1 — 2026-07-30

### Product name normalization

- Standardized the application, package, executable, workflow artifacts, and
  release branding as **ThisIsRAW**.
- Updated exported metadata and application-facing descriptions to use the
  same product name consistently.

## 1.0.0 — 2026-07-30

### Workflow and panel organization

- Split Crop and Geometry into separate right-toolbar modules. Geometry now
  contains Manual Transform, Lens, Level, Vertical, and Constrain Crop.
- Made all mask creation options directly visible without an **Others** submenu.
- Added customizable color-label controls to the shared bottom toolbar.
- Added a dedicated Tagging panel for adding or removing tags from one or
  multiple selected images.
- Added a persistent **Hide Empty Folders** setting for simplifying the folder
  tree while retaining library and pinned roots.

## 1.6.1-colrbent.61 — 2026-07-30

### Automatic geometry persistence

- Level and Vertical buttons now remain visibly highlighted while their
  automatic correction mode is active.
- Automatic geometry mode, rotation, vertical correction, and Constrain Crop
  are now synchronized through XMP for use by other ThisIsRAW installations.
- Applying Manual Transform clears the automatic-mode highlight while
  preserving the manually selected geometry values.

## 1.6.1-colrbent.60 — 2026-07-30

### Automatic geometry correction

- Added **Level** correction for automatically straightening prominent
  horizontal or vertical lines.
- Added **Vertical** correction for automatically straightening converging
  architectural lines.
- Added a persistent **Constrain Crop** option that automatically zooms enough
  to prevent empty edges after geometry corrections.
- Renamed **Transform** to **Manual Transform** to distinguish the existing
  editable controls from the new automatic modes.

## 1.6.1-colrbent.59 — 2026-07-30

### Automatic geometry correction

- Added **Level** correction for automatically straightening prominent
  horizontal or vertical lines.
- Added **Vertical** correction for automatically straightening converging
  architectural lines.
- Added a persistent **Constrain Crop** option that automatically zooms enough
  to prevent empty edges after geometry corrections.
- Renamed **Transform** to **Manual Transform** to distinguish the existing
  editable controls from the new automatic modes.

## 1.6.1-colrbent.58 — 2026-07-30

### Stronger vignetting

- Increased vignette strength by approximately 30% for both dark and bright
  vignettes.
- Global and masked vignettes share the stronger response while remaining
  safely bounded at black and white.

## 1.6.1-colrbent.57 — 2026-07-30

### Launch screen subtitle

- Added **A Modern RAW Workflow for Photographers** between the application
  name and **Built on RapidRAW** tagline.

## 1.6.1-colrbent.55 — 2026-07-30

### Launch screen branding

- Removed the inherited RapidRAW marketing description from the launch screen.
- The launch screen now presents **ThisIsRAW**, **Built on RapidRAW**, and
  the concise folder or library instruction.

## 1.6.1-colrbent.54 — 2026-07-30

### ThisIsRAW

- The application is now named **ThisIsRAW**.
- Product presentation now carries the tagline **Built on RapidRAW** and
  identifies ColrBent as its builder.
- Application windows, launch screen, packages, executables, workflows,
  release artifacts, desktop metadata, export metadata, XMP metadata, Android
  labels, documentation, and issue templates now use the new identity.

## 1.6.1-colrbent.53 — 2026-07-30

### Masked Light Flares

- Fixed Light Flares applied through a mask not appearing unless the global
  Light Flares adjustment was also enabled.

## 1.6.1-colrbent.52 — 2026-07-30

### Expanded local mask adjustments

- Masks now support localized Black & White conversion and Color Calibration.
- Light Flares, Vignette, and Grain controls are now available within mask
  adjustments.
- Mask opacity and feathering blend the new effects consistently in previews
  and full-resolution exports.

## 1.6.1-colrbent.51 — 2026-07-29

### Faster first thumbnails in large folders

- Visible thumbnails now receive a head start when opening large folders that
  have not been accessed previously.
- Background EXIF extraction is delayed briefly and processed in bounded
  batches, preventing a cold folder-wide scan from competing with the first
  thumbnails.
- Obsolete EXIF work stops automatically when another folder is selected.

## 1.6.1-colrbent.50 — 2026-07-29

### Large recursive folder responsiveness

- Large recursive folders now display their image list and begin loading
  thumbnails without waiting for every metadata sidecar to be processed.
- Ratings, flags, stack information, and edit status are loaded in the
  background and applied to the Library in efficient batches.

## 1.6.1-colrbent.49 — 2026-07-29

### Recursive folder XMP import

- **Read XMP from Folder** now imports matching sidecars from the selected
  folder and all of its subfolders.
- Both `image.xmp` and `image.ext.xmp` sidecar naming conventions are
  recognized.

## 1.6.1-colrbent.48 — 2026-07-29

### XMP folder import count fix

- **Read XMP from Folder** now reports the imported-image count directly,
  preventing successful folder imports from being displayed as zero.

## 1.6.1-colrbent.47 — 2026-07-29

### Delete Rejected availability fix

- **Delete Rejected Files** now uses the same loaded flag state as thumbnail
  badges and filtering, so it becomes available whenever the current folder
  view contains rejected images.
- Newly applied Rejected flags update against the latest Library state,
  preventing asynchronous metadata work from applying the change to a stale
  image list.

## 1.6.1-colrbent.43 — 2026-07-28

### Thumbnail file-type badges

- Library thumbnail metadata now includes a compact neutral badge identifying
  the image as `RAW`, `JPG`, `TIF`, `PNG`, or its corresponding file type.
- File-type badges follow the existing Metadata Off/Hover/Always setting and
  remain hidden when thumbnail metadata is disabled.

## 1.6.1-colrbent.41 — 2026-07-28

### Release asset naming

- macOS build artifacts and GitHub Release assets now use `macos` in their
  filenames instead of the underlying `darwin` platform identifier.
- Windows and Linux assets retain stable explicit platform labels.

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

- Physical-image flags now synchronize through application-specific XMP metadata
  and are restored by another ThisIsRAW installation.
- Physical stacks now store a shared stack identifier, member order, cover
  status and collapsed state in each member's XMP sidecar.
- Existing stacks are backfilled when settings load, and stacks discovered in
  XMP are reconstructed using the paths available on the current machine.
- Virtual copies continue using their independent ThisIsRAW sidecars because
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
  ThisIsRAW modifications beside the current application version.
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
  ThisIsRAW fork.
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
  rest of ThisIsRAW.
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
- Software is rewritten as `ThisIsRAW`.
- Structural TIFF fields, embedded previews, MakerNote, and other
  source-layout-dependent metadata are not copied.
- Metadata is merged into the newly encoded TIFF's own structural directories.
  ThisIsRAW then fully decodes the result; if metadata writing or validation
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
