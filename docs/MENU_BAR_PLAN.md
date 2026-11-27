# Menu Bar Plan (Plan item 69)

Lightroom Classic-style menus for ThisIsRAW. Branch `dev/menu-bar` from
`develop` `714244ea` (2026-11-20). Plan entry: `UPSTREAM_FEATURE_GAP.md`
item 69.

## Owner decisions (2026-11-20)

1. **Native on macOS, in-app elsewhere.** macOS: real menus in the screen's
   menu bar, replacing Tauri's default menu. Windows and Linux: a dropdown
   bar in `TitleBar.tsx` with the same entries. Both are built from one
   action list.
2. **Menus change per view, as in LrC.** File, Edit, View, Window and Help
   are always there; Library adds Library, Photo and Metadata; Develop adds
   Photo, Develop and Tools.
3. **Everything else stays.** Buttons, right-click menus and the bottom bar
   are unchanged; the menus are another way to reach the same actions.
4. **Shortcuts beside each entry.** Each entry shows the combo bound in
   Settings → Keybinds, so it follows rebinding.
5. **E and I in the Library (owner 2026-11-27).** Export (E) and Metadata
   Panel (I) also work in the Library, keys and menu, exactly like the
   title bar's Export and Info switches (Export needs a selection).
6. **No Quick Filter or Select By entries (owner 2026-11-27).** The title
   bar's rows stay the one place for them; they stay open whenever there
   is room, so a menu toggle would do nothing visible.

## Design constraints found in the code check

- **One action list.** Entries call the same handlers as the keybinds
  (`useKeyboardShortcuts.ts`) and the context menus
  (`useAppContextMenus.ts`), and read their combo from `keyboardUtils.ts`
  (`getKeybind…`, user override or `defaultCombo`). No second list of
  labels or keys.
- **macOS text editing.** Tauri's default menu has the standard Edit items
  (Undo, Cut, Copy, Paste, Select All). They are what make Cmd+C, Cmd+V,
  Cmd+X and Cmd+A work in text fields today. The new Edit menu must keep
  them as native predefined items, or copy and paste stops working in
  every input.
- **macOS accelerators take the key.** A native accelerator fires the menu
  item instead of sending the key to the page. App shortcuts that clash
  with text editing (Cmd+C Copy Settings, Cmd+V Paste Settings, Cmd+A
  Select All, Delete, arrows, single letters) must keep working in text
  fields. To check on the Mac before building: whether the accelerator
  fires while an input has focus, and how to show the combo without
  registering it as an accelerator where needed.
- **Context.** Entries are greyed out when they don't apply (no selection,
  no photo open, a collection view, an AI task running), using the same
  `shouldFire` tests as the keybinds where they exist.
- **Windows/Linux bar.** The title bar already holds the app name, the
  filter controls (`LibraryFilterControls`) and the panel toggles, so the
  menu titles go where the "ThisIsRAW" name is, and the filter controls'
  start is measured after them.
- Android: no menus.

## Draft entries (for the owner's review)

Keys are the current defaults, shown as on the Mac (⌘ = Ctrl on Windows and
Linux). "—" means no key. Every entry already exists somewhere in the app;
nothing new is added here.

**ThisIsRAW** (macOS app menu only)
- About ThisIsRAW (Settings → About) · Settings… ⌘, · Services · Hide
  ThisIsRAW, Hide Others, Show All · Quit ThisIsRAW ⌘Q
- On Windows/Linux, Settings… moves to Edit and Quit/Exit to File.

**File** (always)
- Import Photos… ⌘⇧I
- Export… E (opens the Export panel)
- Open in › external editors (as the right-click "Open in")
- Import Lightroom Edits…
- Show in Finder / Explorer
- New Folder… (Library) · Refresh View
- Copy Files ⌘⇧C · Paste Files ⌘⇧V · Copy Image Path ⌘L

**Edit** (always)
- Undo ⌘Z · Redo ⌘Y (Develop edits)
- Cut, Copy, Paste, Select All (text fields; native items on the Mac)
- Select All Photos ⌘A · Select None ⌘D
- Find ⌘F (focuses the search)

**Library** (Library view)
- Grid G · Cull · List (display modes)
- Show Subfolders (Flat / Recursive view)
- Filter Bar \ · Quick Filter · Select By…
- Show EXIF on Thumbnails T
- Stacking › Stack Selected ⌘G, Unstack, Move to Top of Stack ⇧S,
  Auto-Stack by Capture Time
- Albums › Add to Album, Remove from Album, New Album…
- Refine Photos… ⌥⌘R (Plan item 72, `1.108.0`)
- Rename Photos…

**Photo** (Library and Develop)
- Open in Develop ↩ · Previous Photo ← · Next Photo →
- Rotate Left ⌘[ · Rotate Right ⌘]
- Rating › None 0, 1–5 · Flag › Rejected X, Selected ⇧P, Deferred ⇧D,
  Unflagged U · Colour Label › None ⇧0, Red ⇧1, Yellow ⇧2, Green ⇧3,
  Blue ⇧4, Purple ⇧5
- Keywords › keyword sets ⌥1–⌥9, Next Keyword Set ⌥0
- Create Virtual Copy · Duplicate File (physical copy)
- Photo Merge › Panorama…, HDR… · Frame / Collage… · Cull Similar…
- Enhance › AI Denoise…, Super Resolution, Convert Negative…
- Delete Photo ⌫ · Delete Rejected Files

**Metadata** (Library view)
- Metadata Panel I · Keywords (Tagging panel)
- Read Metadata from XMP (folder)

**Develop** (Develop view)
- Copy Settings ⌘C · Paste Settings ⌘V · Auto Sync ⌘⌥⇧A
- Apply Preset… · Auto Adjust
- Auto Lens Correction · Use Updated Lens Correction
- Show Original B · Reset Adjustments

