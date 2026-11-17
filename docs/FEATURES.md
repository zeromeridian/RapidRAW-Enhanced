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
- A photo opened from Finder or Explorer fills the filmstrip with its own
  folder (never its subfolders) without adding it to the Library; editor
  round trips still show only their photo.
- The Metadata panel shows the camera (make and model, the make not
  repeated) above the lens.
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
  tool bar above the right sidebar keeps only the editing tools (Adjust,
  Crop, Lens & Geometry; Blend Pad, Zone Color Grading; Masks, Inpaint;
  Presets), with large icons sharing its
  width; clicking the highlighted tool keeps it open. The top bar also stays in
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
  with optional automatic expansion. An export's stack stays in ThisIsRAW
  (not in XMP), so nothing is written beside exported files.
- Only RAW files get a `.tirdata` just to cache EXIF; other images get one
  once they are edited, rated, tagged or stacked. Viewing a photo in
  Develop writes nothing until something changes.
- Configurable external-editor round trip, like Lightroom's Edit In: add
  Photoshop, Pixelmator Pro, or any desktop editor executable in General
  Settings (an installed Photo Craft is found and offered automatically),
  choose TIFF, JPEG, or ask-each-time per editor, then right-click one image
  in the Library or the image being edited in Develop (**Open in**) to open a
  16-bit TIFF or JPEG copy in that editor. The copy appears beside the original as `<name>-Edit` only
  once it is saved in the editor, later saves update it in place. However
  the editor saves (back into the copy, or Save As under another name or
  format) and whether it opens a window or a tab, each saved image gets
  its own copy beside the original under the name it was saved with. Several
  edits can run at once, and saves made while ThisIsRAW was closed are
  picked up on the next launch. A save into a subfolder of the editor's
  working folder counts too, and an editor that quits with an error right
  after starting is reported instead of being waited for. Unsaved working
  copies are removed after 7 days or from Settings → Data Management.
  **Open in → Original File** opens a non-RAW file itself and refreshes its
  thumbnail when it is saved.
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
- File-name templates for rename, import, and export with the syntax
  `{token:format|filter?fallback}`: the original tokens
  (`{original_filename}`, `{original_filename_number}`, `{sequence}`,
  `{YYYY}`…`{ss}`), `{YY}`, `{filename}` (current name; the
  `{original_filename}` tokens use the name from before the first rename,
  kept in the sidecar and XMP `xmpMM:PreservedFileName`), dates (`{date:…}`/`{capture:…}`, `{filedate:…}`,
  `{today:…}`), `{seq:width:start=N}`, EXIF (`{camera}`, `{lens}`,
  `{iso}`, `{focal}`, `{aperture}`, `{shutter}`), library (`{rating}`,
  `{label}`) and three Custom Texts `{text}`, `{text2}`, `{text3}`;
  filters `upper`, `lower`, `slug`, `trim:N`.
  Names use the capture time as the camera recorded it and are cleaned
  for every file system. A warning shows when a multi-file template is not
  unique.
- Safe rename: all or nothing with rollback, a case-insensitive clash
  check across the whole batch (including leftover sidecars), case-only
  renames and name chains; `.tirdata`, virtual-copy sidecars and both XMP
  naming styles move with the photo. A RAW+JPEG partner left behind keeps
  the shared stem XMP and the renamed file gets a copy. Albums, keyword
  index, thumbnails and external-edit sessions follow the new name.
- Lightroom-style Rename dialog for one or many photos: grouped token
  chips, live preview of the first and last name, inline template errors,
  clash and missing-value warnings (Rename disabled on clashes), a Custom
  Text field per `{text}`/`{text2}`/`{text3}` used (kept with a saved
  template, else the last texts used), and
  sequence numbers in grid order. Saved filename templates
  (save, update, rename, delete, export, import; six starters), stored
  once in the settings for rename, export and import.
- Export and Import use the same template editor (saved templates,
  chips, inline errors, Custom Text, example name); the default export
  name is `{filename}_edited`; a photo imported under a new name
  remembers its camera name.
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

