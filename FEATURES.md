# ThisIsRAW Features

This is the concise, current inventory of features added to ThisIsRAW. It
describes the application as it exists now; release history and validation
details are in `RELEASE_NOTES.MD`.

## Library and workflow

- **Panel Density** (Settings → General): **Compact**, the default, tightens
  the left and right panels and the Library and Develop top bars to a
  Lightroom Classic-like density, with one-row sliders, flat section bars, and
  smaller headers; **Comfortable** keeps the original roomier layout. The
  bottom bar and filmstrip are the same in both.
- Drag selected Library images onto a folder to move their image and ThisIsRAW
  sidecar files. Drag a folder onto another folder to move its complete tree;
  hold Command on macOS or Ctrl on Windows/Linux to copy a folder tree instead.
  Transfers prevent same-parent, self/descendant, and name-collision drops.
- Lightroom-style **Lights Out** in Library and Develop: **L** cycles Normal →
  Lights Dim → Lights Out (**Shift+L** backward, both configurable; Escape
  restores Normal first). One fading layer darkens everything except the
  photo without changing the layout, and covers the rest of every screen,
  including the menu bar, Dock, and notification banners on macOS (not on Wayland, where only the app
  window darkens). Lights Out turns off when the window loses focus, for
  example when switching apps. In Develop only the photo being edited
  stays lit, and a newly opened photo appears only once its final render is
  ready; in the Library Grid or List every thumbnail stays lit unless two
  or more photos are selected, in which case only those do; in Culling the
  compared photos stay lit. Dim keeps the interface usable; Lights Out blocks
  clicks outside the photo. Settings → General sets the **Lights Dim level**
  (50/70/80/90 %), the **Lights Out screen color** (black, three greys, white),
  and an optional **Lights Out border** around the photo in Develop (1–128 px, same
  colors; Fit zoom leaves room for it).
- Develop keeps the current photo on screen while the next one renders and
  then switches with a short fade, so stepping never shows a blank stage or an
  unedited preview (GPU renderer).
- Customizable bottom toolbar shared by Library and Develop, with Productivity,
  Copy, Stacking, Flags, and direct color-label controls.
- Lightroom-style **Metadata** panel next to the Library grid: file
  information, camera details, editable author and copyright, rating and
  labels, GPS map, and the full EXIF of the active photo.
- Labelled **Info**, **Tagging**, **Export**, and **Develop** switches at the
  top right of the top bar, always shown in Library and Develop, with the
  open panel highlighted. Library: one right panel at a time; Develop opens
  the active photo. Develop: Info, Tagging, and Export show that panel for
  the edited photo only, and Develop returns to the last editing tool; the
  vertical tool strip keeps only the editing tools. The top bar also stays in
  fullscreen and with native window decorations (without its window
  buttons).
- **Quick Filter** and **Select by** sit in the title bar, left-aligned with
  the bottom toolbar's controls in the main pane below, in Library and Develop. Both stay fully expanded while
  the window is wide enough and collapse to click-to-open icons only when it
  is too narrow; only on Android, which has no top bar, they remain in the
  bottom toolbar. Select by replaces the current selection
  using any rating, DNG/other-RAW/non-RAW, edit-status, color-label, or flag criterion
  without changing active filters. It follows the Quick Filter inline design,
  exposes match counts in tooltips, and provides an in-place clear-selection
  action. The chosen criterion remains visibly active and acts as a toggle;
  clicking it again clears its selection, while manual selection changes remove
  stale criterion highlighting. Its active dot and accent frame indicate only
  selections created through Select by, not ordinary thumbnail selections.
  **Deselect All** is configurable in Keyboard Shortcuts and defaults to
  Command+D on macOS or Ctrl+D on Windows and Linux.
- Manual image stacks with collapse/expand, visible stack cues, drag ordering,
  move-to-top covers, and matching Develop-filmstrip presentation. Stacking a
  selection adds it to, or merges, the stacks it touches (Lightroom's Group
  into Stack); configurable Command/Ctrl+G and Shift+S shortcuts stack the
  selection and move the active photo to the top of its stack. When filters
  or search hide a collapsed stack's cover, its first matching member
  represents the stack.
