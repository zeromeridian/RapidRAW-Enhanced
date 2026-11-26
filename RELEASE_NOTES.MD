# ThisIsRAW Release Notes

This is the continuous release history for production builds of ThisIsRAW.
The newest release appears first. Entries contain only concise, user-facing
changes so each version can be copied directly into a GitHub Release
description.

## 1.112.0-dev-custom-profiles — 2026-11-26

### Develop

- New **Profile** at the top of Light: custom profiles like Adobe Camera
  Raw's. Set up a look, click **+** (Create Profile), name it, optionally
  give it a group, and tick what to bake in: Exposure, White Balance,
  Tone, Curves, Presence, Hue, Color Mixer, Point Color and Color Grading,
  and whether it is a Black & White profile. The ticked settings move into
  the profile and are reset in the photo, which keeps its look.
- A profile is the base of the look: every slider works on top of it, and
  nothing is capped. Exposure baked into a profile and Exposure on the
  slider add up exactly; brighter or darker looks keep their full range,
  so Highlights, Whites and the other tools still recover them.
- Choose a profile from the list (grouped, with a live preview on the
  photo while you hover), set its **Amount** from 0 to 200, remove it with
  the cross, or right-click a profile to delete it. Choosing a profile
  switches Black & White on or off as the profile says.
- A profile travels with the photo: its look is saved in the edit and in
  the XMP sidecar, so the photo looks the same on another computer
  without the profile file. Profiles can be copied, pasted and synced like
  other settings.
- On a photo with a profile, Color Calibration acts before the profile,
  as in Adobe Camera Raw. Photos without a profile look exactly as before.
- LUT: Intensity set to 0 no longer jumps back to 100 in the panel.

## 1.111.1-dev-stack-markers — 2026-11-26

### Library

- New shortcut **Alt/Option+S** expands or collapses the stack of the
  selected photo (change it in Settings → Shortcuts); also in the menu
  bar under Library → Stacking.

## 1.111.0-dev-stack-markers — 2026-11-26

### Library

- Stacks look like Lightroom Classic's: the photos of an expanded stack
  share a slightly lighter band with small grip bars at its start and end,
  the top of the stack shows a white square with the number of photos and a
  thin accent outline, and the other photos a small stack icon. Click the
  number square or a grip bar to collapse or expand the stack. This
  replaces the coloured edge markers, in the grid, the list and Develop's
  filmstrip.

## 1.110.0-dev-develop-tweaks — 2026-11-26

### Library

- OM System **.ORI** files (the original frame the camera keeps beside a
  computational shot) are now listed and open like any other RAW.

### Develop

- Crop: drag anywhere outside the crop frame to rotate the photo, as in
  Lightroom Classic, not only just outside its corners. Dragging there no
  longer draws a new crop frame; Cmd/Ctrl-drag still moves the frame and
  Shift still rotates finely.
- **Reset** is now in Develop's bottom bar, whatever tool is open, and on
  Cmd/Ctrl+Shift+R (change it in Settings → Shortcuts) and Develop → Reset
  in the menu bar. It removes every edit of the photo, including crop,
  masks, lens and geometry, Blend Pad, Zone Editor and AI edits, as one
  History step: Undo brings the edit back. The photo's right-click Reset
  works the same way and no longer asks for confirmation.

## 1.109.3-fix-batch-sync-freeze — 2026-11-21

### Develop

- Syncing an edit to hundreds of photos (Auto Sync, Paste Settings,
  Reset, Auto Adjust, lens corrections) no longer freezes editing: the
  thumbnails are rebuilt in the background, a few at a time and newest
  first, while the photo you are editing keeps updating at full
  resolution. A thumbnail that has been changed again before its turn
  is rebuilt only once.
- New RAW photos that already carry a rating (for example from the
  camera or an imported XMP) now open with the **Natural** tone mapper,
  like every other unedited RAW, instead of Basic. Photos you have
  edited keep their look.
- Syncing, pasting, Auto Adjust or a preset applied to an unedited RAW
  keeps its Natural look instead of switching it to Basic.
- Settings → Processing: the tone mapper override now suggests Natural
  for RAW files.

1## 1.109.2-dev-open-as-layers — 2026-11-21

### Edit in external editors

- With several photos selected, **Open in → (editor)** opens each of them
  as its own copy, one after another, as Lightroom Classic's Edit In
  does. **Open as Layers** is offered below the editors.
- When the editor's Save dialog suggests the hidden name (starting with a
  dot), you can simply remove the dot: the file saved as
  `-Edit.tif` is then your copy, listed and stacked with the photo, and
  later saves go straight to it. Keeping the dot still works too.

## 1.109.1-dev-open-as-layers — 2026-11-21

### Edit in external editors

- **Open in** and **Open as Layers** work as in Lightroom Classic with
  Photoshop again: nothing new appears in the Library until you save in
  the editor. Then `-Edit.tif` (or `-Edit.jpg`) appears beside the photo,
  stacked with it, and every later save updates it.
- The file the editor opens is a hidden working copy in the photo's own
  folder, so an editor that asks where to save, as Photo Craft does,
  opens its dialog in the right place: confirm the suggested name. A
  working copy that is never saved is removed after 7 days.
- Hidden files (names starting with a dot) are no longer listed in the
  Library.

## 1.109.0-dev-open-as-layers — 2026-11-21

### Edit in external editors

- **Open as Layers**, as in Lightroom Classic: select two or more photos,
  right-click and choose **Open in → Open as Layers → (editor)**. ThisIsRAW
  renders each photo with its edits into one 16-bit layered TIFF, one
  layer per photo named after its file, with the first selected photo on
  top. Photos of different sizes are centred on a canvas that fits the
  largest. The file is saved beside the first photo as `-Edit.tif`,
  stacked with it, and opened in the editor; editors without layers show
  the combined image. With more than 10 photos, ThisIsRAW asks first.
- **Open in** now writes its copy straight beside your photo
  (`-Edit.tif` or `-Edit.jpg`), adds it to the Library stacked with the
  photo, and opens it. When your editor asks where to save, as Photo
  Craft does, save over that file in the photo's folder. Before, saves
  had to go into a hidden working folder and were missed whenever the
  editor's Save dialog pointed elsewhere.
- Every save of the copy refreshes its thumbnail, also when you save
  while ThisIsRAW is closed. An edit you abandon leaves the copy; delete
  it like any photo.
- **Settings → Storage → Clear External Edit Copies** is gone: there is no
  hidden working folder any more. Saves still waiting in it from an
  earlier version are placed beside their photos at the next launch.

## 1.108.0-dev-refine-photos — 2026-11-21

### Library

- **Refine Photos**, as in Lightroom Classic, for the next culling pass:
  press **Cmd+Option+R** (Ctrl+Alt+R on Windows and Linux), choose
  **Library → Refine Photos…**, or right-click the grid's empty area.
  After you confirm, every unflagged photo in the grid becomes Rejected
  and every Selected photo becomes Unflagged. Rejected and Deferred
  photos keep their flags.
- Refine Photos acts on what the grid shows after filters and search,
  including photos in collapsed stacks. The confirmation shows both
  counts, and **Undo** in the message that follows restores the earlier
  flags.

## 1.107.1-develop — 2026-11-21

### Import

- Fixed: disconnecting a camera or memory card while the Import dialog
  was reading it closed ThisIsRAW. The photos that could not be read now
  fail on their own, and the app keeps running.

## 1.107.0-dev-lights-out-frameless — 2026-11-21

### Develop

- **Lights Out has a frameless step.** When a Lights Out border is set,
  pressing **L** once more after Lights Out shows the photo on the same
  screen without its border. The photo then fills the space the border
  left free. Press **L** again to return to Normal. Without a border,
  Lights Out keeps its three steps.

## 1.106.7-dev-stack-top-color — 2026-11-21

### Library

- **The stack top now stands out in an expanded stack.** Its edge marker
  is yellow, and the other photos in the stack keep the orange one.
  This applies in the grid, the list and the filmstrip.

## 1.106.6-fix-filter-bar-and-stack-toggle — 2026-11-20

### Library

- **Hiding the metadata filter bar now turns its filter off.** The grid
  shows every photo again while the bar is hidden; showing the bar
  brings your picks back.
- Fixed: with several stacks selected, **Expand Stack** and **Collapse
  Stack** (right-click menu and bottom bar) changed only the active
  photo's stack. They now expand or collapse every selected stack.

## 1.106.5-fix-folder-tree-launch-scan — 2026-11-20

### Library

- **The Keyword List no longer reads your whole library at every
  launch.** With the Tagging panel open, ThisIsRAW used to go through
  every photo's sidecar on each start, which kept external disks busy
  for minutes. Each library folder is now read once, the first time;
  after that the list updates when you open a folder and when you add,
  change or remove keywords in ThisIsRAW.
- Fixed: the Keyword List could forget every keyword at launch, or when
  a library disk was not connected, and then had to read the whole
  library again.
- The keyword scan keeps its progress if you quit while it runs.
- **Rescan Keywords** in the Keyword List's right-click menu reads every
  library folder again, for keywords added by other apps.

## 1.106.4-fix-folder-tree-launch-scan — 2026-11-20

### Library

- **Faster launch with Folder Image Counts or Hide Empty Folders on.**
  The folder tree now remembers how many photos each folder holds
  instead of reading through every folder of your library at every
  launch, so external disks no longer spin for minutes on startup. The
  first launch after updating counts once more.
- A folder's count is updated when you open it and when ThisIsRAW
  imports, deletes, moves, copies or renames photos in it. Photos added
  by another app are counted when you open that folder or choose
  **Refresh** in the folder's right-click menu.

## 1.106.3-dev-square-corners — 2026-11-20

### Library

- Select by in the title bar shows all four flag choices again; Deferred
  and Unflagged were cut off at its right end.

## 1.106.2-dev-square-corners — 2026-11-20

### Interface

- **Square corners.** Panels, buttons, fields, menus, switches and
  thumbnails inside the window now have square corners instead of
  rounded ones. Round controls such as slider knobs and colour-label
  dots stay round.

## 1.106.1-dev-menu-bar — 2026-11-20

### Library

- **F2 renames the selected photos**, as in Lightroom Classic. The key
  can be changed in Settings → Keybinds and shows beside Library →
  Rename Photos… in the menu bar.

## 1.106.0-dev-menu-bar — 2026-11-20

### Interface

- **Menu bar on the Mac, in the style of Lightroom Classic.** The menus
  at the top of the screen now hold ThisIsRAW's commands: File, Edit,
  Photo, View, Window and Help, plus Library and Metadata in the Library
  and Develop and Tools in Develop. Each entry shows its keyboard
  shortcut, including shortcuts you changed in Settings → Keybinds, and
  is greyed out when it doesn't apply.
- Cut, Copy, Paste and Select All keep working in text fields.

## 1.105.1-dev-delete-rejected-photos — 2026-11-20

### Library

- **Delete Rejected Files** is now also in the right-click menu of a
  photo, of the Library's empty background and of the photo in Develop,
  next to the bottom bar's button. It deletes every photo flagged
  Rejected in the open folder after one confirmation, as the button
  does.

## 1.105.0-dev-movable-vignette-centre — 2026-11-20

### Develop

- **Move the Vignette and Centré centre on the photo.** Press any
  Vignette slider (or Centré) and a crosshair appears on the photo with
  a dashed outline of the effect; drag it to place the effect's centre
  anywhere, for example on an off-centre subject. Vignette and Centré
  each have their own centre.
- Double-click the crosshair, or double-click the Vignette Amount or
  Centré slider, to put the centre back in the middle. The crosshair
  hides when you click elsewhere in the panels.
- The centre stays at the same place in the frame when you crop again.
  It is saved with the edit, in XMP, presets and Copy & Paste. Edits
  made before look exactly as they did.

## 1.104.1-dev-library-metadata-filter — 2026-11-20

### Library

- The metadata filter bar lists each camera, lens and keyword once, even
  when files write it differently (for example "FUJIFILM X-M5" and
  "Fujifilm X-M5"); picking it shows all of them.

## 1.104.0-dev-library-metadata-filter — 2026-11-20

### Library