- **Adjustments sections in workflow order**: Light (Black & White, tone
  mapper, White Balance, tone sliders, Presence), Curves, Color (Color
  Presence, Hue, Color Mixer and Point Color, Calibration), Look (Color
  Grading, LUT), Light & Atmosphere (Relight, Fog, Glow, Halation, Light
  Flares), Blur (Lens, Motion, Gaussian), Detail (Sharpening, Noise
  Reduction, AI Denoise), Finish (Vignette, Grain),
  in the photo's and the masks' panels and the Copy & Paste dialog. Each
  section's eye switches its own tools (one stored eye per tool); older
  edits with an old section eye off render unchanged, and a section only
  partly off shows a highlighted eye and dimmed tools. Saved layouts, open
  sections and favourites convert once to the new sections.
- **Natural** tone mapper (Light → Tone Mapper, next to Basic and AgX), the
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
  flips from when Crop was opened (undoable). In Crop, Ctrl/Cmd on a handle
  resizes from the centre, Ctrl/Cmd+scroll zooms the frame around the
  pointer, and Ctrl/Cmd+drag outside the frame moves it; a **Center**
  overlay marks the middle. Dragging in a small zone just outside a crop
  corner rotates the photo (Lightroom style; Shift for fine rotation, the
  angle beside the pointer); Crop leaves a margin around the photo so every
  corner has that room.
- **Speed Edit**: hold W (or tap it to keep it on) and drag anywhere on the
  photo to change the last-used slider; Shift drags finely and a double-click
  resets. A and D switch between the sliders chosen in Settings → Controls,
  the arrow keys nudge, R resets, C and V copy and paste a value, and Q and E
  change photos. A small display at the pointer shows the slider and value.
- **Favorites** view of the Adjustments panel (its All / ★ Favorites
  switch, remembered across restarts): star whole sections, tool
  blocks, or single sliders (a star appears on hover beside the title or
  label; the right-click menu offers the same) and arrange them by drag.
  They edit the photo's own values, with the same history, XMP and Speed
  Edit. For the photo only; masks keep their full panels.