- Lightroom-style **Auto-Stack by Capture Time** for the selection or the
  current view, with a 5-second to 1-hour gap and a preview of the resulting
  stacks; photos already in a stack are left unchanged.
- Automatic stacking of physical copies, virtual copies, and exported images,
  with optional automatic expansion.
- Configurable external-editor round trip, like Lightroom's Edit In: add
  Photoshop, Pixelmator Pro, or any desktop editor executable in General
  Settings (an installed Photo Craft is found and offered automatically),
  choose TIFF, JPEG, or ask-each-time per editor, then right-click one image
  in the Library or the image being edited in Develop (**Open in**) to open a
  16-bit TIFF or JPEG copy in that editor. The copy appears beside the original as `<name>-Edit` only
  once it is saved in the editor, later saves update it in place, several
  edits can run at once, and saves made while ThisIsRAW was closed are
  picked up on the next launch. Unsaved working copies are removed after 7
  days or from Settings → Data Management. **Open in → Original File**
  opens a non-RAW file itself and refreshes its thumbnail when it is saved.
- Rejected, Selected, Deferred, and Unflagged states with keyboard shortcuts,
  thumbnail badges, rejected-image dimming, filtering, and rejected-file
  deletion for the currently loaded folder view.
- Unified **Quick Filter** controls for unrated and rating thresholds,
  RAW/non-RAW files, edited/original status, color labels, and flags, with an
  in-place clear-all action and a persistent active-filter indicator. Rating
  filters and rating-based selection provide explicit **up to (≤)** and **and
  up (≥)** comparisons, with star highlights matching the selected range. The
  top **View Options** menu remains focused on display, sorting, metadata, and
  grouping controls, while the Library header retains its compact active-filter
  summary.
- Compact neutral file-type badges in Library grid and list metadata, using a
  shared `RAW` label for camera formats and normalized labels such as `JPG` and
  `TIF` for rendered files. Grid metadata also shows the image pixel
  resolution and megapixel count from EXIF, with a metadata-only RAW-decoder
  fallback for camera formats that omit EXIF pixel-dimension tags.
- Configurable shortcuts for Library Grid and flag actions.
- Library back/forward history across folders and albums, grid-row Up/Down
  navigation, Copy Image Path (Command/Ctrl+L), and copying adjustments with
  several images selected.
- Rating filters and Select by offer ≤, =, and ≥ comparisons; the Quick
  Filter's open state and every filter choice persist between launches, and
  filters apply before RAW+JPEG grouping.
- The selection advances when a rating, flag, label, or tag change hides the
  active image under the current filter.
- `{original_filename_number}` naming token for rename, import, and export,
  with a warning when a multi-file template is not unique.
- Caps Lock auto-advance after applying ratings, color labels, or flags.
- Main Settings access from both Library and Develop.
- Optional launch directly into the last library, bypassing the splash screen.
- Proprietary `.tirdata` sidecars keep ThisIsRAW edits, metadata, and virtual
  copies separate from RapidRAW. Settings provides an explicit non-destructive
  importer for compatible `.rrdata` files that never overwrites existing
  `.tirdata` data or alters the RapidRAW originals.
- **Import Lightroom Edits**: non-destructive Lightroom Classic XMP
  translation preview for selected physical images. RAW photos are switched
  to the Natural tone mapper (Lightroom's settings are made on top of Adobe
  Standard), shown as its own reviewed change, and Lightroom Exposure is
  converted to the same number of stops. Each image's detailed proposed mappings and confidence are
  available from a collapsed review disclosure,
  leaves `.tirdata` and Lightroom XMP untouched until explicit approval, then
  merges only approved supported fields while preserving ThisIsRAW-only edits.
  Successfully changed images regenerate their grid thumbnails from the new
  adjustments without reloading or blocking the complete Library. Available
  from the Library and Develop thumbnail menus and the Develop image menu; the
  review warns, per image, per change, and for the approved selection, when a
  change would replace an existing ThisIsRAW edit.
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
  previously loaded EXIF remains visible from a bounded in-memory folder cache
  while that folder is revalidated in the background.
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