**Tools** (Develop view)
- Adjustments D · Crop R · Crop / Straighten S · Lens & Geometry
- Blend Pad · Zone Editor
- Masks M · Mask Overlay O · AI / Inpaint K · Presets P
- Brush Size ] / [

**View** (always)
- Zoom In ⌘= · Zoom Out ⌘- · Fit ⌘0 · 100 % ⌘1 · Cycle Zoom Space
- Full Screen Preview F
- Lights Out L · Lights Out Back ⇧L
- Analytics A

**Window** (always)
- Library G · Develop ↩
- Left Panel, Right Panel, Filmstrip (the title bar's panel toggles)
- Minimize ⌘M, Zoom, Enter Full Screen (native on the Mac)

**Help** (always)
- Keyboard Shortcuts (Settings → Keybinds)
- About ThisIsRAW (Windows/Linux)

## Phases (proposed after the review)

1. Action registry: one list of menu actions with label key, keybind
   action, handler and enabled test, shared by the keybinds.
2. macOS native menus from that list (replace the default menu; keep the
   text Edit items), rebuilt when the view, selection or keybinds change.
3. Windows/Linux dropdown bar in `TitleBar.tsx` from the same list.

## Progress

- 2026-11-20: decisions 1–4; draft entries accepted by the owner as "a good
  start".
- **`1.106.0` (2026-11-20): phases 1 and 2, first cut, macOS only.**
  - `src/utils/menuBar.ts`: the one menu list (`MENU_BAR`, `menusForView`)
    and `getMenuAccelerator` (bound combo → Tauri accelerator; `ctrl` is
    CmdOrCtrl, macOS `Delete` is ⌘⌫).
  - `useKeyboardShortcuts.ts`: `runShortcutAction` / `canRunShortcutAction`
    run the keybind action map with a stand-in event (same `shouldFire`,
    blocked while a modal or Settings is open); a key press that already
    ran an action is not run again by its accelerator (300 ms);
    `isTypingKeyPress` tells an accelerator fired by typing in a text
    field from a click on the menu.
  - `useNativeMenuBar.ts`: builds the macOS menus with `@tauri-apps/api/menu`
    (`setAsAppMenu`, Window and Help roles), rebuilt on view, keybind or
    language change; greying follows the stores (150 ms). Commands:
    Cull/List display mode, Refresh View, Rename Photos, Show in Finder,
    Delete Rejected Files.
  - Edit keeps the native Cut, Copy, Paste and Select All before the photo
    entries that share ⌘C, ⌘V and ⌘A; Undo/Redo typed in a text field act
    on its text (`execCommand`).
  - **Not yet** (all but phase 3 added in `1.119.0`, below): the right-click-only entries of the draft (Open in,
    Import Lightroom Edits, New Folder, Albums, Unstack, Auto-Stack, Flat /
    Recursive, Quick Filter, Select By, virtual copy, duplicate, Photo
    Merge, Frame, Cull Similar, Enhance, Read XMP, Apply Preset, Auto
    Adjust, lens corrections, Reset, Lens & Geometry, Blend Pad, Zone
    Editor, panel toggles, About in Help), Export from the Library, and
    phase 3 (Windows/Linux bar).
  - **Owner's Mac check 2026-11-20: "all good"** (menus per view, keys,
    greying, keys fire once, text fields keep their keys).
- **`1.106.1` (2026-11-20):** new keybind `rename_photos` (F2, as in LrC;
  owner request); Library → Rename Photos… uses it instead of a command.
- **`1.108.0` (2026-11-21):** Library → Refine Photos… (keybind
  `refine_photos`, ⌥⌘R; Plan item 72).
- **`1.118.0` (2026-11-27):** File → Back Up Settings… / Restore
  Settings… (commands `backUpSettings`, `restoreSettings`; Plan item 85).
- **`1.119.0` (2026-11-27, `dev/menu-bar-entries`, not committed): the
  remaining draft entries, macOS.**
  - `src/hooks/usePhotoCommands.ts`: the right-click photo commands as
    `{ canRun(paths), run(paths) }` (merge/frame limits, virtual copy,
    duplicate, Enhance, AI tools on/off, Auto Adjust, lens corrections,
    Unstack, Auto-Stack, Remove from Album, Import Lightroom Edits) plus
    `readXmpFromFolder`; the thumbnail, Develop and folder menus use them
    (`photoCommandOption`), the menu bar runs them on `getActionPaths()`.
  - `useAppContextMenus.ts` returns `photoCommands`, `readXmpFromFolder`
    and `menuOptions` (`openIn`, `addToAlbum`: the right-click submenus,
    shared by `buildOpenInOptionForPaths` / `buildAddToAlbumOption`).
  - `menuBar.ts`: entry kind `options` (a submenu built from those
    `Option` trees, rebuilt when its labels or the selection change) and
    the new commands; `useNativeMenuBar.ts`: `CheckMenuItem` for entries
    with `isChecked` (Show Photos in Subfolders, Left Panel, Filmstrip).
  - Decision 5: `toggle_metadata` / `toggle_export` run in the Library
    through `toggleLibraryPanel`, with the shared
    `canToggleLibraryPanel` (`useUIStore.ts`, also used by
    `SidePanelToggles`).
  - Behaviour changes in the right-click menus: Develop's Auto Adjust,
    Auto Lens Correction and AI tool entries and the thumbnail menu's wait
    for the edited photo to load only when it is the only target; Frame
    Image in Develop takes the photo from the library list.
  - **Still to do:** phase 3 (Windows/Linux bar; About in Help there).
    Left out by decision 6: Quick Filter, Select By.