- **Orbit Blend Pad** tab in the Develop tool bar: up to 8 tools sit on
  a circle (new pads start with Exposure, Whites, Blacks), each
  with a target; dragging one puck adds their values on top of the
  sliders (they combine or cancel), full target at a tool's anchor and
  its reverse on the opposite side, nothing at the centre. Add tools (21
  global sliders, including Gaussian Blur, Glow, Light Flare and Grain),
  drag them along the edge, set target, curve, mute or remove (switching
  a card's tool back restores its earlier target); Amount,
  on/off, Shift for finer drags, arrow keys, double-click to centre.
  Bake writes the values into the sliders; sliders show a mark and the
  combined value in brackets where the pad moves them. Six shapes
  (circle, triangle, square, rectangle, pentagon, hexagon); tools keep
  their place along the edge when the shape changes, and each reaches its
  full reverse at its opposite edge point. Pad presets in the panel:
  named pad setups in the app settings, with or without the puck
  position; load, update, rename, delete, export and import JSON.
  Saved with the edit and in XMP, copy/paste and regular presets;
  previews, exports and thumbnails apply it. For the photo only.
  Three blend modes: Axis (two-sided lines through the centre), Normalized
  (a crossfade by closeness, never neutral) and Polar (direction mixes
  two neighbouring tools, distance sets the strength).
  Each tool's label shows its current value and its value at the dot;
  a per-tool Reverse switch; the selected tool's line shows both ends.
  Full behaviour with examples: `docs/ORBIT_BLEND_PAD_GUIDE.md`.
- **Gaussian Blur** for the whole photo in Blur (masks had it before).
- **Customize Panels** (Adjustments header button or section right-click
  menu): drag the adjustment sections and the tools inside each into a new
  order, shared by the photo's and the masks' adjustments, with Reset to
  Default. Open sections are remembered across restarts.
- Readable **edit history** (right-click Undo/Redo): each step is named when
  it is made, with the changed controls and their values, mask, HSL, curve,
  and crop details; presets, Paste, Reset, and Auto Adjust are separate,
  named steps.
- Optional neutral grey editor canvas and click-to-100% zoom.
- Single-row photo information bar in Develop (file name, resolution, and
  capture details); clicking it hides or shows the capture details, and the
  choice persists. Its fine rotation can
  be adjusted either precisely with the existing slider or directly by dragging
  outside a corner of the crop frame.
- Dedicated **Crop** and **Geometry** modules separate composition from
  perspective work. Geometry includes full **Auto** correction that jointly
  balances rotation and both perspective axes (and remains useful for a
  level-only scene), focused horizon-straightening **Level** correction,
  **Vertical** keystone correction, **Guided Perspective**, editable **Manual Transform**
  controls, and a persistent **Constrain Crop** option that zooms the
  corrected result to hide empty borders without changing how strongly it
  is straightened. Auto straightens
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
  with draggable endpoints and a guide list in Lens & Geometry's Perspective part. Any two or
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
- **Lens & Geometry** panel (one tool bar button): Lens Profile applies Auto
  detection or a manually selected Lensfun profile directly to the full
  Develop image, with independent distortion and vignetting controls;
  Chromatic Aberration holds the profile's correction and the manual
  Red/Cyan and Blue/Yellow sliders; Perspective holds the geometry tools
  below. Every change applies live with undo. Lens
  settings, including Auto mode, persist in Tool and Style presets without
  requiring crop and transform data to be included. Auto finds the built-in
  lens of fixed-lens cameras (Ricoh GR, Fujifilm X100) through the camera's
  mount; **Auto Lens Correction** in the right-click Productivity menu turns
  it on for the photo or a whole selection.
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
- **Point Color** in the Color Mixer, as in Lightroom Classic (whole photo):
  up to eight points picked with a pipette, each with Hue/Sat/Lum Shift,
  Variance, a hue–saturation field and luminance strip to refine the picked
  colour, before/after swatches, Hue/Saturation/Luminance range bars, and
  Visualize Range. Points travel with the edit (XMP, copy/paste, presets).
- **Zone Color Grading** panel in the Develop tool bar (whole photo; formerly
  Zone Tint): a colour and a luminance for each of the 11 Zone System
  zones (0–X), toning a Black & White photo or grading a colour one by
  tonal zone (the zone's colour shifts the colours there). The colour never
  changes a tone; Luminance (−100 to 100) moves the zone's tones by up to
  half a zone and keeps them in order. Select a zone, or a range
  with Shift-click (Cmd/Ctrl-click adds or removes one), on an upright
  grey scale (X at the top) or from the photo: a pipette selects the zone
  under a click (same modifiers), a rectangle picker selects every zone
  holding a fair share of the dragged area (Shift or Cmd/Ctrl adds them);
  both read the tones before the grading. While the panel is open, a
  label beside the cursor names the zone under it and its lightness
  ("Zone VI · L 0.62") and outlines that zone on the scale. Holding
  Alt/Option over a zone or a grade shows in red, like a mask overlay,
  where on the photo it colours (Softness and Protect included). Moving the colour wheel turns
  the selection into a **grade** with its own colour, strength and
  luminance; each further coloured selection is another grade, and
  grades that share zones add up there (colours as colour-wheel vectors,
  so opposites soften towards neutral; luminance summed). The scale shows
  each grade's colour as a band, side by side with a layers mark where
  grades overlap; the Grades list shows every grade with its values and
  an "Overlaps …" line, selects it for editing on click (only the moved
  value is written), hides or shows it with its eye (a hidden grade is
  dimmed, has no effect and does not overlap; editing it shows it again)
  and removes it with ×. Neighbouring zones blend
  smoothly, Softness sets how far a zone's colour reaches, and Protect
  keeps black and white free of colour; Smoothing (0–4) picks each
  pixel's zone from its surroundings so grain does not speckle the
  colour. An **Advanced** switch (a view setting for every photo) shows
  Centre and Width sliders for the selected zones: a zone's centre moves
  by up to half a zone and it can have its own width instead of the
  Softness; double-click resets; moved zones stay marked on the scale
  with the switch off. Luminance that would reverse tones (opposite
  shifts on close zones) is scaled down just enough to keep them in
  order. Its own preset bar, like the Blend Pad's, keeps named looks
  (the whole panel, zone shapes included; loading replaces the photo's grading), with
  editable and deletable Selenium, Sepia, Split Tone and Platinum
  starters, and JSON export and import. Amount scales the whole effect
  (0–200 %) without changing the stored settings. Fill between makes one
  gradient grade on the zones between the first and last selected zone,
  from one end's colour to the other's along a Blend Pad curve (Linear,
  Soft, Ease in), replacing other grades there. Masks in a blend mode
  keep the grade. The panel's eye switches it off and its reset clears
  it. It travels with the edit (XMP, copy/paste, presets); older edits
  open as grades. Guide: `ZONE_COLOR_GRADING_GUIDE.md`.
- **Targeted adjustment pipettes**, as in Lightroom Classic: drag up or down
  on the photo to change what is under the cursor, double-click to reset it.
  The **Color Mixer** pipette (from RapidRAW) moves every colour band found
  there, in the active Hue, Saturation or Luminance tab. The **Tone Curve**
  pipette moves the curve at that tone in the active channel: a point is
  added or the nearest one reused; a parametric curve moves the region's
  slider. Both work in masks too. The Color Mixer also has an expanded view
  with all eight bands of one property.
- AI sky masks use EfficientSAM3 and AI foreground masks use BiRefNet, as in
  upstream RapidRAW; AI subject masks are edge-refined and stay inside the
  drawn box (a short soft fade at its edge). AI text masks select
  whatever a typed description names, such as "water" or "boat". Each mask
  type downloads its model on first use, and existing masks keep their stored
  result. A new AI depth mask starts on the nearest part of the photo; a
  click on the photo, as with Color and Luminance masks, centres its depth
  range on that spot with soft fades, separates near and far cleanly at
  object edges, and masks the whole range at full
  strength, far ranges included (older depth masks keep their
  distance-weighted strength).
- **Luminance range bar** for Luminance masks, as in Lightroom Classic: a
  dark-to-light bar with range and fade handles (the same bar as the depth
  range); a click on the photo sets the range around that tone. Luminance
  masks made before `1.42.0` keep their Tolerance selection until a tone is
  picked again.
- **Motion Blur** in Blur (engine from RapidRAW): linear, zoom and spin
  blurs, plus smooth in masks, with Highlights (bright lights keep their
  energy in the streak) and the image's grain restored over blurred areas.
  In AI-subject masks the Motion setting separates subject and background
  (Auto, Moving Subject, Panning, Uniform) without halos. When an AI mask
  also has drawn or colour-range components, or one below full opacity,
  the blur keeps their soft fades and sharpens only the AI outlines; Auto
  blurs such a mask uniformly when it is mostly fade. **Depth** uses an
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
- Light & Atmosphere has separate **Glow**, **Halation**, and **Light Flares** tools.
  Glow has a colour (Hue and Saturation) and Halation a Hue. Masks have the
  same colour sliders; a mask follows the photo's colours until one is
  moved (double-click follows the photo again), and overlapping glows
  blend their colours by amount. The three colour sliders can be Speed
  Edit sliders.
- Mask overlays can be hidden without disabling the selected mask through a
  dedicated Masking-panel control or configurable `O` shortcut. The
  overlay stays visible and follows the drag while range bars, Tolerance,
  Grow, Feather or Global Feather shape the mask.
- Brush and Flow masks preview their adjustments live while painting, with
  smoothed strokes, a brush size of up to 1000, and Lightroom-style `[` / `]`
  size shortcuts (Rotate 90° uses Command/Ctrl+`[` / `]`).
- Mask containers can be drag-reordered and composited with Normal, darkening,
  lightening, contrast, and component blend modes. Mask order and blend mode
  persist with the complete editable state in XMP.
- Clear green enabled styling and dimmed neutral styling for shared toggle
  switches throughout the application.
- **Relight** in Light & Atmosphere adds point, spot, and directional lights to a photo
  using an AI-generated surface normal map, with ambient, softness, shine,
  optional cast shadows, and per-light color, temperature, tint, intensity,
  depth, falloff, angle, elevation, cone, and feather. Lights are placed,
  moved, aimed, and duplicated directly on the image; turning Relight on
  selects the first light (or adds one), and new edits start with Ambient
  −50 so the lights stand out. Light settings travel in
  XMP; the image-derived normal map stays local and can be regenerated on
  another device.
- **Fog** in Light & Atmosphere adds depth-aware atmospheric haze from an AI depth map,
  with amount, start, feather (a soft fade-in at the start distance), density,
  ground fog, variation, glow, temperature, and tint.
- Non-destructive **AI Denoise** in Detail, with Amount and Detail. Each
  image is denoised once in the background, and the result is cached on disk
  losslessly compressed (4 GB limit, clearable in Settings). Exports always include it, and
  thumbnails refresh when it finishes. Settings sync through XMP and
  copy/paste; the denoised result is regenerated per device.
- **AI Super Resolution (2x)** in Detail, after AI Denoise (ported from
  RapidRAW's RapidRes): doubles the photo's width and height with an AI
  model, with a noise-aware **Detail** slider. Crops, masks, brush strokes
  and AI patches keep their place; the editor zooms into the extra detail
  and exports come out at twice the size (shrunk to the GPU's limit,
  16,384 px on Apple GPUs, when larger). With AI Denoise on, both versions
  are upscaled, so the Denoise sliders still work at 2×. Results are cached
  losslessly on disk (20 GB limit, clearable in Settings); only the switch
  and Detail travel in the edit (XMP, copy/paste, presets). Thumbnails and
  small previews stay at the original size. While it is on, Develop's
  toolbar shows the doubled size and a **2×** tag, and zoom percentages
  count the upscaled pixels (100 % = one upscaled pixel per screen pixel);
  Library thumbnails show its icon beside the edited mark.
- AI Denoise and Super Resolution can be switched on or off from the photo's
  and the thumbnails' right-click menus (Productivity), also for a
  selection.
- Full-size renders larger than the GPU's texture limit (for example big
  panoramas) are shrunk to fit instead of failing.
- The geometry warp (perspective, Guided Perspective, distortion, lens
  profile corrections), Relight, Fog, Lens Blur, orientation, flips,
  straightening, crop and preview downscaling run on the GPU for every
  render except the Before view (from RapidRAW, in steps; Fog keeps TIR's
  feather, TCA keeps TIR's black edges), and fall back to the CPU when the
  GPU stage fails. Warped previews and thumbnails are warped at twice
  their size, then shrunk.
- On macOS, AI Denoise, Super Resolution and the depth maps for Fog, Lens Blur, and depth masks
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
- Exports never replace a file unasked: before writing, the Export panel
  asks Overwrite, Skip or Rename for each existing file (or for all);
  unasked clashes (command line, two photos with one name, the source
  itself) get a free `name_N`. Virtual copies export as `_VC01`, `_VC02`
  per photo.
- True 8-bit or 16-bit TIFF export, a DPI setting for JPEG, PNG, and TIFF, an
  embedded sRGB profile in JPEG and PNG, colored borders, and padding to an
  aspect ratio, all saved in export presets.
- Several preset files can be imported at once, and the LUT browser lists
  HALD image LUTs.
- Consolidated EXIF export controls with optional GPS removal.
- Complete readable EXIF preservation for JPEG and TIFF (TIFF exports write
  their EXIF and GPS blocks while encoding, with UTF-8 text), and EXIF in
  JPEG XL and WebP exports, with ThisIsRAW recorded as the exporting
  software. Denoised, negative-converted, panorama and HDR images embed
  their source's EXIF too.
- A RAW the decoder cannot read opens with its embedded JPEG preview and a
  notice saying so.
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