- **Natural** tone mapper (Basic → Tone Mapper, next to Basic and AgX), the
  default for RAW photos without edits: a Lightroom Classic Adobe
  Standard-like rendering for every camera, with open shadows and highlights
  that roll off into white instead of clipping early, keeping hue. It adds
  back the exposure a RAW file asks for (DNG baseline exposure and the
  camera's highlight-protection modes, such as Fujifilm DR200/DR400, Canon
  Highlight Tone Priority, Nikon Active D-Lighting, and OM/Olympus
  gradation). Non-RAW images render as in Basic. Existing edits keep their
  tone mapper; Reset returns a RAW to Natural. Also available in the Global
  Tonemapper Override.
- Lightroom-style **Auto Sync**: with several images selected, each edit made
  in Develop is applied to every selected image. Only the changed control is
  synced (one Color Mixer channel, for example), and the Copy & Paste Settings
  checkboxes choose which sections sync. Its switch and sync status are always
  visible at the bottom of the Develop sidebar; Command/Ctrl+Option/Alt+Shift+A
  also toggles it.
- Crop now opens in unrestricted **Free** aspect ratio for new images; the
  source ratio remains available as an explicit preset. Custom aspect ratios
  can be saved as presets. In Crop, Enter or a double-click inside the crop
  frame keeps the crop and Escape restores the crop, ratio, rotation, and
  flips from when Crop was opened (undoable).
- **Speed Edit**: hold W (or tap it to keep it on) and drag anywhere on the
  photo to change the last-used slider; Shift drags finely and a double-click
  resets. A and D switch between the sliders chosen in Settings → Controls,
  the arrow keys nudge, R resets, C and V copy and paste a value, and Q and E
  change photos. A small display at the pointer shows the slider and value.
- Readable **edit history** (right-click Undo/Redo): each step is named when
  it is made, with the changed controls and their values, mask, HSL, curve,
  and crop details; presets, Paste, Reset, and Auto Adjust are separate,
  named steps.
- Optional neutral grey editor canvas and click-to-100% zoom.
- Single-row photo information bar in Develop (file name, resolution, and
  capture details); clicking it hides or shows the capture details, and the
  choice persists. Its fine rotation can
  be adjusted either precisely with the existing slider or directly by dragging
  the rotation handle inside the top of the crop frame.
- Dedicated **Crop** and **Geometry** modules separate composition from
  perspective work. Geometry includes full **Auto** correction that jointly
  balances rotation and both perspective axes (and remains useful for a
  level-only scene), focused horizon-straightening **Level** correction,
  **Vertical** keystone correction, **Guided Perspective**, editable **Manual Transform**
  controls, and a persistent **Constrain Crop** option. Auto straightens
  verticals first, adds a horizontal keystone only when it keeps them
  straight, and picks a balanced strength that limits uneven stretch and
  lost frame; Vertical corrects fully. After either, an **Auto Strength**
  slider scales the perspective correction while leveling stays complete.
  Automatic modes
  measure sub-pixel line segments in the lens-corrected image, keep only
  lines that share a vanishing point beyond the frame (so receding streets
  and tabletops are ignored), and follow quarter-turn orientation.
  Guided Perspective (ported from upstream RapidRAW) draws up to two vertical
  and two horizontal guides directly on the uncropped, live-corrected image,
  with draggable endpoints and a guide list in the Geometry panel. Any two or
  more guides (1V+1H, 2V, 2H, 2V+1H, 2H+1V, 2V+2H) become exactly vertical and
  horizontal through an exact homography under the manual sliders. Leaving
  guide drawing crops to the largest rectangle without empty borders,
  honouring a fixed aspect ratio. Guides persist through presets, adjustment
  copying, and XMP. A clearly separated full-width Reset action below the
  transformation-mode buttons clears all transforms while retaining separate
  lens corrections. Active modes remain highlighted. Automatic modes
  synchronize their rotation, vertical, and horizontal correction values
  through XMP. Adaptive
  contrast and line-length analysis recognizes shorter, lower-contrast
  structures, while robust grouped-line perspective estimation handles both
  parallel and converging architectural edges.
- A dedicated **Lens Correction** sidebar module applies Auto detection or a
  manually selected Lensfun profile directly to the full Develop image, with
  independent distortion, chromatic-aberration, and vignetting controls. Lens
  settings, including Auto mode, persist in Tool and Style presets without
  requiring crop and transform data to be included.