- **Metadata filter bar**, like Lightroom Classic's Library Filter: the
  new filter button in the Library header (or `\`) opens columns above
  the grid that list the values found in the folder with how many photos
  have each: Date (by year, month and day), Camera, Lens and Focal Length
  by default.
- Click a value to show only those photos; Cmd/Ctrl-click adds more
  values, Shift-click picks a run. Values picked in one column add up;
  picks in several columns narrow each other. **All** clears a column.
- Each column's header switches it to another field: ISO, Shutter Speed,
  Aperture, Keyword, Label, Flag, Rating or File Type. Add columns with
  **+** (up to eight) or remove them; the columns and the bar stay as you
  left them.
- The picks show among the active filters under the Library title and
  are cleared with the Quick Filter's Clear All. While a large folder is
  still being read, the bar says how many photos are left, and those
  photos appear once their details are known.

## 1.103.0-dev-preset-sections — 2026-11-20

### Develop

- **Choose what a preset saves.** The preset dialog now lists every
  setting, as in Lightroom Classic: sections, their groups and the single
  sliders inside them (for example Tone → Contrast, Highlights, Shadows),
  each with its own checkbox, plus Check All and Check None. A new preset
  starts with the settings you changed on the photo ticked.
- Applying a preset changes only the settings it holds; everything else
  on the photo stays as it is. Masks and Crop & Transform are entries in
  the same list.
- **Update with Current Settings…** (was Overwrite) opens the list too,
  so you can choose again which settings the preset takes from the
  photo. **Configure Preset** renames a preset and removes or adds
  settings while keeping its saved values.
- The Tool / Style choice is gone; each preset shows how many settings it
  holds, and hovering the number lists their groups. Presets saved before apply
  exactly as they did.

## 1.102.0-dev-lens-correction-rework — 2026-11-20

### Develop

- **Updated lens correction.** Lens profiles now follow the Lensfun model
  exactly: distortion takes the camera's sensor size into account,
  chromatic aberration is corrected across the whole frame instead of by
  one fixed amount, vignetting is matched to the focal length, aperture
  and focus distance, and the automatic crop removes empty corners without
  cutting away more than needed. A profile made for a smaller sensor than
  the camera's is no longer picked.
- New edits use the updated lens correction. Edits made before keep the
  lens correction they had and look exactly as before; the Lens & Geometry
  panel says so and offers **Use Updated Lens Correction**. Choosing a
  lens or switching between Auto and Manual also moves an edit to the
  updated correction.
- To update many photos at once, right-click them in the Library and
  choose **Productivity → Use Updated Lens Correction**.
- The lens profile is looked up for each photo from its own lens, focal
  length and aperture. Pasting lens settings onto photos taken with other
  focal lengths or lenses now corrects each of them with its own profile.
- The Lens & Geometry panel shows which lens was found and which
  corrections its profile has; Distortion, Chromatic Aberration and
  Vignetting are greyed out when the profile has none.
- With the updated correction, Amount 100 applies exactly the measured
  correction, and the Distortion slider in Transform acts before the lens
  profile.

## 1.101.4-fix-header-height-slider-overflow — 2026-11-20

### Library

- The Import button now sits in the same frame as the view switch and
  the search bar, so the Library header's controls line up at one
  height, in normal and compact density.

### Develop

- A slider's coloured fill always stays inside its track; it can no
  longer reach past the slider's label.

## 1.101.3-dev-streamlined-import — 2026-11-20

### Library

- A RAW+JPEG pair whose files sit in different folders (for example two
  card slots, or separate RAW and JPG folders) now imports under one
  name too, without a `-1` on the RAW and its XMP.

## 1.101.2-dev-streamlined-import — 2026-11-20

### Library

- Deleting photos updates the folder tree's photo counts at once; an
  emptied folder no longer keeps its old count.
- Deleting a photo also moves its XMP sidecars to the trash. A RAW+JPEG
  pair's shared XMP goes once the last photo of that name is deleted.
  "Delete with associated files" includes the XMPs too.

## 1.101.1-dev-streamlined-import — 2026-11-20

### Library

- Importing a RAW+JPEG pair no longer gives the second file a `-1`;
  both keep the same name, as intended.
- The Save Preset dialog's button is shorter and stays on one line.

## 1.101.0-dev-streamlined-import — 2026-11-20

### Library

- **Import Presets**: save the Import dialog's keywords, author,
  copyright and file naming (template and custom texts) under a name,
  and pick them again for the next shoot. Presets can be updated,
  renamed, deleted, and exported or imported as files. Destination,
  subfolders and the name-clash choice are not part of a preset; they
  are remembered as before.
- The dialog reopens with the last preset you imported with, its
  keywords included. Without a preset, keywords still start empty.
- A switch beside the presets decides what happens to fields a preset
  leaves empty: on, they are cleared; off, they keep what you typed.

## 1.100.0-dev-streamlined-import — 2026-11-19

### Library

- The Import dialog has a **Metadata** section: keywords, author and
  copyright for every imported photo. Keywords are typed with commas
  between them (`Places > Berlin` for a hierarchy), with suggestions
  from your keyword list; author and copyright are remembered for the
  next import, keywords start empty each time.
- The import summary lists the keywords that were added.

### Metadata

- Author and copyright are now saved in the XMP sidecar too (when XMP
  sync is on), so Lightroom and other ThisIsRAW installations see them,
  and they are read back from XMP. This applies to the Metadata panel
  as well; clearing a field there removes it from the XMP.

## 1.99.3-dev-streamlined-import — 2026-11-19

### Library

- Import now brings each photo's XMP sidecars along (for example
  Lightroom edits, ratings and keywords), renamed with the photo; a
  RAW+JPEG pair's shared XMP comes along once. Move also moves them.
- A photo is never imported under a name whose XMP already exists at
  the destination, so it cannot pick up another photo's edits; it gets
  a number or is skipped, as chosen.
- The Import button in the Library header is as tall as the buttons
  beside it.

## 1.99.2-dev-streamlined-import — 2026-11-19

### Library

- Photos that are already in the Library show their Library thumbnail
  in the Import dialog at once, instead of being read again.
- The Import previews are a third larger, and the leftmost ones are no
  longer cut off.

## 1.99.1-dev-streamlined-import — 2026-11-19

### Library

- The Import dialog lists a folder of large TIFFs at once: capture dates
  of TIFF files (and TIFF-based RAWs) are read without reading the
  whole file, which also speeds up naming and sorting by capture date.
- Choosing another source, or switching subfolders on or off, stops the
  listing that was still running.
- Previews of very large files load one at a time, so a folder of scans
  does not use several gigabytes of memory at once.
- The Import dialog uses nearly the whole window, with larger previews.

## 1.99.0-dev-streamlined-import — 2026-11-19

### Library

- The Import dialog now picks its own **source**: a whole folder (with
  or without its subfolders), single files, or a memory card or camera
  that shows up as a drive, listed by name.
- The photos of the source appear as a grid of previews, grouped by
  capture day. All are ticked; untick the ones you do not want, tick or
  untick a whole day at once, or use Check All and Uncheck All. The
  ticked photos import in capture order.
- Connecting a memory card, or a camera that shows up as a drive, opens
  the Import dialog with it as the source. This can be turned off in
  Settings → Library.
- The dialog also remembers whether subfolders are included.

## 1.98.0-dev-streamlined-import — 2026-11-19

### Library

- A new **Import** button in the Library header (also Cmd/Ctrl+Shift+I)
  starts an import; right-clicking a folder still offers Import too.
- The Import dialog now has a **destination** you can choose. It
  remembers the last one, and a folder outside the Library is added to
  it after the import.
- **Subfolders** by capture date can be picked from a list, as in
  Lightroom Classic (for example `YYYY/YYYY-MM-DD` or
  `YYYY/YYYY-MM/YYYY-MM-DD`), or typed as a custom pattern, now also
  with `MMMM` for the month's name. The dialog shows an example path.
- **Copy** or **Move** is chosen at the top of the dialog; Move puts
  the originals in the Trash after copying. The dialog always opens on
  Copy.
- When a file name is already taken, the photo gets a number
  (`name-1`) or is skipped, as you choose. A RAW+JPEG pair gets the
  same number.
- One failing file no longer stops the whole import: the other photos
  still import.
- While importing, the Library header shows a progress bar with the
  current file and a button to cancel.
- When the import ends, a summary shows how many photos were imported,
  numbered, skipped or failed (with the reasons), the folders they went
  to and the time taken, with a button to show them in the Library.
- The dialog reopens with your last destination, subfolders, file name
  template and name choice.

## 1.97.1-dev-mask-revamp — 2026-11-19

### Develop

- Hovering a mask (or an AI edit) in the list now shows its whole
  combined area on the photo, even with the mask overlay switched off,
  just as hovering one of its components shows that component.

## 1.97.0-dev-mask-revamp — 2026-11-19

### Develop

- Hovering a mask component in the list shows just that component's
  area on the photo, as in Lightroom Classic; for a Subtract component
  that is the area it removes. Moving the pointer away shows the whole
  mask again. This works even with the mask overlay switched off, and
  for the components of AI edits too.

## 1.96.1-dev-mask-revamp — 2026-11-19

### Develop

- The mask tool icons above the mask list are larger and always sit in
  two rows of six across the panel, whatever its width. In AI edits,
  Clone and Heal have the first row and the other tools the second.

## 1.96.0-dev-mask-revamp — 2026-11-19

### Develop

- Building masks is quicker, as in Lightroom Classic:
  - Once a photo has masks, the mask tools stay available as a row of
    small icons above the list. Click one to add it to the selected
    mask (right-click for a new mask), or drag it onto a mask, onto a
    component to insert it there, or onto empty space for a new mask.
  - Hold Alt/Option while dropping a tool on a mask to add it as a
    Subtract.
  - Hovering a mask shows Add and Subtract buttons; each opens the tool
    list. Alt/Option-click Add to add a Subtract.
  - A mask's right-click menu has "Intersect Mask with".
  - "Add New Component" now shows whenever a mask is open, not only
    when it is selected.
- AI edits get the same tool row, buttons and menu item.

## 1.95.1-dev-mask-revamp — 2026-11-19

### Develop

- A mask component's +, − or ∩ mark now sits in front of its name and is
  larger, so it is easier to see and click.

## 1.95.0-dev-mask-revamp — 2026-11-19

### Develop

- Each mask component now shows its mode at all times: a small +, − or ∩
  on the corner of its icon (the first component is the base and shows
  none). Click the mark, or right-click the component, to pick Add,
  Subtract or Intersect directly instead of clicking through them.
  Subtract components have a faint background so they stand out. The
  same applies to the components of AI edits.

## 1.94.8-dev-mask-revamp — 2026-11-19

### Develop

- Moving, resizing or rotating a mask shape is smoother: while you drag,
  the photo is drawn at a lower resolution so it keeps up with the
  pointer, as in Lightroom Classic, and it is sharp again as soon as you
  let go.

## 1.94.7-dev-mask-revamp — 2026-11-19

### Develop

- Fixed the window going blank when opening the masks of a photo after
  working on masks in another one. The mask outlines now use far less
  memory on high-resolution screens, and if drawing them ever fails,
  only the outlines are left out instead of the whole window.

## 1.94.6-dev-mask-revamp — 2026-11-19

### Develop

- The photo renders faster on the GPU: tone curves and mask settings are
  read in place instead of being copied for every pixel. Previews,
  slider and mask drags, thumbnails and exports should all benefit.
  Edits look the same.

## 1.94.5-dev-mask-revamp — 2026-11-18

### Develop

- For troubleshooting slow previews, starting the app with
  `THISISRAW_GPU_PROFILE=1` logs how long each processing stage of a
  preview takes. Without it nothing changes.

## 1.94.4-dev-mask-revamp — 2026-11-18

### Develop

- The log now records how long each preview takes until it is on
  screen, to track down remaining delays.

## 1.94.3-dev-mask-revamp — 2026-11-18

### Develop

- Edits show sooner after a change such as turning a mask on or off:
  updating the photo's thumbnail no longer makes the next preview
  prepare the photo again from scratch. Starting and ending a drag on a
  slider or mask is quicker for the same reason.

## 1.94.2-dev-mask-revamp — 2026-11-18

### Develop

- Dragging a mask shape on the photo is smoother still: the red mask
  overlay, which is hidden during the drag, is no longer drawn in the
  background on every step; it returns when you let go.

## 1.94.1-dev-mask-revamp — 2026-11-18

### Develop

- Dragging, resizing or rotating a radial or linear mask on the photo now
  previews as smoothly as moving a slider: the photo follows the drag
  without fading in each step, and the full-quality render and the save
  happen when you let go.

## 1.94.0-dev-mask-revamp — 2026-11-18

### Develop

- Masks with several components update much faster: moving, resizing or
  editing one component, or turning one on or off, no longer redraws the
  others. For example, dragging a radial that is subtracted from a large
  brush mask no longer redraws every brush stroke on each step. Radial
  and linear gradients also draw faster. Masks look exactly as before.

## 1.93.0-dev-mask-revamp — 2026-11-18

### Develop

- A mask's first component is now its base, as in Lightroom Classic:
  whatever its mode, it shows its area, and the components below it add,
  subtract or intersect with it. Before, a mask whose first component was
  a Subtract or Intersect stayed empty, for example after dragging one to
  the top, or deleting or hiding the component above it. Older edits with
  such a mask now show that component.
- The same applies to the components of an AI edit.

## 1.92.0-dev-small-library-editor-tweaks — 2026-11-18

### Library

- The Quick Filter and Select By have a TIFF button in place of OTHER: it
  finds `.tif` and `.tiff` files only. PNG, WebP and other formats show
  while no file-type button is on. A saved filter with OTHER on now
  shows TIFF.
- In the Recursive view, a new "Group by folder" switch in View Options
  turns the folder headers off, so all photos show as one grid in the
  chosen sort order. It is on by default and remembered.

### Develop

- Zone Color Grading is now called the Zone Editor. Edits, presets and
  exported preset files are unchanged and keep loading.
- Right-click an Adjustments or mask section header to switch Focus Mode
  on or off (opening a section closes the others, like Lightroom
  Classic's Solo Mode); a check mark shows when it is on.

## 1.91.0-dev-settings-streamline — 2026-11-18

### Settings

- The Settings window is reorganised into ten smaller pages, listed down
  the left side: Interface, Library, Editor, Tagging, Processing, AI,
  Export, Storage, Shortcuts and About. Mouse and trackpad controls are
  now under Editor, Speed Edit and the keyboard shortcuts under
  Shortcuts.
- A search field above the page list finds settings on every page by
  name or description, including keyboard shortcuts; clear it or press
  Escape to return to the page you were on.
- Each setting now takes one line: its name and description on the left,
  its control on the right, so the pages are much shorter.
- A setting that needs a relaunch shows "Save & Relaunch" at the top of
  the window, so it stays visible while you look at other pages.
- The preview strategy switch now shows the strategy actually in use for
  installations that never changed it (Dynamic).

## 1.90.1-dev-heif-support — 2026-11-18

### Library

- 10-bit HEIF photos from cameras such as the Fujifilm X-M5 and Sony
  Alpha 7C II open on macOS instead of failing with "Unsupported HEIF
  pixel layout".

## 1.90.0-dev-heif-support — 2026-11-18

### Library

- HEIF photos open: iPhone `.heic` and `.heif` files and the `.hif`
  files of Canon, Sony and Fujifilm cameras show in the library with
  thumbnails, open in Develop and export like other photos. The HEIF
  Quick Filter button now finds them.
- HEIF photos are decoded by your computer's own decoder. On Linux this
  needs libheif with its HEVC plugin (for example `libheif1` and
  `libheif-plugin-libde265`); on Windows the "HEIF Image Extensions" and
  "HEVC Video Extensions" from the Microsoft Store. Without them the
  error message says what to install.
- Colours follow the photo's own colour profile: wide-gamut Display P3
  colours are converted into sRGB, and 10-bit camera files keep their
  full precision. HEIF photos can be opened but not yet exported as HEIF.
- HDR HEIF files (HDR PQ or HLG) open with a notice: their HDR curve is
  not decoded yet, so they look flat. The HDR gain map of newer iPhone
  photos is ignored for now; the normal photo opens.

## 1.89.0-dev-library-type-filter — 2026-11-18

### Library

- The Quick Filter's file-type buttons are now RAW, JPEG, HEIF and Other,
  and they combine: turn on RAW and JPEG to see both, or none to see every
  file. The IMG button is gone; a saved non-RAW filter becomes JPEG, HEIF
  and Other. HEIF finds files once HEIF/HEIC photos can be opened.
- Select by offers the same file types: DNG, RAW, JPEG, HEIF and Other.

## 1.88.1-dev-zone-luminance-strength — 2026-11-18

### Develop

- Zone Color Grading's zone scale shows brightness changes: a ▲ or ▼
  marks every zone that is brightened or darkened, and a grade that only
  changes brightness gets a visible white or black band. Hover a zone to
  see its luminance value.

## 1.88.0-dev-zone-luminance-strength — 2026-11-18

### Develop

- Zone Color Grading's Luminance is much stronger: ±100 now shifts a
  zone by 1.5 zones instead of half a zone. Luminance spreads gently
  into the neighbouring zones, so a single zone moves most of a zone and
  a range of zones the full 1.5 zones, with smooth transitions and tones
  kept in order. Photos already graded with Luminance open brighter or
  darker than before; colour is unchanged.

## 1.87.0-dev-blend-pad-compact-list — 2026-11-17

### Develop

- The Orbit Blend Pad's tool list is compact: each tool is one line with
  its name and value at the dot, and only the selected tool opens to show
  its slider, curve and Reverse. Click a line or a tool's dot on the pad
  to open it; the eye and bin work without opening the line.

## 1.86.1-dev-relight-light-visibility — 2026-11-17

### Develop

- Relight lights move only when you drag them: clicking elsewhere on the
  photo no longer jumps the selected light to that spot. Instead it
  releases the selected light, and clicking a light selects it again.

## 1.86.0-dev-relight-light-visibility — 2026-11-17

### Develop

- Relight shows every light on the photo while the Relight tool is open,
  with the selected light highlighted, so you no longer have to click each
  light in the panel to see where it is.
- Click a light on the photo to select it; drag it to move or aim it. A
  click on the photo itself moves the selected light, or adds one, only
  while a light is picked in the panel, as before.

## 1.85.2-fix-mask-drop-insert — 2026-11-17

### Masks

- Internal fix for inserting a mask component by drag and drop, in
  preparation for making the mask tools draggable once a photo has masks.
  Nothing changes in how masks look or behave today.

## 1.85.1-fix-keyword-case — 2026-11-17

### Keywords

- Keywords keep the capitalisation you type them in, everywhere you add
  them: the Tagging panel, Keyword Sets, the Metadata panel, the culling
  view and the right-click Tagging menu. Before, every typed keyword was
  turned into lowercase.
- A keyword that already exists with different capitalisation is reused
  as it is spelled in your library, so typing `Berlin` next to an existing
  `berlin` no longer creates a second keyword. To change a keyword's
  spelling everywhere, rename it in the Keyword List.
- Keyword Set shortcuts recognise a keyword on a photo whatever its
  capitalisation, so pressing the shortcut again removes it.

## 1.85.0-dev-gpu-compute-foundation — 2026-11-17

### Masks

- Grow and Feather on AI, Color and Luminance masks are several times
  faster on large photos. Masks look exactly as before.

## 1.84.0-dev-gpu-compute-foundation — 2026-11-17

### Develop

- Behind-the-scenes tidy-up of the graphics-card rendering. Photos look
  and behave exactly as in 1.83.1.

## 1.83.1-dev-gpu-compute-foundation — 2026-11-17

### Develop

- Perspective and lens corrections computed on the processor are now
  exact across the whole width of the photo; before, they could shift
  the right side of wide photos by a small fraction of a pixel. The
  processor and the graphics card now warp a photo the same way.

## 1.83.0-dev-gpu-compute-foundation — 2026-11-17

### Develop

- Perspective, Guided Perspective, Distortion and the lens profile
  corrections (distortion, chromatic aberration, vignetting) now run on
  the graphics card in the Develop preview, presets, the uncropped crop
  view, thumbnails and exports. Moving a geometry slider no longer
  warps the full-size photo on the processor first. If the graphics card
  cannot do it, the processor takes over as before.
- The preview and thumbnails of a straightened or corrected photo are
  now warped at twice their size and then shrunk, which keeps them sharp.
- Thumbnails now apply Relight, Fog and Lens Blur on the graphics card
  too. The Before view still uses the processor.

## 1.82.1-dev-gpu-compute-foundation — 2026-11-17

### Develop

- Fixed a very slight darkening on Mac when Relight, Fog, Lens Blur,
  straightening, the crop or the preview size was applied on the
  graphics card: each of these steps rounded its result down instead of
  to the nearest value. The graphics card now rounds the same way as the
  processor.

## 1.82.0-dev-gpu-compute-foundation — 2026-11-17

### Develop

- Relight now runs on the graphics card in the Develop preview, presets,
  the uncropped crop view and exports, including its shadows. Photos
  look the same. If the graphics card cannot do it, the processor takes
  over as before. Thumbnails and the Before view still apply Relight on
  the processor for now.

## 1.81.0-dev-gpu-compute-foundation — 2026-11-17

### Develop

- Fog now runs on the graphics card in the Develop preview, presets,
  the uncropped crop view and exports, including Fog Feather. Moving a
  Fog slider no longer recomputes Relight. Photos look the same. If the
  graphics card cannot do it, the processor takes over as before.
  Thumbnails and the Before view still apply Fog on the processor for
  now.

## 1.80.0-dev-gpu-compute-foundation — 2026-11-17

### Develop

- Lens Blur now runs on the graphics card in the Develop preview,
  presets, the uncropped crop view and exports. Moving a Lens Blur
  slider no longer recomputes Relight and Fog. Photos look the same.
  If the graphics card cannot do it, the processor takes over as
  before. Thumbnails still blur on the processor for now.

## 1.79.0-dev-gpu-compute-foundation — 2026-11-16

### Develop

- Orientation, flips, straightening and the crop are now applied on the
  graphics card for the Develop preview, thumbnails, presets and
  exports, instead of on the processor. Photos look the same; rotating
  or cropping a large photo no longer copies it through the processor
  first. If the graphics card cannot do it (for example when it runs
  out of memory on a very large export), the processor takes over as
  before.
- The interactive preview while dragging a slider no longer keeps a
  second, smaller copy of the photo in memory.
- Export size estimates for the photo being edited no longer render the
  full-size photo just to measure it.

## 1.78.0-dev-lightroom-rename — 2026-11-16

### Library

- Filename templates can use three Custom Texts: `{text}`, `{text2}` and
  `{text3}` (`{text1}` works as `{text}`). Each has its own field in
  Rename, Export and Import, shown only when the template uses it, is
  saved with a template, and is remembered for next time. Templates
  saved with one Custom Text keep it.

## 1.77.0-dev-lightroom-rename — 2026-11-16

### Export

- File naming in Export now uses the same editor as Rename: the saved
  filename templates, grouped token chips, Custom Text, mistakes in the
  template explained inline, and an example name for the first photo.
  It shows for a single photo too.
- The default export name is `{filename}_edited` (also a new starter
  template, "Filename - Edited"). It no longer drops `_edited` by itself
  when a filename suffix is set in Settings; pick "Filename" for names
  without it.
- The name suggested when exporting a single photo now follows the
  whole template, e.g. dates and camera data, not only the file name.
- The built-in export presets name files `{filename}` and
  `{filename}_web`.

### Library

- Import uses the same file naming editor, with Custom Text and an
  example name.
- A photo imported under a new name remembers its camera file name, so
  `{original_filename}` still gives it later.

## 1.76.3-dev-lightroom-rename — 2026-11-16

### Library

- Rename: a saved filename template that uses `{text}` now keeps its
  Custom Text. Picking the template fills both fields, and changing the
  text marks the template as changed so you can update it.
- The last Custom Text you used is remembered after ThisIsRAW quits and
  offered when no saved template brings its own.

## 1.76.2-dev-lightroom-rename — 2026-11-16

### Library

- Rename: the template list shows the saved template whose text is in
  the template field, e.g. when the dialog reopens with the last template
  used, instead of its placeholder.

## 1.76.1-dev-lightroom-rename — 2026-11-16

### Library

- ThisIsRAW now remembers a photo's name from before its first rename
  (in its sidecar and, with XMP sync on, in its XMP as
  `xmpMM:PreservedFileName`, the field Adobe Bridge and Lightroom use; a
  name they recorded there is picked up). `{original_filename}` and
  `{original_filename_number}` use it, so the camera's file name and
  number survive any number of renames.
- New token `{filename}` for the current file name. The "Filename"
  starter template uses it.
- Note: for a photo renamed in ThisIsRAW, an export template with
  `{original_filename}` (including the default `…_edited`) now uses the
  camera's name; use `{filename}` for the current one. Photos renamed
  before this version have no remembered name and keep using their
  current one.

## 1.76.0-dev-lightroom-rename — 2026-11-16

### Library

- A new Rename dialog, for one photo or many:
  - Token chips grouped by File, Sequence, Date, Camera, Library and
    Custom; click one to insert it.
  - A live preview of the first and last new name that updates as you
    type, with mistakes in the template explained inline.
  - Names that are already taken are shown before you rename, and the
    Rename button stays off until they are resolved; photos missing a
    value (for example no lens data) are pointed out.
  - A Custom Text field for templates that use `{text}`.
- Saved filename templates, as in Lightroom Classic: save, update,
  rename, delete, export and import them. Five starter templates are
  included (Filename; Custom Name - Sequence; Custom Name - Original
  File Number; Date - Filename; Date - Time - Camera). Export and import
  will use the same list.
- Sequence numbers follow the order of the grid, not the order in which
  the photos were selected.
- New token `{YY}` for the two-digit year (e.g. `26`).

## 1.75.0-dev-lightroom-rename — 2026-11-16

### Library

- Renaming photos now takes their XMP sidecars along (both `IMG_1.xmp`
  and `IMG_1.CR3.xmp`), so edits and metadata stay with the photo in other
  apps and on other computers. Before, the old XMP stayed behind under the
  old name.
- A RAW+JPEG pair shares one `IMG_1.xmp`. Renaming only one of the two
  gives it its own copy of that XMP and leaves the original with the
  other; renaming both moves it.
- A rename now happens completely or not at all: if any file cannot be
  renamed, every file goes back to its old name.
- Names are checked for the whole batch before anything changes, the
  same way macOS and Windows compare names (ignoring upper and lower
  case). Renaming a photo to a name another photo has, or to the name of
  a leftover sidecar whose edits it would take over, is refused.
- Changing only the case of a name (`img_1` → `IMG_1`) and renaming photos
  onto names that other photos of the same batch give up now work.
- A just-made edit is saved before the rename, so no sidecar reappears
  under the old name.
- Keyword views, thumbnails and running external edits follow a renamed
  photo right away.

## 1.74.0-dev-lightroom-rename — 2026-11-16

### Library

- File-name templates for rename, import and export understand many more
  tokens, written as `{token:format|filter?fallback}`:
  - Dates: `{date:YYYYMMDD}` (also `{capture:…}`), `{filedate:…}` and
    `{today:…}`, with `YYYY`, `YY`, `MMMM`, `MMM`, `MM`, `DD`, `hh`, `mm`
    and `ss`.
  - Sequence numbers with a width and a start: `{seq:4:start=101}`.
  - Camera data: `{camera}`, `{lens}`, `{iso}`, `{focal}`, `{aperture}`
    and `{shutter}`.
  - Library data: `{rating}` and `{label}`.
  - Filters `upper`, `lower`, `slug` and `trim:N`, e.g.
    `{camera|lower}`, and a fallback for missing values, e.g.
    `{lens?unknown}`.
  - All existing tokens and saved templates work as before.
- Names made from a template are always valid file names: characters such
  as `/` and `:` become `_`, Windows device names (`CON`, `LPT1`, …) are
  avoided, and overlong names are shortened.
- Dates in rename, export and import names now use the capture time
  exactly as the camera recorded it. Before,
  outside UTC they were shifted by your time zone, so a photo taken
  shortly after midnight could be named with the previous day.

### Export

- An exported file's date in Finder or Explorer now matches the capture
  time; before, it was off by your time zone's offset from UTC.

## 1.73.0-dev-crop-drag-rotate — 2026-11-16

### Develop

- Crop: rotate the photo Lightroom-style by dragging just outside a corner
  of the crop frame, where the pointer turns into a curved arrow. Hold
  Shift to rotate finely. The angle shows beside the pointer while you
  drag, and the Rotation slider follows along. Ctrl/Cmd+drag outside the
  frame still moves the crop.
- Crop leaves a small margin around the photo, so every corner has room
  to rotate.
- The round rotate button at the top of the crop frame is gone.

## 1.72.2-dev-rapidres — 2026-11-16

### Library

- Thumbnails of photos with Super Resolution on show its icon next to the
  edited mark.

## 1.72.1-dev-rapidres — 2026-11-16

### Develop

- With Super Resolution on, the size next to the photo's name shows the
  doubled size, and a **2×** tag marks the photo.
- Zoom now counts Super Resolution's pixels: 100 % shows one upscaled
  pixel per screen pixel, so zooming in shows the added detail, up to
  200 % of the upscaled photo.

## 1.72.0-dev-rapidres — 2026-11-16

### Develop

- New **AI Super Resolution (2x)** in the Detail section: doubles the
  photo's resolution with an AI model, with a **Detail** slider that
  brings out fine texture without boosting noise. Crops, masks and
  retouching stay where they are, zooming in shows the extra detail, and
  exports come out at twice the size. Works together with AI Denoise.
  Based on RapidRAW's RapidRes; the model is downloaded once when first
  used.
- AI Denoise and Super Resolution can now be switched on or off from the
  right-click menu (Productivity), for the open photo or a whole
  selection of thumbnails.
- Photos with only AI Denoise or Super Resolution now count as edited.

### Export

- Exports larger than the graphics card can process (such as very large
  panoramas) are now scaled down to fit instead of failing.

### Settings

- Settings → Data Management can clear the Super Resolution cache.

## 1.71.0-dev-compressed-ai-cache — 2026-11-16

### Develop

- AI Denoise results are now stored compressed on disk, without any loss
  of quality, so more denoised photos fit in the cache before older ones
  have to be denoised again. Results cached by earlier versions are still
  used.

## 1.70.0-dev-v1-7-0-small-features — 2026-11-16

### Export

- JPEG XL and WebP exports can now carry the photo's EXIF, like JPEG and
  TIFF: the **Include EXIF metadata** and **Remove GPS** switches are
  shown for them too.

### Develop

- When ThisIsRAW cannot decode a RAW file and shows the camera's
  embedded JPEG preview instead, a notice now says so, because that
  preview has lower quality and less editing headroom.
- A photo opened from Finder or Explorer now fills the filmstrip with
  the other photos in its folder, without adding the folder to the
  Library. Only that folder is listed, even in Recursive view.

### Library

- The metadata panel shows the camera, make and model together, above
  the lens (for example "FUJIFILM X-T4", or "Canon EOS R5" without the
  make twice).

## 1.69.5-fix-v1-7-0-fixes — 2026-11-16

### Develop

- Opening a photo in Develop no longer saves it: its `.tirdata` and
  `.xmp` are written only once you change something. Browsing photos,
  exports included, leaves their folders untouched.

## 1.69.4-fix-v1-7-0-fixes — 2026-11-16

### Export

- Exported files no longer get `.tirdata` or `.xmp` files beside them.
  An export is still stacked with its source in the Library, but that
  stack is kept in ThisIsRAW only and is not written to XMP; the
  source's own files do not mention the export either.

### Library

- JPEG, TIFF, PNG and other non-RAW photos no longer get a `.tirdata`
  just because the Library listed or opened them; one appears only
  once you edit, rate, tag or stack the photo. RAW files keep their
  cached EXIF as before.

## 1.69.3-fix-v1-7-0-fixes — 2026-11-16

### Export

- Exporting into a folder that already holds a file of the same name now
  asks first: **Overwrite**, **Skip** or **Rename**, with a switch to do
  the same for the other existing files. Every file is checked before
  the first one is written, and **Cancel Export** writes nothing.
  Rename, and any clash nobody is asked about, such as the command-line
  export, writes `name_1`, `name_2`, … beside the existing file.
- Virtual copies are named `_VC01`, `_VC02`, … per photo in the order
  they are exported. A copy exported without its original no longer
  takes the original's name, so it can no longer replace the original's
  earlier export.
- Two photos of one export that would get the same name no longer
  replace each other: the later one gets a free name.
- An export beside its source never replaces the source photo; it gets a
  free name instead of failing.

### Library

- Albums no longer lose a change when two updates happen at the same
  time (for example adding photos while a rename updates the album).

### Linux

- AI masks (sky, subject, foreground) work again under languages that
  write decimals with a comma, such as German. Dates and numbers in the
  app keep following your language.

## 1.69.2-dev-develop-regroup — 2026-11-15

### Develop

- The tool bar above the right sidebar now sits exactly level with the
  photo's toolbar, with the same spacing on both sides of the divider
  between them.

## 1.69.1-dev-develop-regroup — 2026-11-15

### Develop

- The tool bar above the right sidebar now lines up with the photo's
  toolbar (undo, redo, settings) on its left.

## 1.69.0-dev-develop-regroup — 2026-11-15

### Develop

- **Lens & Geometry**: Lens Correction and Geometry are now one panel
  and one button, top to bottom **Lens Profile** (Auto or Manual, the
  lens, Distortion, Vignetting), **Chromatic Aberration** (the profile's
  correction and the manual Red/Cyan and Blue/Yellow sliders, moved here
  from Detail) and **Perspective** (everything Geometry had). Every
  change applies at once and can be undone step by step.
- The tool bar now reads **Adjust, Crop, Lens & Geometry | Blend Pad,
  Zone Color Grading | Masks, Inpaint | Presets**.
- A starred Chromatic Aberration slider or block keeps working from
  Favorites, and a starred Detail section keeps chromatic aberration as
  a favourite of its own.
- The lens panel's Reset also resets the manual chromatic aberration;
  the Adjustments panel's Reset no longer does. In Copy & Paste
  Settings, Chromatic Aberration is listed under Lens & Geometry.

## 1.68.0-dev-develop-regroup — 2026-11-15

### Develop

- The tool bar moved from the narrow strip beside the right sidebar to a
  row **above** it, with bigger icons that share the full width.
- The tools follow the editing workflow: **Presets**; **Crop, Geometry,
  Lens Correction**; **Adjustments, Blend Pad, Zone Color Grading**;
  **Masks, AI**.
- Clicking the highlighted tool no longer closes the sidebar. The top
  bar's switches, the hide-panels shortcut, Lights Out and full screen
  hide it as before.

## 1.67.0-dev-develop-regroup — 2026-11-15

### Develop

- **Favorites** moved into the **Adjustments** panel: an **All /
  ★ Favorites** switch at its top shows either every section or just
  your starred sections, tools and sliders. The separate Favorites
  button in the tool strip is gone.
- The Adjustments header (Auto Adjust, histogram, Customize Panels,
  Reset) and the histogram stay in both views, and the view you chose
  is remembered after a restart.
- Starring, reordering and everything a favourite does on the photo,
  such as placing Relight lights, work as before.

## 1.66.0-dev-develop-regroup — 2026-11-15

### Develop

- The **Adjustments** panel is regrouped to follow the editing workflow:
  **Light, Curves, Color, Look, Light & Atmosphere, Blur, Detail,
  Finish**. Nothing a tool does has changed, and every photo, preset and
  XMP file looks exactly as before.
  - **Light** (formerly Basic) starts with Black & White, then the tone
    mapper, White Balance, the tone sliders (Exposure now at the top)
    and Presence (Clarity, Dehaze, Structure, Centre).
  - **Color** keeps Color Presence, Hue, the Color Mixer and Point
    Color, and Calibration.
  - **Look** holds Color Grading and the LUT.
  - **Light & Atmosphere** holds Relight, Fog, Glow, Halation and Light
    Flares; **Blur** holds Lens Blur, Motion Blur and Gaussian Blur.
  - **Detail** (formerly Details) holds Sharpening, Noise Reduction,
    AI Denoise and Chromatic Aberration; **Finish** holds Vignette and
    Grain. The Effects section is gone.
- Masks show the same sections in the same order, with their section
  names now translated.
- Your layout carries over: a custom section order keeps its order with
  the new sections in place of the old ones, reordered tools keep their
  order, open sections stay open, and every starred section, tool and
  slider stays in Favorites. A starred section whose tools moved
  elsewhere brings those tools along as their own favourites.
- The Copy & Paste Settings dialog follows the new sections.
- Each section's eye now switches only its own tools. An older edit with
  an eye switched off still looks the same; where only some of a
  section's tools are off, its eye is highlighted and those tools are
  dimmed, and a click turns them all back on. Older versions of
  ThisIsRAW ignore the new eyes and show every tool.
- The tone mapper's Reset now resets only the tone mapper; Exposure has
  its own double-click reset. Choosing a LUT switches on only the LUT.

## 1.65.0-dev-zone-advanced-mode — 2026-11-15

### Develop

- **Zone Color Grading** has an **Advanced** switch. It shows
  **Centre** and **Width** for the selected zones: move a zone's centre
  by up to half a zone, or give it its own width instead of the
  Softness. Double-click a slider to reset it. Changed zones carry a
  small tick on the zone scale, also with the switch off, and the
  switch is remembered for every photo.
- Zone presets now also keep each zone's centre and width. Presets
  saved earlier load with every zone in its standard place.
- **Fix:** opposite Luminance settings on neighbouring zones (for
  example Zone V +100 next to Zone VI −100) could make a slightly
  darker grey come out brighter than a lighter one. Tones now always
  keep their order: only in such cases are the luminance shifts reduced
  together, just enough. Every other edit looks exactly as before.

## 1.64.1-dev-zone-presets — 2026-11-15

### Develop

- **Zone Color Grading** presets: a photo with an unchanged preset no
  longer shows that preset as modified (\*) after the app is restarted,
  for the built-in and your own presets alike.

## 1.64.0-dev-zone-presets — 2026-11-15

### Develop

- **Zone Color Grading** has its own presets, like the Orbit Blend
  Pad: a bar at the top of the panel saves the whole look (grades,
  Softness, Protect, Smoothing and Amount) under a name. Loading one
  replaces the photo's grading and switches the tool on; change it and
  **Update** the preset, or save it as a new one.
- Four starter looks are included: **Selenium**, **Sepia**, **Split
  Tone** and **Platinum**. Change, rename or delete them like your own.
- Presets can be renamed, deleted, and exported or imported as JSON
  files.

## 1.63.0-dev-zone-mask-smoothing — 2026-11-15

### Develop

- **Zone Color Grading** has a **Smoothing** slider (0–4). On grainy
  photos, neighbouring pixels of the same surface could fall into
  different zones and take different colours, so the colour looked
  speckled; Smoothing picks each pixel's zone from its surroundings, so
  the colour stays even. The photo itself is not blurred, and brightness
  and black and white stay as they were.
- The Alt/Option preview shows where the colour goes with smoothing.
  Edits made before keep their look (Smoothing 0).

## 1.62.0-dev-zone-mask-preview — 2026-11-15

### Develop

- **Zone Color Grading** can show where it colours: hold **Alt**
  (**Option** on macOS) over a zone on the scale, and the photo shows that
  zone's area in red, like a mask overlay, stronger where the zone gives
  more of its colour. Over a row in the **Grades** list it shows all of
  that grade's zones together.
- The preview follows Softness and Protect, so you see exactly how a
  zone fades into its neighbours. It works for zones without a colour
  too, and changes nothing.

## 1.61.0-dev-zone-grading-phase-3 — 2026-11-15

### Develop

- **Zone Color Grading** shows which zone you are pointing at: with its
  panel open, a small label beside the cursor on the photo names the
  zone under it and its lightness, for example "Zone VI · L 0.62", and
  that zone is outlined on the zone scale.
- The label reads the tones before the grading, exactly as the pipette
  does, so it always names the zone a click would pick. It works with
  the pickers on or off and changes nothing.

## 1.60.0-dev-zone-grade-visibility — 2026-11-15

### Develop

- **Zone Color Grading**: each grade in the **Grades** list has an eye
  that hides or shows it. A hidden grade keeps its settings but has no
  effect on the photo; its row is dimmed and its band on the scale is
  faded, and it no longer counts as an overlap.
- Moving the wheel on a hidden grade shows it again. Hiding and showing
  are undo steps, and the choice is saved with the edit.
- **Fill between** reads its end colours from the grades you can see and
  also clears its zones from hidden grades, so the ramp stays exact when
  they are shown again.

## 1.59.0-dev-zone-color-pickers — 2026-11-14

### Develop

- **Zone Color Grading** now works in **grades**: select one or more
  zones (on the scale, with the pipette or with a rectangle), move the
  wheel, and that selection becomes a grade with its own colour,
  strength and luminance. Make another selection and colour it: it
  becomes a second grade, even when it shares zones with the first.
- Grades that share zones **add up** there: two similar colours
  strengthen each other, opposite colours soften towards neutral, and
  luminance shifts add. Each grade keeps its own settings.
- Overlaps are marked: the scale shows each grade's colour side by side
  with a layers icon on shared zones, and the **Grades** list shows
  "Overlaps …" under every grade that shares zones.
- Click a grade in the list to select it and edit it on the wheel; ×
  removes it.
- **Fill between** now creates one gradient grade on the zones between
  the two ends, replacing other grades there, so the ramp looks exactly
  as before.
- Edits made with earlier versions open unchanged: each run of zones with
  the same settings becomes a grade.

## 1.58.0-dev-zone-color-pickers — 2026-11-14

### Develop

- **Zone Color Grading** has two pickers in its header that choose zones
  from the photo itself:
  - **Pick a zone** (pipette): click the photo to select the zone of the
    tones under the cursor. Shift-click selects every zone from the
    current one to the clicked one; Cmd/Ctrl-click adds or removes a zone.
  - **Pick zones in an area**: drag a rectangle over part of the photo,
    such as a sky or a face, to select every zone it contains. Zones with
    only a few stray pixels in the rectangle are left out, and the wheel
    shows the zone that fills most of it. Hold Shift or Cmd/Ctrl to add
    the zones to the current selection.
- Both pickers read the tones as they are before the grading, so a photo
  that is already graded picks the same zones. They stay on until clicked
  again, Escape is pressed or another panel is opened.

## 1.57.5-dev-zone-tint — 2026-11-14

### Develop

- **Zone Tint** is now called **Zone Color Grading**.
- Each zone also has a **Luminance** slider, under the colour wheel, that
  brightens or darkens that zone's tones by up to half a zone, with or
  without a colour. Neighbouring zones blend smoothly and the tones always
  keep their order, so a lifted zone never jumps above a lighter one.
  Lifting Zone 0 gives faded blacks; the Protect slider only limits
  colour, not luminance.
- The scale shows each zone's grey after its luminance, and the list
  below (now **Adjusted zones**) shows luminance too. **Fill between**
  blends luminance along with colour, and **Amount** scales both.
- Moving one setting on the wheel for several zones now changes only that
  setting, so each zone keeps its own values for the others.

## 1.57.4-dev-zone-tint — 2026-11-14

### Develop

- **Zone Tint** now works on colour photos too, as a colour grade by
  tonal zone: each zone's colour shifts the colours already there, and
  the brightness stays the same. On Black & White photos it tones as
  before. A tint set in Black & White stays when you switch back to
  colour.
- A photo whose Zone Tint has no colour left no longer counts as edited.

## 1.57.3-dev-zone-tint — 2026-11-14

### Develop

- **Zone Tint** has a new **Amount** slider that makes the whole tint
  weaker or stronger, up to double, without changing the colours you set
  for each zone. Edits made before keep their look.
- **Fill between** blends a colour across a range of zones: colour the
  first and last zone, Shift-click to select the range, pick a curve
  (Linear, Soft or Ease in, as on the Orbit Blend Pad) and fill. The
  zones in between move from one end's colour and strength to the
  other's; opposite colours, like cool shadows and warm highlights, meet
  in a soft neutral. Each filled zone can still be changed on its own.

## 1.57.2-dev-zone-tint — 2026-11-14

### Develop

- **Zone Tint** zones now stand as an upright scale beside the colour
  wheel, X at the top and 0 at the bottom, so every zone name stays
  readable however narrow the sidebar is. Each zone's colour shows as a
  band along the scale's edge.
- A new **Tinted zones** list below the sliders shows every zone that has
  a colour, with its hue and strength; neighbouring zones with the same
  colour share one line, such as "Zones II–IV". Click a line to select
  those zones, or its × to remove their tint.

## 1.57.1-dev-zone-tint — 2026-11-14

### Develop

- **Zone Tint** has moved out of the Adjustments panel into its own
  panel in the right toolbar, under the Orbit Blend Pad. On a colour
  photo it offers a Black & White switch to get started; its eye and
  reset buttons sit in the panel header.
- The zones are now one continuous grey ramp from 0 to X: each zone's
  colour shows as a band along the top, the selected zones are
  underlined, and the zone numbers sit below the ramp where they are
  easy to read. A selection of neighbouring zones is named as a range,
  such as "Zones IV–VII".

## 1.57.0-dev-zone-tint — 2026-11-14

### Develop

- New **Zone Tint** section for Black & White photos: give each of the
  11 Zone System zones, from 0 (black) to X (white), its own colour
  without changing the photo's tones. It shows up below the other
  sections while Black & White is on.
- Click a zone to colour it. Shift-click selects a range of zones and
  Cmd/Ctrl-click adds or removes one, so one colour can go on several
  zones at once; each zone can still be changed on its own later.
- Pick the colour and its strength on a colour wheel. Neighbouring zones
  blend smoothly, **Softness** sets how far each zone reaches, and
  **Protect** keeps the deepest blacks and brightest whites neutral.
- The tint stays even inside masks set to a blend mode. It is saved with
  the edit, in XMP, copy/paste and presets; the section's eye turns it
  off for a quick before and after.

## 1.56.2-dev-editor-copies — 2026-11-14

### External editors

- **Open in** now handles every way an editor saves. A Save As under
  another name or format (for example a JPEG next to the TIFF, or a second
  TIFF version) appears beside the original under the name you chose,
  and the first copy is kept too.
- Each saved image keeps its own copy, and saving it again updates only
  that copy. Switching between formats no longer creates extra
  `-Edit-2` files.
- Several saves made at the same moment are all picked up.

## 1.56.1-fix-constrain-crop-perspective — 2026-11-14

### Develop

- **Constrain Crop** no longer changes how strongly a perspective
  correction straightens. It now only zooms the corrected photo enough to
  hide the empty borders, so turning it on or off keeps vertical lines
  exactly as straight as before.
- Auto and Vertical now give the same correction with Constrain Crop on
  or off.
- **Note for existing edits** with a perspective correction and Constrain
  Crop turned on: they now look different.
  - A Manual Transform Vertical or Horizontal correction now straightens
    exactly as set on the sliders; before, the zoom made it stronger.
  - An Auto or Vertical result saved with Constrain Crop on may now look
    under-corrected; click Auto or Vertical again to redo it.
  - Their Library thumbnails update when the photo is edited again or the
    thumbnail cache is cleared.

## 1.56.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- **Orbit Blend Pad blend modes**: a new Mode setting next to Shape.
  - **Axis** works as before: each tool along its own line, full at its
    dot, nothing at the centre, its reverse on the far side.
  - **Normalized** crossfades between the tools by closeness. The shares
    always add up to the whole, so the pad is never neutral; on a tool's
    dot only that tool counts.
  - **Polar**: the direction from the centre mixes the two neighbouring
    tools, and the distance from the centre sets the strength. The centre
    is neutral.
- Pad presets keep the mode. Existing pads stay in Axis mode.

## 1.55.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- **Orbit Blend Pad**: each tool card now remembers its value for every
  tool it has had. Switch Exposure to Contrast and back, and Exposure gets
  its earlier value again instead of a converted one.
- New pads now start with **Exposure +0.50** at the top, **Whites +25** at
  the bottom right and **Blacks −25** at the bottom left. Existing pads and
  presets are unchanged.

## 1.54.1-dev-orbit-blend-pad — 2026-11-13

### Develop

- **Orbit Blend Pad presets**: the preset picker no longer forgets the
  loaded preset's name when you switch to another panel and back. The
  name now also stays after reopening the photo or restarting, and comes
  along when you copy the pad to another photo.

## 1.54.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- **Orbit Blend Pad**: each tool's label now always shows what the tool
  gives right now ("now +75"), followed by its value at the dot. The tool
  cards show the same, and "Target" is now called "At the dot".
- Select a tool (click its dot or its card) to see its line drawn from the
  dot to the opposite side, with the value it gives at the far end.
- New **Reverse on the opposite side** switch per tool. On (as before),
  the far side gives the opposite; off, the tool fades to nothing at the
  centre and stays off beyond it, so a tool that should only darken never
  brightens.

## 1.53.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- **Orbit Blend Pad presets**: save the pad under a name and load it on
  any photo. With the puck position included, a preset is a finished
  look; without it, it is a set of tools to explore, starting at the
  centre. Presets can be updated, renamed and deleted, and exported or
  imported as JSON files, one or all at once. They hold only the pad;
  regular presets still include the pad as part of a whole look.

## 1.52.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- **Orbit Blend Pad shapes**: choose a circle, triangle, square,
  rectangle, pentagon or hexagon. Tools keep their place along the edge
  when the shape changes, and every tool still reaches its full target at
  its anchor and its full reverse on the opposite edge, even where that
  edge is closer to the centre.
- Sliders the pad moves now also show the combined value in brackets next
  to their own value, e.g. **[60] 20**.

## 1.51.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- **Orbit Blend Pad**: add up to 8 tools (they appear in the largest free
  space on the circle), drag a tool's dot along the edge to move it, and
  give each its own curve (Linear, Soft, Ease in), mute it or remove it.
  A faint ring marks where each tool's reverse sits.
- New tools on the pad: **Gaussian Blur, Glow, Light Flare and Grain**.
  The pad's values combine with these sliders too, so the reverse side
  can also reduce them.
- **Bake into sliders** writes the pad's values into the sliders and
  centres the puck, so the photo looks the same without the pad.
- Sliders the pad moves show a small mark where the photo's value really
  is.
- **Gaussian Blur** is now available for the whole photo in Effects, as
  it already was in masks.

## 1.50.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- New **Orbit Blend Pad** tab: three tools sit on a circle, and dragging
  one puck blends them all at once. Moving toward a tool brings it to its
  target, moving away reverses it, and the centre leaves the photo as the
  sliders set it. Choose each tool (Exposure, Contrast, white balance,
  Saturation, Clarity, Dehaze and more) and its target, set the overall
  Amount, or switch the pad off. Hold Shift for finer moves, nudge with the
  arrow keys, and double-click the puck to centre it. The pad is saved with
  the edit and travels with copy/paste, presets and XMP.

## 1.49.0-dev-orbit-blend-pad — 2026-11-13

### Develop

- Groundwork for the upcoming **Orbit Blend Pad**, a control that blends
  several sliders by dragging one point: edits can now carry a blend pad,
  and previews, exports, thumbnails and XMP sync all apply it. The pad's
  panel follows in a later version, so nothing changes on screen yet.

## 1.48.1-fix-subject-mask-box — 2026-11-13

### Develop

- **AI subject masks** now stay inside the box you draw: the mask ends at
  the box edge with a short soft fade instead of spilling onto nearby
  objects, also on a rotated photo. Masks made before keep their shape.

## 1.48.0-dev-edit-in-borrowings — 2026-11-13

### Library

- **Open in** (external editors): a save the editor writes into a subfolder
  of its working folder, as some editors do when exporting, is now picked
  up like any other save.
- When an external editor quits with an error right after it was started,
  ThisIsRAW now says so and stops waiting for a save, instead of keeping
  the edit open for a week.

## 1.47.0-dev-quick-wins — 2026-11-13

### Develop

- **Auto Lens Correction** in the right-click Productivity menu turns on
  automatic lens correction (profile, distortion, chromatic aberration and
  vignetting) for the photo, or for every selected photo in the Library,
  without touching their other adjustments. Auto Adjust now has its own
  icon, so the two are easy to tell apart.
- Fixed-lens cameras such as the Ricoh GR and Fujifilm X100 now get their
  lens profile in Auto lens correction, also when the camera writes no lens
  name. Such photos edited in Auto before may now show the correction.
- **Crop**: hold Ctrl (Cmd on macOS) while dragging a handle to resize the
  crop from its centre, scroll with Ctrl/Cmd to zoom the frame in or out
  around the pointer, and Ctrl/Cmd+drag outside the frame to move it. A new
  **Center** overlay marks the middle of the frame.

### Interface

- Double-click a panel divider to reset that panel to its default size.
- Shortcuts on punctuation keys (such as `[`, `]` and `\`) follow the
  symbol of your keyboard layout, and the number row still sets ratings on
  layouts that type punctuation there.

## 1.46.1-fix-lensfun-db — 2026-11-13

### Develop

- **Lens Correction**: updated lens profile database with many new cameras
  and lenses (among them OM System, Nikon Z, Sigma, Tamron, Fujifilm,
  Canon RF, Sony, Leica and Panasonic) and corrected entries for some
  Sony and Tamron lenses.

## 1.46.0-dev-reorder-favourites — 2026-11-12

### Develop

- **Favorites**: a new Favorites tab (star icon) in the Develop tool strip
  collects the sections, tools and sliders you use most. Hover a section
  title, a tool's heading or a slider's label and click the star that
  appears, or right-click it and choose Add to Favorites. Drag the
  favorites into any order; they change the same values as in
  Adjustments, with the same undo history and Speed Edit.
- **Customize Panels**: reorder the adjustment sections (Basic, Curves,
  Color, Details, Effects) and the tools inside each one by dragging, from
  the new button in the Adjustments header or from a section's right-click
  menu. Reset to Default restores the original order. The order applies to
  masks too.
- The adjustment sections you leave open now stay open after a restart.

## 1.45.0-dev-small-items — 2026-11-11

### Develop

- Basic panel labels follow RapidRAW: **EV Shift** is now called
  **Exposure**, and the former **Exposure** slider is now **Brightness**,
  placed below Blacks. Edits are unchanged.
- **Relight**: turning it on selects the first light, or adds one if there
  is none, so you can place it right away. New edits start with Ambient at
  −50 and new lights at intensity 40; existing edits look as before.

### Export

- With **Include EXIF metadata** on, TIFF exports now keep the photo's EXIF
  just like JPEG exports: image description, white balance, metering,
  sub-second times, serial numbers and more, with non-English text intact.
  Turning on GPS removal still removes the location.
- Denoised, negative-converted, panorama and HDR images now carry the
  source photo's EXIF, so other applications see the camera, lens and
  capture details.
- New `{ss}` filename token for the capture time's seconds.

## 1.44.0-dev-mask-glow-color — 2026-11-11

### Masks

- **Glow and Halation colours in masks**: a mask's Glow now has its own
  Hue and Saturation, and its Halation its own Hue. Until you move them, a
  mask follows the photo's colours; double-click a slider to make it
  follow the photo again. Where a mask's glow overlaps the photo's, the
  colours blend by their amounts.
- Masks made before this version look exactly as before.

### Speed Edit

- Glow Hue, Glow Saturation and Halation Hue can be chosen as Speed Edit
  sliders in Settings.

## 1.43.1-fix-live-mask-overlay — 2026-11-11

### Masks

- The red mask overlay now stays on screen while you shape a mask and
  follows the drag, as in Lightroom Classic: the Luminance and Depth range
  bars, Tolerance, Grow, Feather and Global Feather. Dragging a mask's
  adjustment sliders still hides it so you can judge the effect.

## 1.43.0-dev-point-color — 2026-11-11

### Develop

- **Point Color**, as in Lightroom Classic: switch the Color Mixer to
  Point Color, turn on its pipette and click a colour in the photo. Each
  click adds a point (up to eight per photo) that changes only the colours
  close to the one you picked.
- For the selected point, Hue Shift, Sat Shift and Lum Shift change those
  colours, and Variance widens or narrows how many similar colours follow.
- Refine the picked colour by dragging in the hue and saturation field or
  the luminance strip beside it. A pair of swatches shows the colour
  before and after.
- Hue Range, Saturation Range and Luminance Range bars set exactly which
  colours are affected, with soft edges. Turn on Visualize Range to see
  the selected point's colours while everything else turns grey.
- Point Color applies to the whole photo; masks keep the Color Mixer.

## 1.42.0-dev-luminance-range-bar — 2026-11-11

### Masks

- **Luminance range bar**, as in Lightroom Classic: a Luminance mask now
  has a dark-to-light bar. Drag its two lower handles to set the tones
  that are fully selected, drag the upper handles to soften the edges of
  the range, or drag the middle to move the whole range. Click the
  title to reset it to every tone.
- Clicking the photo with a Luminance mask sets the range around the
  tone you clicked, which you can then refine on the bar.
- Luminance masks made before this version keep their Tolerance slider
  and look unchanged; clicking the photo switches them to the range bar.

## 1.41.6-dev-rr-gap — 2026-11-11

### Fixes

- **Depth masks no longer outline near objects or the photo's edge.** A
  depth range in the middle distance used to also select a thin line
  around everything in front of it (such as a branch against rocks) and a
  line along the top or side of the photo. New Depth masks now separate
  near and far cleanly at object edges. Depth maps for Lens Blur, Fog and
  Motion Blur generated from now on are also more accurate along the
  photo's edges. Existing masks and maps are unchanged until they are
  regenerated.

## 1.41.5-dev-rr-gap — 2026-11-11

### Fixes

- **Depth masks cover distant areas fully.** A new Depth mask now masks
  its whole depth range at full strength, so a picked background (for
  example a far waterfall) is fully selected instead of only faintly.
  Depth masks made before this version keep their earlier look, where
  strength fell off with distance.

## 1.41.4-dev-rr-gap — 2026-11-11

### Fixes

- **Picking a depth no longer zooms the photo.** A click on the photo with
  a Depth mask selected only sets the depth range, as with Color and
  Luminance masks. Pan with the middle mouse button while picking.

## 1.41.3-dev-rr-gap — 2026-11-11

### Improvements

- **Depth masks pick their range with a click.** A new Depth mask now
  starts on the nearest part of the photo instead of a middle band that
  barely covered the foreground. Click the photo, as with Color and
  Luminance masks, and the depth range centres on that spot with soft
  fades; click again to pick another depth. The Depth Range bar and the 3D
  view still fine-tune it, and double-clicking the bar returns to the
  nearest range. Existing depth masks are unchanged.

## 1.41.2-dev-rr-gap — 2026-11-11

### Fixes

- **Motion Blur on Auto no longer jumps between looks** on a mask that is
  mostly a fade, such as an AI mask with a Linear gradient subtracted. A
  one-step change (for example the gradient's opacity from 92 to 93) could
  switch between a sharp wall and a grey smear. Auto now blurs such masks
  evenly, with the strength following the fade. Moving Subject and Panning
  can still be chosen by hand.

## 1.41.1-dev-rr-gap — 2026-11-11

### Fixes

- **Motion Blur in a mixed mask fades smoothly.** When an AI mask is
  combined with a Linear, Radial or Brush component (for example an
  inverted Foreground minus a Linear gradient), the blur now follows the
  gradient instead of stopping at a hard line. The same applies to Color
  and Luminance components and to components below full opacity. AI
  outlines stay crisp. Existing Motion Blur edits on such masks change
  accordingly; masks made only of AI components look the same as before.

## 1.41.0-dev-rr-gap — 2026-11-10

### Develop

- **Color Mixer pipette** (from RapidRAW 1.6.9): turn it on, then click a
  spot in the photo and drag up or down. Every colour band found there
  moves together, in the tab you have open (Hue, Saturation or
  Luminance). Double-click a spot to reset its bands.
- **Tone Curve pipette**: click a tone in the photo and drag up or down to
  brighten or darken that tone in the active channel. A point is added to
  the curve (or the nearest one is moved); with the parametric curve, the
  slider for that tone's region moves. Double-click to remove the point or
  reset the region.
- Both pipettes work in masks, and Shift or Alt makes the drag finer.
  Escape turns a pipette off.
- The pipette cursor is a crosshair with an up/down arrow, as in Lightroom
  Classic.
- **Expanded Color Mixer:** the Sliders button shows all eight colour
  bands at once for Hue, Saturation or Luminance.

## 1.40.0-dev-rr-gap — 2026-11-10

### Develop

- **Motion Blur** has a new engine (from RapidRAW 1.6.9):
  - **Type:** Linear, Zoom and Spin, plus Smooth in masks.
  - **Highlights:** bright lights keep their brightness as they streak,
    like a real long exposure.
  - The photo's grain is restored over blurred areas, so they no longer
    look smooth next to sharp ones.
  - **Motion** (in AI subject masks): Moving Subject, Panning, Uniform or
    Auto. The subject and the background are separated, so the blur no
    longer leaves halos around the subject.
  - **Depth:** near objects streak more than distant ones, using an AI
    depth map, with its own 3D view.
  - Long blurs stay smooth at any length.
  - The direction dial and typed angle stay as before.
- Photos that already use Motion Blur look different: above an Amount of
  about 20 the new blur is longer, and it brightens highlights by default.
  Adjust Amount or Highlights to taste.

## 1.39.0-dev-rr-gap — 2026-11-10

### Develop

- New **3D depth view** in Lens Blur, Relight, Fog and AI depth masks (from
  RapidRAW 1.6.9). It shows the photo as a 3D scene built from its depth
  map, with the effect applied:
  - **Lens Blur:** the in-focus range and its fades as planes in depth.
    Drag a plane to move it, drag the range to shift it, or click a spot in
    the scene to focus there.
  - **Fog:** the fog over the scene, including its start, feather, density,
    ground fog and colour. Drag the start plane, or click a spot to start
    the fog there.
  - **Relight:** the lights in the scene with their colour, falloff, cone,
    softness and shine. Drag the selected light freely or along one axis,
    including in depth.
  - **AI depth masks:** the selected depth band. Drag its planes like Lens
    Blur's.
  - Drag the background to turn the view, Ctrl/Cmd+scroll to zoom,
    Ctrl/Cmd+drag to pan, and double-click to switch between the default
    and a side view.
- The 3D view is a preview of the settings: edits render exactly as before.

### Fixes

- Choosing a Relight light type from its list no longer turns off placing
  lights on the photo.
- Lens Blur's depth range shows the fade the photo is actually rendered
  with for edits that never changed it (15, not 20).

## 1.38.11-dev-rr-gap — 2026-11-10

### Fixes

- Sorting by file name now puts numbers in order: `IMG_2` comes before
  `IMG_10`, and a folder of numbered frames no longer sorts as 1, 10, 11, 2.
- OM System and Olympus ORF files could open with the wrong white balance,
  black level, or crop. They now read these values from the right part of
  the file.
- Updated RAW decoder (from RapidRAW 1.6.9): support for the OM SYSTEM PEN,
  Sony A7R VI and RX10 V, Panasonic DC-L10, and Leica SL3-P; correct colours
  for the Olympus E-M1X; correct white balance for the Canon EOS-1D and
  1Ds; correct orientation for Fujifilm SuperCCD cameras; fixed black levels
  for some Panasonic RW2 and linear DNG files; fixed crops of Canon mRAW and
  sRAW files; and fixes for some lossless-JPEG-compressed DNGs.

## 1.38.10-fix-perf — 2026-11-10

### Fixes

- Hidden `._` files that macOS writes beside photos on memory cards,
  external drives and network shares no longer appear as broken photos in
  the Library, imports or keyword searches.

### Under the hood

- The temporary timing logs of the measurement builds are removed.

## 1.38.9-fix-perf — 2026-11-10

### Performance

- The preview updates faster while a slider moves: the detail blurs behind
  sharpening, clarity, structure, dehaze and the tone controls are now
  computed once per photo and view instead of on every slider step. The
  image looks exactly the same.

### Under the hood

- This build still records timing in the log for measurement.

## 1.38.8-fix-perf — 2026-11-10

### Under the hood

- Third measurement build: the log records the cost of each image
  processing step while a slider moves. Previews may update slightly more
  slowly in this build. No change to editing.

## 1.38.7-fix-perf — 2026-11-10

### Under the hood

- Second measurement build: the log also records how long the graphics
  card takes for each preview while a slider moves. No change to editing.

## 1.38.6-fix-perf — 2026-11-10

### Under the hood

- Measurement build: the editor records render and preview timings in its
  log so slider responsiveness can be profiled. No change to editing.

## 1.38.5-fix-perf — 2026-11-09

### Fixes

- Drop-down lists are no longer cut off by the panel they are in. They open
  below or above, wherever there is more room, and use the available
  window height, so the mask **Blend Mode** list shows all modes without
  scrolling in a normal-sized window.

## 1.38.4-fix-perf — 2026-11-09

### Under the hood

- Internal cleanup of the Masks and AI panels, tone curves, lens
  correction, sorting, and keywords. Nothing looks or works differently.

## 1.38.3-fix-perf — 2026-11-09

### Performance

- Editing photos with brush or AI masks is lighter: mask images the app
  already has are no longer copied and sent again for every preview and
  mask overlay, and masks are recognized from the cache without being
  re-encoded each time.

### Fixes

- Settings changed in quick succession are now always saved in the order
  you made them. Before, a change made while image stacks were being
  written to XMP could be overwritten on disk by the older settings.

## 1.38.2-fix-perf — 2026-11-09

### Performance

- The window no longer freezes while ThisIsRAW saves your edits, draws a
  mask overlay, renders the Before view or preset previews, runs Auto
  Adjust, or rates, labels, renames, copies, or duplicates photos. That
  work now runs in the background, still in the order you started it.
- Showing the Before view uses less memory on large RAW files.
- Adjusting the photo in Crop no longer starts a new background render for
  every change; only the latest one is drawn, so older frames can no longer
  flash up.

### Reliability

- Edit sidecars (`.tirdata`) and XMP files are now replaced in one step, so
  a crash, power loss, or full disk while saving can no longer leave them
  cut off.

## 1.38.1-fix-perf — 2026-11-09

### Performance

- Previews update with less overhead while you move a slider: settings are
  no longer read from disk for every preview, and each finished preview
  updates the screen once instead of twice.
- The AI connector is only checked when an address is set, and a newly
  entered address is checked right away instead of within 10 seconds.

## 1.38.0-fix-tweaks — 2026-11-09

### Develop

- The histogram now has **clipping indicators** in its top corners, like
  Lightroom Classic: the left one for shadows, the right one for highlights.
  They stay grey while nothing clips, turn white when all colours clip, and
  show the colour of the clipped channels otherwise (for example red when
  only red highlights clip). Click one to turn the clipping warning on the
  photo on or off.
- The histogram is no longer distorted by the red and blue clipping warning
  while it is shown.

## 1.37.2-fix-tweaks — 2026-11-09

### Develop

- Effects no longer has a **Creative** group. **Glow**, **Halation**, and
  **Light Flares** each have their own section with a heading, like Fog and
  LUT, and their strength slider is called **Amount**.

## 1.37.1-fix-tweaks — 2026-11-09

### Develop

- In Effects → Creative, **Glow**, **Halation**, and **Light Flares** are
  now spaced apart, so each effect's colour sliders are easy to tell apart.

## 1.37.0-fix-tweaks — 2026-11-09

### Develop

- **Crop:** double-click inside the crop frame to keep the crop and close
  Crop, like pressing Enter (as in Lightroom Classic).
- **Glow** now has a colour: **Hue** and **Saturation** below the Glow
  slider. At Saturation 0 the glow keeps the photo's own colours, as before.
- **Halation** now has a **Hue**. It starts at the familiar red-orange.
- **Fog** has a new **Feather** setting that fades the fog in gently where it
  starts, instead of a hard edge when Start is above 0.
- The mask editor no longer offers **Vignette**. Masks that already use one
  keep the controls so you can change or remove it.
- With Compact panel density, the Adjustments sections (Basic, Curves,
  Color, and so on) have a little more room between them.
- Glow and halation colours and Fog Feather need ThisIsRAW 1.37.0 or newer;
  older versions show those photos with the default glow, halation, and fog.

## 1.36.1-fix-tweaks — 2026-11-09

### Library and Develop

- **Preview Lightroom Edits** is now called **Import Lightroom Edits**.
- Importing Lightroom edits onto a RAW photo now switches it to the
  **Natural** tone mapper, which matches Lightroom's Adobe Standard rendering
  that those edits were made on. Before, a RAW photo without ThisIsRAW edits
  turned to Basic. The switch is listed in the review like any other change.
  Run the import again on photos imported earlier to move them to Natural.
- Imported Lightroom **Exposure** now gives the same number of stops in
  ThisIsRAW. It was 25 % too strong before.

## 1.36.0-dev-info-sort — 2026-11-08

### Library and Develop

- Four switches at the top right are always there, in the Library and in
  Develop: **Info**, **Tagging**, **Export**, and **Develop**. The open
  one is highlighted.
- In Develop, Info, Tagging, and Export show that panel for the photo you
  are editing, which stays on screen. Develop returns to the editing tool
  you used last. The tool strip on the right now holds only the editing
  tools.
- In the Library, **Develop** opens the active photo, like double-clicking
  it.
- The top bar now stays in fullscreen and with native window decorations,
  so the switches, Quick Filter, and Select by never move.

### Develop

- Info, Tagging, and Export in Develop now change and export only the
  photo being edited, even when several filmstrip photos are selected.
- Choosing **Export** in the filmstrip's right-click menu with several
  photos selected opens them in the Library's Export panel.

## 1.35.0-dev-info-sort — 2026-11-08

### Library

- New **Metadata** panel next to the Library grid, like Lightroom Classic:
  file information, camera details, author and copyright, rating and
  labels, the GPS map, and the full EXIF of the active photo, without
  opening it in Develop.
- The **Metadata**, **Tagging**, and **Export** panel buttons moved to the
  right of the title bar. They now show their names, and the open panel's
  button is highlighted. With native window decorations or in fullscreen
  they stay in the bottom toolbar.
- Sorting by Date Taken now keeps RAW+JPEG pairs together. JPEGs, TIFFs,
  and other non-RAW photos were sorted after all RAW photos from the same
  year, even when they were taken at the same moment.

## 1.34.2-fix-demosaic — 2026-11-08

### Develop

- Natural is now the first option in the Tone Mapper switch (Natural,
  Basic, AgX).
- Natural's tuning is preliminary: it is tuned to the shape of Adobe's
  default tone curve and has not yet been measured against Lightroom
  Classic reference exports (still to be provided). How bright Natural
  renders may change once those measurements are made.

## 1.34.1-fix-demosaic — 2026-11-08

### Develop

- Reset Adjustments and the Basic section's Reset now return a RAW photo
  to the Natural tone mapper, like the other Reset commands.

## 1.34.0-fix-demosaic — 2026-11-08

### Develop

- New **Natural** tone mapper next to Basic and AgX. It renders RAW photos
  close to Lightroom Classic's Adobe Standard profile, for every camera:
  more open shadows, and bright skies and highlights that roll off into
  white instead of clipping early, which leaves more room for the
  Highlights, Whites, and Blacks sliders. Colours keep their hue as they
  brighten.
- Natural adds back the exposure a RAW file asks for: the DNG baseline
  exposure, and the exposure the camera held back in highlight-protection
  modes (Fujifilm DR200/DR400, Canon Highlight Tone Priority and Auto
  Lighting Optimizer, Nikon Active D-Lighting and HLG, OM/Olympus
  gradation, Pentax dynamic range expansion).
- RAW photos without edits now open in Natural, and Reset returns a RAW
  photo to Natural. Photos you have already edited keep their tone mapper
  and look exactly as before. Non-RAW images look the same in Natural and
  Basic.
- Natural is also available in Settings → Global Tonemapper Override.
- Natural edits need ThisIsRAW 1.34.0 or newer: older versions show them
  as Basic.

### Library

- Thumbnails keep the same highlight detail as the editor, so bright skies
  in thumbnails match what Develop shows.

## 1.33.0-dev-rr-gap — 2026-11-08

### Develop

- In Crop, Enter keeps your crop and returns to Adjustments.
- In Crop, Escape now undoes this crop session: the crop, aspect ratio,
  straightening, rotation, and flips go back to how they were when you
  opened Crop, and you return to Adjustments. Undo brings the discarded crop
  back. Perspective and other Geometry settings are not affected.
- Escape also works right after you used a slider, without clicking
  elsewhere first.

## 1.32.0-dev-rr-gap — 2026-11-08

### Develop

- The edit history (right-click Undo or Redo) now names each step clearly:
  the controls you changed with their new values, the mask and its changed
  setting, the HSL colour, the curve channel, and the crop ratio.
- Applying a preset, Paste Adjustments, Auto Adjust, and the Reset button in
  the Adjustments panel each get their own history step under their own
  name, so one Undo takes back exactly that action.
- History names stay correct after undoing and making a new edit, and in
  long sessions past 50 steps.
- The history list is wider, wraps long names onto two lines, shows the
  full name on hover, and stays inside the window.

## 1.31.0-dev-rr-gap — 2026-11-08

### Develop

- New **Speed Edit**: hold W, or tap it to keep it on, and drag anywhere on
  the photo to change the slider you used last. Drag right or up to raise
  it, hold Shift for fine steps, and double-click to reset it. A small
  display next to the pointer shows the slider and its value.
- While Speed Edit is on, A and D switch to the previous or next slider, the
  arrow keys change the value one step, R resets it, C and V copy and paste
  a value between sliders, Q and E go to the previous or next photo, and Esc
  turns Speed Edit off.
- Choose which sliders A and D switch between in Settings → Controls →
  Speed Edit, which also shows every Speed Edit key.

## 1.30.16-dev-rr-gap — 2026-11-08

### Develop

- The next and previous photo are prepared in the background while you edit,
  so stepping to them in Develop no longer waits for the photo to load.
  The preparation runs at low priority, stops when you move on, and stays
  within the photo cache size set in Settings.

## 1.30.15-dev-rr-gap — 2026-11-07

### Develop

- Zooming in, opening a portrait after landscape photos, and exporting at
  full size no longer pause while the graphics card prepares its shaders
  again.
- Slider changes show up faster where previews are sent as JPEG (Linux, and
  macOS or Windows with the GPU renderer turned off), and full-size
  previews load faster.

## 1.30.14-dev-rr-gap — 2026-11-07

### Library

- Virtual copies no longer change the original photo's XMP. Their rating,
  color label, and keywords stay with the copy, and opening a copy no longer
  takes over the original's XMP values, as in Lightroom Classic.
- On macOS, Ctrl+click on a thumbnail in the grid, list, or filmstrip now
  adds it to or removes it from the selection, like Cmd+click, instead of
  opening the context menu. Right-click still opens the menu.
- Renaming or deleting a subfolder while viewing its parent in Recursive mode
  no longer leaves the old photos in the grid.
- Culling with "Group similar" turned on now also reports blurry photos, and
  culling works for virtual copies.

### Develop

- Undo right after an edit no longer skips that edit, and the first edit can
  be undone at once.
- Deleting a mask or AI patch with the Delete key can now be undone.
- Opening Crop after switching photos or pasting settings no longer moves or
  shrinks the saved crop.
- Pressing Enter in a slider's number field no longer opens or switches the
  photo. Keyboard shortcuts work again after clicking a checkbox.
- Ctrl-dragging a color wheel on macOS no longer opens the context menu.

### Merge and export

- HDR merge now works with virtual copies.
- A new HDR, panorama, or collage no longer overwrites an earlier one from
  the same photos or inherits its old edits; it gets a numbered name.
- Exporting a virtual copy together with its original now uses each photo's
  own edits.
- Photos too large for the graphics card now report an error instead of
  exporting without edits.
- Lossless JPEG XL export needs far less memory and time; the files are
  somewhat larger.
- The export panel stays visible while a padding or border value is
  invalid, so it can be corrected, and Enter confirms these number fields.
- LUT files whose names contain ".." can be loaded.

### General

- Settings, presets, and albums are saved safely: an interrupted save can no
  longer leave them empty or truncated.
- Opening a photo from the command line with a relative path now works.

## 1.30.13-dev-rr-gap — 2026-11-07

### Library

- Folders of RAW photos on network drives, NAS, and USB disks open much
  faster. ThisIsRAW now reads only the start of each photo for its EXIF and
  embedded preview instead of the whole file.
- Reading EXIF for a large folder no longer slows down thumbnails and
  Develop while it runs.

## 1.30.12-fix-library-scan — 2026-11-06

### Library

- Clicking a folder switches to it at once, even while another folder is
  still loading. The folder is selected in the folder list right away, and
  the previous folder's photos no longer stay on screen.
- Folders you opened earlier in the session appear instantly. In Recursive
  mode, a subfolder of the folder you are viewing appears instantly too.
- Ratings, keywords, and EXIF of a folder you return to no longer reset and
  load again; only changes are picked up.
- Leaving a folder stops scanning it, so the folder you open next loads
  faster.
- EXIF that ThisIsRAW has already read is not read from the photos again.

## 1.30.11-fix-library-scan — 2026-11-06

### Library

- Opening a folder no longer scans it twice. The second scan, which also
  re-read the folder's metadata and EXIF from the start, is gone, so large
  folders and folders with subfolders open faster.
- Thumbnails that are already loading are no longer requested again each
  time ratings or EXIF arrive, and the thumbnail progress count stays
  accurate.
- On hard disks, thumbnails that are already cached no longer read the
  original photo again.

## 1.30.10-fix-lo — 2026-11-06

### Develop

- Stepping to another photo keeps the current photo on screen until the next
  one is fully rendered, then switches with a short fade. There is no blank
  screen and no unedited preview in between.

### Lights Out

- The **Lights Out border** fades out and in with the photo when you step
  to another one.
- Lights Dim and Lights Out use less processing power while the screen is
  idle.

## 1.30.9-fix-lo — 2026-11-06

### Lights Out

- In Develop with **Lights Dim** or **Lights Out**, stepping to another photo
  no longer shows an unedited, low-resolution preview first: the photo
  appears once it is fully rendered with all its edits.

## 1.30.8-feature-lights-out — 2026-11-06

### Lights Out

- The **Lights Out border** now appears only around the photo in Develop.
  The Library and Culling show just the photos on the Lights Out background.

## 1.30.7-feature-lights-out — 2026-11-06

### Lights Out

- The **Lights Out border** can now be up to 128 px wide (new sizes 48, 64,
  96, and 128 px).
- In the Library grid, the border no longer shows black stripes or covers
  parts of neighboring thumbnails: the borders of adjacent photos merge into
  one even frame.

## 1.30.6-feature-lights-out — 2026-11-06

### Lights Out

- The **Lights Out border** now appears on all sides at once when you step
  to a photo that is still loading.

## 1.30.5-feature-lights-out — 2026-11-06

### Lights Out

- Stepping to the next photo in Lights Out no longer shows gray bars beside
  it while it loads: the darkness fits the photo from the first moment.

## 1.30.4-feature-lights-out — 2026-11-06

### Lights Out

- The **Lights Out frame** setting is gone: the whole screen around the
  photo now darkens, so it no longer added anything.
- At Fit zoom the photo shrinks just enough to keep the **Lights Out
  border** fully visible, even with the panels hidden.

## 1.30.3-feature-lights-out — 2026-11-06

### Lights Out

- New **Lights Out border** setting in **General**: draw a border of 1 to
  32 px around the photo in Lights Out, in black, gray, or white, for example
  a white border on a black screen. The frame preview shows it.

## 1.30.2-feature-lights-out — 2026-11-06

### Lights Out

- On macOS, notification banners no longer appear on top of Lights Dim or
  Lights Out.
- The thin light line along the window edge and the uncovered window corners
  are gone in Lights Dim and Lights Out.

## 1.30.1-feature-lights-out — 2026-11-06

### Lights Out

- **Lights Dim** and **Lights Out** now darken the entire screen, like
  Lightroom Classic: the desktop, other monitors, and on macOS the menu bar
  and Dock fade together with the interface.
- Lights Dim still lets you click anything on screen. Lights Out also blocks
  clicks outside the app window.
- Switching to another app, or opening a system dialog, turns Lights Out off;
  it stays off when you come back.

## 1.30.0-feature-lights-out — 2026-11-05

### Lights Out

- **Lights Out** now works like Lightroom Classic. Press **L** to go from
  Normal to Lights Dim to Lights Out: everything except your photo fades
  darker while the panels and the photo stay exactly where they are.
- In the Library, all thumbnails stay lit; select two or more photos and only
  those stay lit. In Develop only the photo you are editing stays lit.
- Lights Dim keeps the interface usable. Lights Out covers it completely and
  ignores clicks outside the photo.
- New settings in **General**: **Lights Dim level** (50–90 %) and **Lights Out
  screen color** (black, dark gray, medium gray, light gray, or white).
- The **Lights Out frame** now sets the minimum distance between the photo and
  the window edges. Hide the panels with **F** to see your photo framed.
- Lights Out no longer switches the window to fullscreen or rearranges the
  interface.

## 1.29.2-fix-top-bar — 2026-11-05

### Library and Develop

- **Quick Filter** and **Select by** in the top bar now start at the left,
  in line with the rating stars in the bottom toolbar.

## 1.29.1-fix-top-bar — 2026-11-05

### Develop

- **Open in** is now also available when you right-click the image you are
  editing, so you can send it to Photoshop, Photo Craft, or another external
  editor without going back to the Library.

### Library and Develop

- **Quick Filter** and **Select by** moved from the bottom toolbar to the top
  bar, right-aligned with the main view. Both stay open while the window is
  wide enough and fold back into their buttons only when space runs out.

## 1.29.0-fix-geometry — 2026-11-04

### Geometry

- New **Guided Perspective**, from RapidRAW, replaces Guided Transform. Draw
  guides directly on the image along edges that should be vertical or
  horizontal, and see the correction live. Drag a guide's ends to refine it.
- Any combination of up to two vertical and two horizontal guides is
  straightened exactly, including all four at once. Two guides of the same kind
  can also simply level a tilted photo.
- When you finish, the photo is cropped to the largest area without empty
  borders, keeping a fixed aspect ratio if one is set.
- **Manual Transform** sliders now fine-tune on top of the guides instead of
  replacing them.
- Photos edited with Guided Transform keep their look.

## 1.28.4-fix-geometry — 2026-11-04

### Geometry

- **Auto**, **Level**, and **Vertical** no longer let a few strong edges,
  such as the splayed legs of stacked chairs, outweigh the real verticals
  and horizontals of a scene, which could tilt an almost straight photo.

## 1.28.3-fix-geometry — 2026-11-04

### Geometry

- **Auto** now picks a balanced strength: steep upward shots keep a little
  convergence instead of being pinched at the bottom and losing much of the
  frame. Gentle corrections are still applied in full, and **Auto
  Strength** shows the chosen amount so you can change it.
- **Auto** straightens verticals first and adds a horizontal correction only
  when it keeps them straight, so railings, tabletops, and string lights no
  longer skew the photo.
- **Vertical** still applies the full correction.

## 1.28.2-fix-geometry — 2026-11-04

### Geometry

- Fixed streaks of repeated edge pixels along the borders after a
  perspective correction on photos with a lens profile.
- **Auto**, **Level**, and **Vertical** are much more accurate: they measure
  straight edges precisely, account for lens correction and Constrain Crop,
  and no longer mistake lines receding into the scene (a street, a
  tabletop) for tilted horizontals.
- **Vertical** and **Auto** now work on photos rotated a quarter turn.
- New **Auto Strength** slider after Auto or Vertical: 100 % straightens
  fully; lower values keep some convergence for a more natural look.
  Leveling always stays complete.
- **Guided** now accounts for Scale, Aspect, and Constrain Crop.

## 1.28.1-dev-curves — 2026-11-03

### Tone Curve

- A dot under each channel button shows which curves you have adjusted.
- The Red, Green, and Blue curves are tinted with the colour they add when
  raised and its complement when lowered (cyan, magenta, or yellow), as in
  Lightroom Classic.

## 1.28.0-dev-photocraft-integration — 2026-11-02

### External editors

- Settings → General → External Editors finds an installed Photo Craft and
  offers to add it, set up for 16-bit TIFF.
- Each editor can now have a preferred format (TIFF or JPEG), so **Open
  in** opens it in one click. Editors without one still ask each time.
- **Open in** now lists your editors first; **Original File** follows them.
- The External Editors settings are now translated.

## 1.27.0-dev-photocraft-integration — 2026-11-02

### External editors

- **Open in → Original File** opens a TIFF, JPEG, or other non-RAW photo
  itself in the editor, like Lightroom's **Edit Original**. Saving it
  refreshes its thumbnail. Use it to keep working on an `-Edit` copy
  without making another one.
- Working copies for external editors are removed automatically after 7
  days without a save. Copies already saved beside your photos are never
  removed.
- **Settings → Data Management → Clear External Edit Copies** shows how
  much space the working copies use and removes them.

## 1.26.0-dev-photocraft-integration — 2026-11-02

### External editors

- **Open in** now works like Lightroom's **Edit In**. The copy for the
  editor is prepared in ThisIsRAW's own cache, and appears beside the
  original as `<name>-Edit.tif` (or `.jpg`) only once you save it in the
  editor. Edits you abandon no longer leave files next to your photos or in
  your Library.
- Saving again in the editor updates the same `-Edit` copy and its
  thumbnail, without reloading the whole folder.
- Several photos can be open in external editors at once, and saves made
  while ThisIsRAW was closed are picked up when it starts again.
- The new copy is stacked with its original, as before, when automatic
  stacking is on.

### Fixes

- TIFF exports saved with a `.tif` extension now keep the photo's metadata.

## 1.25.2-dev-photocraft-integration — 2026-11-01

### Fixes

- TIFF exports, including copies opened with **Open in**, now carry an sRGB
  colour profile, as JPEG and PNG exports already did. Photoshop, Photo
  Craft, and other colour-managed apps now show their colours correctly
  instead of guessing the colour space.

## 1.25.1-develop — 2026-10-31

### Fixes

- With the **RAW** or **IMG** filter on, a collapsed stack no longer shows a
  top photo that the filter excludes. The stack now appears as its first
  matching photo; for example, a TIFF export stacked on top of its RAW no
  longer shows up under the RAW filter. The same applies to search and the
  other filters.

## 1.25.0-dev-read-embedded-xmp — 2026-10-30

### Keywords

- Keywords, ratings, and color labels that Lightroom Classic saved inside
  JPEG, TIFF, DNG, and PNG files now carry over to ThisIsRAW. Lightroom
  stores these formats' metadata in the file itself rather than in a
  separate `.xmp` file, which ThisIsRAW previously did not read.
- With **Enable XMP Sync** on, they are picked up when a folder opens, and
  again only after Lightroom changes the file, so keywords you remove in
  ThisIsRAW do not come back. **Read XMP from Folder** always reads them.
- ThisIsRAW does not change these files; your own changes stay in its own
  data.

## 1.24.1-dev-advanced-stack — 2026-10-30

### Fixes

- Auto-Stack by Capture Time now reads the photos' capture times. Before,
  it reported that every photo had no capture time and created no stacks.

## 1.24.0-dev-advanced-stack — 2026-10-30

### Stacking

- **Auto-Stack by Capture Time**, as in Lightroom Classic: choose it from the
  Stacking menu or the new clock button in the bottom bar, set the time
  between stacks (5 seconds to 1 hour), and see how many stacks it will
  create before you confirm. It stacks the selected photos, or every photo in
  the current view when nothing is selected. Photos that are already in a
  stack stay as they are.
- **Stack Selected Photos** now adds to an existing stack: select a stack and
  other photos, and they join that stack instead of breaking it apart.
  Selecting photos from several stacks merges them into one.
- New keyboard shortcuts: **Command+G** (Ctrl+G on Windows and Linux) stacks
  the selected photos, and **Shift+S** moves the active photo to the top of
  its stack. Both can be changed in Settings → Shortcuts.

## 1.23.2-dev-advanced-stack — 2026-10-30

### Fixes

- Stacking photos no longer freezes the app. The freeze could last until the
  background update of the Keyword List had finished, which takes a long time
  on large libraries and network drives.
- Stacking, unstacking, and expanding or collapsing a stack now update only
  the photos whose stack actually changed, instead of every stacked photo in
  the library.

## 1.23.1-dev-gui-tweaks — 2026-10-30

### Interface

- Compact layout: the adjustment sections (Basic, Curves, Color, Details,
  Effects) now have a little space between them, and their titles are larger
  and easier to read.

## 1.23.0-dev-gui-tweaks — 2026-10-30

### Interface

- New **Compact** layout, now the default: the side panels and the top bars
  of the Library and Develop take far less space, similar to Lightroom
  Classic, so you see many more controls without scrolling. Sliders show the
  name, slider, and value on one line, and panel sections are separated by
  slim title bars instead of floating cards. Every control works as before.
- Prefer the previous roomier layout? Choose **Settings → General → Panel
  Density → Comfortable**. The setting applies immediately.

## 1.22.1-dev-advanced-tags — 2026-10-29

### Keywords

- The Tagging panel next to the Library grid now stays open until you hide
  it, also after opening a photo in the editor and after restarting the
  app. Opening Export shows it in place of the Tagging panel; closing Export
  brings the Tagging panel back.

## 1.22.0-dev-advanced-tags — 2026-10-29

### Keywords

- Rename, move, merge, and delete keywords across your whole library.
  Right-click a keyword in the Keyword List and choose **Rename or Move…**
  (type a path such as `places > germany` to move it) or **Delete…**, or
  drag a keyword onto another keyword to move it there. Renaming onto an
  existing keyword merges the two. You first see how many photos will
  change, then the progress, and you can cancel at any time.
- Keywords under the changed keyword follow it, and your keyword sets are
  updated too.
- The Tagging panel is now also available next to the Library grid: click
  the tag button in the bottom bar. Drag photos from the grid onto a keyword
  in the Keyword List to add it to them.
- Consistent English wording: what you add is called a **keyword**, and
  **AI tags** are only the tags the AI suggested. The Tagging panel shows
  them in separate **Keywords** and **AI Tags** sections.

## 1.21.0-dev-advanced-tags — 2026-10-29

### Keywords

- New **Keyword List** in the Tagging panel: every keyword in your library,
  shown as a tree with photo counts and a search box.
  - Tick a keyword to add it to the selected photos, or untick it to remove
    it. A dash means only some of the selected photos have it.
  - Click a keyword to see every photo in your library that has it, or any
    keyword under it.
  - AI tags are listed in their own group, separate from your keywords.
- All Tagging panel sections can now be collapsed, so long tag lists no
  longer push everything else out of view.
- **Current Tags** shows your keywords and AI tags separately. A keyword on
  only some of the selected photos is outlined; click it to add it to the
  rest. Use × to remove a keyword from all selected photos.
- Search the library with `keyword:places>germany` to find photos with that
  keyword or any keyword under it.

### Fixes

- **Clear AI Tags** and **Clear All Tags** now also update the photos' XMP
  files, so the cleared tags no longer come back.

## 1.20.2-dev-advanced-tags — 2026-10-29

### Keywords

- Keyword suggestions no longer come from photos taken around the same time,
  which carried keywords over to unrelated photos from the same shoot. They
  now show keywords you often use together with the ones the photo already
  has, so a photo without keywords shows none until you add one.

## 1.20.1-dev-advanced-tags — 2026-10-29

### Keywords

- Keyword suggestions now depend on the photo: they come from photos taken
  around the same time and from keywords used together with the ones the
  photo already has. Keywords you added elsewhere no longer stay suggested
  on every photo.
- **AI Suggestions** is now its own part of the Tagging panel, with a
  **Suggest with AI** button and its results directly below it, separate
  from the other suggestions.

## 1.20.0-dev-advanced-tags — 2026-10-29

### Keywords

- New **Keyword Suggestions** in the Tagging panel, as in Lightroom Classic.
  They come from keywords you added recently, keywords on photos taken
  around the same time, and keywords used in the folder. Click a suggestion
  to add it.
- **Suggest with AI** looks at the photo and suggests keywords, preferring
  your own keywords (with their hierarchy) when they match. It runs only
  when you click it, in the Tagging panel or in the right-click tagging menu.
  The first use downloads the AI model.

## 1.19.0-dev-advanced-tags — 2026-10-29

### Keywords

- New **Keyword Sets**, as in Lightroom Classic: groups of nine keywords
  shown as a grid in the Tagging panel. Click a keyword to add it to the
  selected photos, or click it again to remove it. A keyword already on some
  of the selected photos is shown with a dashed outline.
- Press Option+1 to Option+9 (Alt+1 to Alt+9 on Windows and Linux) to add or
  remove the matching keyword; Option/Alt+0 switches to the next set. With
  Caps Lock on, the selection then moves to the next photo. All shortcuts can
  be changed in Settings → Shortcuts.
- Create, rename, edit, and delete sets in the Tagging panel. Outdoor,
  Portrait, and Event sets are included to start with.
- Your existing tagging shortcuts become the **My Keywords** set. The
  right-click tagging menu and the Metadata panel now offer the keywords of
  the active set, and the shortcut list in Settings has been removed.

## 1.18.0-dev-advanced-tags — 2026-10-29

### Keywords

- Keywords can now have levels, as in Lightroom Classic. Type `>` between
  levels, for example `places > germany > berlin`. Searching for any level,
  such as "germany", finds the photo.
- Keywords are written to XMP the way Lightroom Classic writes them, with
  the full keyword hierarchy, so Lightroom and other apps show them as
  normal keywords.
- Keywords from Lightroom Classic and other apps, including their hierarchy,
  are read as your own keywords. **Clear AI Tags** no longer removes them.
- Adding or removing a keyword now updates the XMP file right away when XMP
  sync is on. Previously a removed keyword could come back from the XMP file.

### Fixes

- AI tagging now also tags flagged photos. Previously a photo with a flag was
  skipped.

## 1.17.2-fix-tweaks — 2026-10-29

### Fixes

- Black & White photos stay black and white when a mask uses a blend mode
  other than Normal. Previously the masked area could turn back to color.
- The Color panel switch is now always labelled **Black & White**; turning it
  on or off switches black and white on or off.

## 1.17.1-fix-tweaks — 2026-10-29

### Fixes

- The crop rotation handle now sits inside the top of the crop frame instead
  of above it, so it is always visible and easy to grab, even when the photo
  fills the window. It is also larger and stands out on both bright and dark
  photos.

## 1.17.0-dev-motion-blur — 2026-10-28

### Effects

- New **Motion Blur** effect that blurs the photo along a straight line, as
  if the camera or subject moved. **Amount** sets the length of the blur.
- Set the direction with the compass dial (hold Shift to snap to 15° steps,
  double-click to reset), or type the **Angle** from −90° to 90°.
- Motion Blur is also available in masks, so you can blur only part of the
  photo, such as a moving car or the background behind it.
- Motion Blur settings are included in presets, copy & paste, Auto Sync,
  and XMP.

## 1.16.1-dev-edit-multiple-images — 2026-10-27

### Develop

- **Auto Sync** now sits at the bottom of the Develop sidebar and is always
  visible, whichever panel is open. It shows whether edits are being synced
  and to how many images, and its settings button chooses which settings
  sync. It is no longer in the bottom toolbar.

## 1.16.0-dev-edit-multiple-images — 2026-10-27

### Develop

- **Auto Sync** edits across several images, as in Lightroom Classic. Select
  images in the filmstrip, turn on Auto Sync in the Develop bottom bar (or
  press Command/Ctrl+Option/Alt+Shift+A), and every change you make is
  applied to all selected images.
- Only the control you change is synced. Adjusting one Color Mixer channel,
  color-grading wheel, or curve channel no longer replaces that whole section
  on the other images.
- Choose which sections Auto Sync includes with the checkboxes in **Copy &
  Paste Settings**, for example to leave crop or masks out.

### Fixes

- Fast edits with Auto Sync on, or pastes in quick succession, no longer lose
  changes on the other images.
- Pasting or syncing edits onto an unedited RAW keeps its automatic lens
  profile.

## 1.15.2-develop — 2026-10-27

### Fixes

- Applying Lightroom edits now finishes right away. Previously the dialog
  waited while the whole folder was reloaded, which could take minutes on
  network drives and made Develop unresponsive in the meantime.

## 1.15.1-develop — 2026-10-27

### Lightroom Import

- **Preview Lightroom Edits** is now also available when you right-click the
  image in Develop.
- The review now warns when Lightroom settings would replace edits you have
  already made in ThisIsRAW. Each affected change is marked, and a summary
  shows how many approved images would lose existing edits.

## 1.15.0-feature-auto-lens-profile — 2026-10-27

### Lens Correction

- RAW images you have not edited yet now open with their lens profile
  applied automatically, using the lens recorded in the photo. Exports and
  thumbnails match what you see in Develop.
- If no matching profile is found, lens correction stays in Manual mode.
- Images you have already edited keep their own lens settings.
- **Reset** returns lens correction to Manual with no profile linked.
- An automatically applied profile alone does not mark an image as edited.
- Turn this off with **Apply Lens Profile Automatically** in Settings →
  My Lenses.

### Fixes

- Automatic lens correction is no longer removed when you save a virtual copy
  or paste settings onto an image whose camera details were not loaded yet.

## 1.14.5-fix-lrc-curve — 2026-10-26

### Fixes

- **Preview Lightroom Edits** no longer mixes a Lightroom profile's built-in
  settings into your own. With profiles such as Adobe Monochrome, tone curves
  previously showed extra points and a second line, and Clarity could take
  the profile's value instead of yours. Run **Preview Lightroom Edits** again
  on affected images to correct them.
- Black-and-white Lightroom profiles still import as Black & White, and the
  review now names the profile whose built-in settings were not applied.

## 1.14.4 — 2026-10-26

### Maintenance

- Maintenance release with no changes to features or behavior.

## 1.14.3-dev-brush-fix — 2026-10-26

### Masking

- Brush and Flow masks now show their adjustments while you paint, not only
  after you release the mouse.
- Brush strokes follow fast mouse movements more smoothly instead of forming
  sharp corners.
- Change the brush size with **[** and **]**, as in Lightroom Classic. The
  shortcuts also work for the brushes in the AI panel, and each press changes
  the size by about 10%.
- The maximum brush size is now 1000 (previously 200).
- Rotate 90° moves to **Command+[** and **Command+]** on Mac
  (**Ctrl+[** and **Ctrl+]** on Windows and Linux). Shortcuts you have
  customized in Settings are kept.

## 1.14.2-dev-dev-module-top — 2026-10-26

### Develop

- The photo information at the top of Develop now shows the file name,
  resolution, shutter speed, aperture, ISO, focal length, and capture date and
  time in a single row. Click it to hide or show the camera details; your
  choice is remembered.

## 1.14.1-dev-port-features-from-rr — 2026-10-26

### Fixes

- AI sky masks no longer stop partway down the sky when it has a sharp change
  in brightness, such as a bright band below dark clouds. Regenerate an
  existing sky mask to get the complete sky.

## 1.14.0-dev-port-features-from-rr — 2026-10-26

### Library

- **Back** and **Forward** buttons in the folder panel step through the
  folders and albums you have visited.
- Up and Down arrow keys in the Library grid now move to the image above or
  below instead of the previous or next image.
- Copy Adjustments now works with several images selected; it copies from the
  image you right-clicked or the active image.
- **Copy Image Path** (Command+L on Mac, Ctrl+L on Windows and Linux) copies
  the file paths of the open or selected images. The shortcut can be changed
  in Settings.
- The Quick Filter remembers whether it was open, and all of its choices,
  including flags and the ≤/≥ rating comparison, are kept between launches.
- Rating filters and Select by gain an **=** option for an exact star rating.
- When a rating, flag, color label, or tag change hides the active image under
  the current filter, the selection moves to the next visible image.
- Filters are now applied before RAW+JPEG grouping, so a "RAW only" filter no
  longer hides pairs where the JPEG is shown.
- New `{original_filename_number}` naming token uses the number at the end of
  the file name, for example `1234` from `IMG_1234`. Rename and import no
  longer add a hidden `_{sequence}`; a warning appears instead when several
  files could end up with the same name.

### Export

- TIFF exports can be saved as true 8-bit or 16-bit files. 16-bit TIFFs now
  keep the full precision of the edit.
- New **Resolution (DPI)** setting under Advanced for JPEG, PNG, and TIFF
  exports, set to 300 by default.
- JPEG and PNG exports include an sRGB color profile, so color-managed apps
  and print services show them correctly.
- **Add Border** adds a colored border measured from the long edge, short
  edge, or each edge.
- **Pad to Aspect Ratio** places the photo on a colored canvas of the chosen
  shape, for example 1:1 for social media.
- **Export to same folder as source** can now export into a subfolder, such
  as `final`.
- Bit depth, DPI, border, padding, and subfolder choices are saved in export
  presets.

### Editing

- Custom crop aspect ratios can be saved as presets and removed again.
- New **Neutral grey canvas** setting shows the photo on 50% grey for color
  and exposure judgement.
- New **Zoom photo to 100%** setting: clicking the photo zooms straight to
  1:1 pixels.
- Several preset files can be imported at once; files that cannot be read
  are skipped instead of stopping the import.
- The LUT browser now also lists and imports HALD image LUTs (PNG, JPEG,
  TIFF).

### Fixes

- Settings were not saved while the Quick Filter showed only unrated images.
- On Linux with Wayland and an Nvidia graphics card, ThisIsRAW uses a more
  reliable workaround for the window crash.
- Failed exports from the command line now end with an error exit code.

## 1.13.0-dev-port-features-from-rr — 2026-10-26

### AI text masks

- New **Text** mask: describe what to select, for example "water", "boat",
  or "person", and ThisIsRAW masks it. Type the description in the mask
  settings and press Enter or **Generate Mask**.
- Text masks are named after their description, can be grown and feathered
  like other AI masks, and are saved with your edits, including in XMP.
- The text model downloads the first time you generate a text mask. A sky
  mask and a text mask on the same image share the image analysis, so the
  second one is faster.

## 1.12.0-dev-port-features-from-rr — 2026-10-25

### New AI sky and foreground masks

- AI sky masks now use EfficientSAM3, the model RapidRAW uses. It recognizes
  overcast, stormy, and dark skies that the previous model missed, and
  follows treelines and fine structures much more precisely.
- AI foreground masks now use BiRefNet, with sharper, more detailed edges
  around hair, branches, and thin objects.
- AI subject masks follow image edges more closely. Masks drawn for
  generative replace keep their original shape.
- Each AI mask type now downloads its model the first time it is used,
  instead of downloading every mask model at once.
- Existing masks in your edits are unchanged. Only new masks, or masks you
  regenerate, use the new models.
- The previous sky and foreground model files are removed automatically once
  their replacements have downloaded, freeing about 350 MB.
- When no sky or foreground is found, a clear message is shown.

## 1.11.1-dev-port-features-from-rr — 2026-10-25

### Fixes

- AI sky and foreground masks run on the processor again on Mac, as they did
  before 1.11.0. AI Denoise and depth maps still use the graphics card.

## 1.11.0-dev-port-features-from-rr — 2026-10-25

### Faster AI on Mac

- AI Denoise, the AI sky and foreground masks, and the depth maps used by Fog
  and Lens Blur now run on the Mac's graphics card and Neural Engine when
  available, for faster results.
- New **Settings → Processing → Built-in AI → GPU Acceleration** switch, on by
  default. Turn it off if AI results look wrong or AI features crash; the
  change applies immediately.
- If the graphics card cannot run a model, ThisIsRAW automatically switches
  that feature, and every later AI task, back to the processor.
- AI models now load only when a feature first needs them, which lowers memory
  use.
- An error while rendering the editor preview no longer stops later previews
  from updating.
- "Built-in AI (CPU)" is now called "Built-in AI".

## 1.10.3-fix-upstream-fixes — 2026-10-25

### File safety

- Deleting images from several folders at once no longer also deletes
  unrelated files that share a name with a selected image in another folder.
- Copying or moving images with the same file name from different folders
  into one folder is now refused before any file is changed, instead of one
  file overwriting the other. Copying into another folder also no longer
  overwrites existing files there.
- The edits of an image whose name begins with another image's full name (for
  example `IMG.CR2.jpg` next to `IMG.CR2`) are no longer moved, copied,
  deleted, or renamed together with the other image.
- Tags containing characters such as `&`, `<`, or `$` are now written to XMP
  correctly instead of producing an invalid or altered XMP file.

### Renaming

- Renaming an image together with its virtual copies renames the file once
  and keeps the sequence numbers continuous.
- After renaming several images, the selection and the open image follow the
  renamed files correctly.
- Renaming several images to the same name is now refused instead of
  overwriting files.
- Renaming a folder no longer affects the view of a different folder whose
  name starts the same way, and pinned folders and nested library folders
  inside the renamed folder follow the new name.

### Library

- Thumbnails now update when RAW processing or tonemapper settings change.
  Existing thumbnails are regenerated once as they come into view.
- Searching for ordinary words such as "sunset" or "flowers" no longer treats
  them as camera-setting filters.
- Opening a folder expands the correct library folder when one folder's name
  begins with another's, such as `Photos` and `Photos-2022`.
- After deleting an image that has virtual copies, the next remaining image is
  selected.

## 1.10.2-fix-upstream-fixes — 2026-10-24

### Fixes

- Relight lights now strike surfaces from the correct direction after
  rotating, straightening, or applying perspective and Guided Transform
  corrections.
- Healing and generative replace now sample the AI-denoised image, so patches
  on a denoised photo no longer show noise.
- Photos changed on disk under the same name, for example after saving from an
  external editor, now reload with their new content instead of an outdated
  copy. Changed RAW preprocessing settings likewise apply to recently opened
  images the next time they are opened.
- Photos on network shares and other drives that do not support file locking
  load their embedded previews and as-shot white balance correctly again.

## 1.10.1-dev-ai-denoise — 2026-10-18

### RAW metadata fix

- Camera, lens, and exposure metadata loads again for RAW formats such as
  Fujifilm RAF and Olympus ORF. Recent versions showed only the image
  dimensions for these files.
- Images affected by the issue repair themselves automatically the next time
  they are loaded; no manual action is needed.

## 1.10.0-dev-ai-denoise — 2026-10-18

### Non-destructive AI Denoise

- New **AI Denoise** section in Details applies AI noise reduction as a
  regular, reversible adjustment, with **Amount** and **Detail** controls. No
  new file is created.
- The image is denoised once in the background, with progress shown in the
  panel. The result is cached on disk, so reopening the image or changing
  Amount and Detail is instant.
- Exports always include AI Denoise. If the result is not cached yet, it is
  calculated during export.
- Thumbnails update automatically once denoising finishes.
- AI Denoise settings sync through XMP and copy/paste. Another device
  calculates its own denoised result the first time the image is opened.
- **Settings → Processing** shows the AI Denoise cache size and can clear it.
  The cache is limited to 4 GB.
- The existing **Denoise Image** action uses improved tile blending, which
  removes faint seams between processed tiles.

## 1.9.0-dev-spatial — 2026-10-18

### Atmospheric fog

- New **Fog** section in Effects adds depth-aware atmospheric haze, using an
  AI depth map, with amount, start distance, density, ground fog, variation,
  glow, temperature, and tint.

### Spatial effects

- Lens blur, Relight, and Fog maps now stay aligned with the photo when you
  change lens corrections, transforms, or Guided Transform.
- Adjusting Lens Blur, Relight, or Fog updates the Develop preview much faster.
- Lens blur and fog depth maps are kept locally, like the Relight normal map.
  Edits synced through XMP offer to regenerate them on another device.

## 1.8.0-dev-spatial — 2026-10-18

### Relight

- New **Relight** section in Effects adds point, spot, and directional lights
  that shape the photo using an AI-generated surface normal map.
- Click the image to place a light, drag it to move it, and drag its aim handle
  to point spot and directional lights. Right-click a light to duplicate or
  remove it.
- Adjust ambient light, softness, shine, and optional cast shadows, plus each
  light's color, temperature, tint, intensity, depth, falloff, angle,
  elevation, cone, and feather.
- The normal-map model downloads the first time Relight is used.
- Light settings sync through XMP. The normal map is kept locally; when an edit
  arrives from another device, Relight offers to regenerate it.

## 1.7.28-improve-lightroom-review — 2026-09-30

### More focused Lightroom review

- The detailed Lightroom change list is now collapsed by default for each
  image. Expand **Review changes** only when you want to inspect the proposed
  field-by-field edits; approvals and important warnings remain visible.

## 1.7.27-fix-lightroom-white-balance — 2026-09-30

### Lightroom white balance import

- Lightroom Classic XMP previews now translate absolute temperature and tint
  into ThisIsRAW's relative white-balance controls, so an image with only
  white-balance edits can be approved and applied.
- The conversion uses the XMP's as-shot temperature when available and labels
  the result as approximate. Camera profiles and lens-profile corrections
  remain visible warnings because they cannot be reproduced safely.

## 1.7.26-fix-grid-metadata — 2026-09-29

### Grid image resolution

- Library Grid thumbnail metadata now shows each image's pixel dimensions and
  megapixel count alongside the existing camera settings, including RAW files
  that omit EXIF pixel-dimension tags.
- Returning to a recently viewed folder retains its known Grid metadata while
  EXIF is refreshed in the background, avoiding an empty metadata flash.

## 1.7.26-feature-thumb-resize — 2026-09-23

### Dynamically resizable Library thumbnails

- Grid thumbnails resize continuously with a slider on the bottom toolbar,
  replacing the fixed Small/Medium/Large options.
- Hold Command/Ctrl and scroll over the grid to resize thumbnails in steps.
- Thumbnail size is remembered between sessions; existing settings carry over
  automatically.

## 1.7.25-feature-openin — 2026-09-11

### External-editor handoff

- Add Photoshop, Pixelmator Pro, or another desktop editor in General Settings.
- Right-click a photo to render a TIFF or JPEG derivative and open it directly
  in that editor.
- Saved external edits refresh automatically in the ThisIsRAW Library.
- macOS Adobe installation folders now resolve their contained application
  bundle automatically, so Photoshop launches from its standard install layout.

## 1.7.24-feature-dragdrop-files — 2026-08-26

### Library file and folder transfers

- Drag selected Library images onto folders to move image and sidecar files.
- Drag folders onto folders to move their entire tree, or hold Command/Ctrl to
  copy a folder tree.
- Enabled reliable HTML drag-and-drop by disabling Tauri’s native drop handler,
  which otherwise intercepts WKWebView drag events on macOS.

## 1.7.23-fix-crop-rotation — 2026-08-25

### Faster freeform cropping

- New images now open Crop in **Free** aspect ratio; **Original** remains an
  explicit preset.
- Drag the rotation handle above the crop frame for a Lightroom-style visual
  rotation adjustment, while retaining the slider for precise values.

## 1.7.22-fix-lightsout-native-overlay — 2026-08-25

### Native Black Lights Out image

- Black Lights Out on macOS now keeps the exact live Develop image on screen.
- Four 95%-black panels dim only the area around the photograph, avoiding
  cached previews, renderer swaps, resolution changes, and transition flashes.

## 1.7.21-fix-transformation — 2026-08-24

### Clearer Geometry reset

- Moved Geometry Reset out of the transformation-mode grid into a prominent,
  full-width action.

## 1.7.20-fix-transformation — 2026-08-24

### Reliable automatic perspective

- Auto and Vertical now derive camera rotation from upright structures, while
  Level derives it only from horizon-like structures.
- Diagonal features such as fire escapes are excluded from the perspective
  evidence, preventing them from distorting architectural corrections.

## 1.7.19-fix-transformation — 2026-08-24

### More reliable Upright transforms

- **Level** now confines its adjustment to reliable horizon straightening,
  avoiding an unwanted perspective warp.
- **Vertical** applies a valid zero-keystone result for parallel upright
  structures instead of treating it as a failed correction.
- **Auto** now continues through adaptive detection passes before falling back
  to a level-only result, so it can find vertical and horizontal convergence.

## 1.7.18-feature-deselect-shortcut — 2026-08-22

### Deselect All shortcut

- Added a configurable **Deselect All** keyboard shortcut, defaulting to
  Command+D on macOS and Ctrl+D on Windows and Linux.
- The shortcut clears Select-by state along with the image selection, keeping
  its toolbar indicator accurate.

## 1.7.17-fix-selection-indicator — 2026-08-22

### Accurate Select-by state and RAW choices

- The bottom-toolbar **Select by** indicator now activates only when the
  selection was created through that toolbar, not when an image is selected
  normally.
- **Select by** now offers separate DNG, other RAW, and non-RAW choices.

## 1.7.16-fix-lightsout — 2026-08-22

### Immediate Black Lights Out frame gating

- Black Lights Out now hides an incoming preview synchronously while its frame
  is being calculated. Removing the inherited opacity animation eliminates the
  last borderless flash during image navigation.

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