- **Apply Lens Profile Automatically** (Settings → My Lenses, on by default)
  starts unedited RAW images in Auto lens correction with the profile detected
  from EXIF, in Develop, exports, and thumbnails. Images without a matching
  profile stay in Manual mode, edited images keep their own lens settings,
  Reset returns to Manual with no profile, and an automatic profile alone does
  not mark an image as edited.
- The Masking module presents every mask source directly, without an additional
  **Others** submenu.
- A dedicated **Tagging** module adds and removes tags across the current image
  or multi-image selection, with common and mixed tags clearly distinguished.
- Hierarchical keywords, as in Lightroom Classic: type `places > germany >
  berlin` to file a keyword under its parents. Searching any level finds the
  photo.
- Lightroom-style **Keyword Sets**: editable named sets of nine keywords,
  shown as a toggle grid in the Tagging panel and applied with configurable
  Option/Alt+1…9 shortcuts (Option/Alt+0 cycles sets, Caps Lock
  auto-advances). The active set also feeds the tagging context menu and the
  Metadata panel.
- Per-photo **Keyword Suggestions** of keywords often used together with the
  photo's own, plus a separate on-demand **AI Suggestions** part (CLIP) that
  prefers the user's own keyword paths, in the Tagging panel and the tagging
  context menu.
- Library-wide **Keyword List** in the Tagging panel (tree, counts, search,
  checkboxes that add or remove a keyword for the selection, a separate AI tag
  group); clicking a keyword shows every library photo with it or its child
  keywords. Library-wide rename, move, merge, and delete as a cancellable
  background job. The Tagging panel is available in the editor and next to
  the Library grid (stays open across restarts; drop photos on a keyword to
  tag them). Collapsible
  sections and a `keyword:` search query.
- Persisted **Black & White** switch in the global Color section.
- Named tone-curve presets with unique names, built-in Linear and contrast
  presets, modification indicators, update, save-as-new, and delete actions.
- Tone Curve channel buttons show a dot under each adjusted channel, and the
  Red, Green, and Blue graphs are tinted with the channel's colour above the
  diagonal and its complement (cyan, magenta, yellow) below, as in Lightroom
  Classic.
- AI sky masks use EfficientSAM3 and AI foreground masks use BiRefNet, as in
  upstream RapidRAW; AI subject masks are edge-refined. AI text masks select
  whatever a typed description names, such as "water" or "boat". Each mask
  type downloads its model on first use, and existing masks keep their stored
  result.
- **Motion Blur** in Effects (engine from RapidRAW): linear, zoom and spin
  blurs, plus smooth in masks, with Highlights (bright lights keep their
  energy in the streak) and the image's grain restored over blurred areas.
  In AI-subject masks the Motion setting separates subject and background
  (Auto, Moving Subject, Panning, Uniform) without halos. **Depth** uses an
  AI depth map so near objects streak more than distant ones. The linear
  direction is set with a compass dial (Shift snaps to 15°) or a typed angle
  from −90° to 90°.
- Local masks support Black & White conversion, Color Calibration, Light
  Flares, Gaussian Blur, Motion Blur, and Grain in addition to the existing
  tonal, color, detail, curve, glow, and halation adjustments. The mask
  editor offers no Vignette; a mask that already has one keeps its controls.
- Lightroom-style **clipping indicators** in the histogram's top corners:
  grey when nothing clips, white when every channel clips, and the clipped
  channels' colour otherwise; clicking one toggles the clipping warning.
- Effects has separate **Glow**, **Halation**, and **Light Flares** sections.
  Glow has a colour (Hue and Saturation) and Halation a Hue; mask glow and
  halation use the same colours.
- Mask overlays can be hidden without disabling the selected mask through a
  dedicated Masking-panel control or configurable `O` shortcut.
- Brush and Flow masks preview their adjustments live while painting, with
  smoothed strokes, a brush size of up to 1000, and Lightroom-style `[` / `]`
  size shortcuts (Rotate 90° uses Command/Ctrl+`[` / `]`).
- Mask containers can be drag-reordered and composited with Normal, darkening,
  lightening, contrast, and component blend modes. Mask order and blend mode
  persist with the complete editable state in XMP.
- Clear green enabled styling and dimmed neutral styling for shared toggle
  switches throughout the application.
- **Relight** in Effects adds point, spot, and directional lights to a photo
  using an AI-generated surface normal map, with ambient, softness, shine,
  optional cast shadows, and per-light color, temperature, tint, intensity,
  depth, falloff, angle, elevation, cone, and feather. Lights are placed,
  moved, aimed, and duplicated directly on the image. Light settings travel in
  XMP; the image-derived normal map stays local and can be regenerated on
  another device.
- **Fog** in Effects adds depth-aware atmospheric haze from an AI depth map,
  with amount, start, feather (a soft fade-in at the start distance), density,
  ground fog, variation, glow, temperature, and tint.
- Non-destructive **AI Denoise** in Details, with Amount and Detail. Each
  image is denoised once in the background, and the result is cached on disk
  (4 GB limit, clearable in Settings). Exports always include it, and
  thumbnails refresh when it finishes. Settings sync through XMP and
  copy/paste; the denoised result is regenerated per device.
- On macOS, AI Denoise and the depth maps for Fog, Lens Blur, and depth masks
  run on the GPU and Neural Engine through CoreML, with an
  automatic CPU fallback and a **GPU Acceleration** switch in Settings →
  Processing. AI models load only when first needed.
- Lens Blur, Relight, and Fog maps stay aligned through lens, transform, and
  Guided Perspective geometry changes. Their effects render at preview resolution in
  Develop for fast adjustment. Generated depth and normal maps stay local, and
  synced edits offer to regenerate them.
- An interactive **3D depth view** (from RapidRAW) in Lens Blur, Relight,
  Fog, Motion Blur depth, and AI depth masks shows the scene from its depth map with the effect
  applied (including TIR's Fog feather and Relight shine), and lets the
  focus range, fog start, depth-mask band, or selected light be dragged in
  depth; rotate, zoom, and pan the view. It only previews the settings.

## Files, export, and metadata

- A versioned ThisIsRAW XMP payload carries the complete editable adjustment
  document between installations, including ordered masks and blend modes.

- Optional, remembered filename suffixes for exports and separate suffixes for
  physical and virtual copies.
- Export directly beside each source image, optionally into a named
  subfolder.
- True 8-bit or 16-bit TIFF export, a DPI setting for JPEG, PNG, and TIFF, an
  embedded sRGB profile in JPEG and PNG, colored borders, and padding to an
  aspect ratio, all saved in export presets.
- Several preset files can be imported at once, and the LUT browser lists
  HALD image LUTs.
- Consolidated EXIF export controls with optional GPS removal.
- Complete readable EXIF preservation for JPEG and a safe allowlist for TIFF,
  with ThisIsRAW recorded as the exporting software.
- XMP synchronization for ratings, color labels, keywords, physical-image
  flags, and physical stack membership, order, cover, and collapsed state.
  Keywords are written and read in Lightroom Classic's format, including the
  keyword hierarchy; keywords from other applications become user keywords,
  and AI keywords stay distinguishable between ThisIsRAW installations.
  XMP that Lightroom Classic embeds in JPEG, TIFF, DNG, and PNG files is read
  too (never written): when a folder opens it is imported again only after
  the file changes, and it wins over an older sidecar. As in Lightroom
  Classic, the XMP belongs to the original photo only: virtual copies keep
  their rating, label, keywords, and flag in their own `.tirdata` and never
  read or write the XMP.
- Recursive **Read XMP from Folder** action that treats XMP as authoritative
  for matching images, recognizes basename and full-filename sidecars and
  embedded XMP, reports the imported-image count, and refreshes the currently
  open folder.
- Initial Lightroom Classic translation covers global tone, presence, HSL,
  sharpening/noise reduction, color calibration, point curves, monochrome
  (including black-and-white profiles such as Adobe Monochrome), grain, and
  post-crop vignette settings. Only the user's own settings are translated; a
  profile's built-in tone curve and settings are reported, not imported.
  Absolute Lightroom temperature and tint are translated approximately to
  ThisIsRAW's relative white-balance controls. The review identifies
  approximate mappings and warns about camera profiles, lens corrections,
  crop/geometry, masks, and retouching that cannot be reproduced safely.

## Application identity and data continuity

- Uses `io.github.ColrBent.ThisIsRAW` consistently across supported packaging.
- Automatically preserves settings, catalogs, and cached thumbnails from the
  previous application identifier without blocking the UI on large caches.
