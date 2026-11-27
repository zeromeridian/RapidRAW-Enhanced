# Looks Browser Plan (presets, profiles, LUTs)

Owner request 2026-11-27: presets and LUTs get groups (folders), a list
and a thumbnail layout and favourites; profiles, presets and LUTs let you
pick a group when you create one. "The idea is to make all these more
flexible and consistent." Plan item 86 (`UPSTREAM_FEATURE_GAP.md`).

## Today (code check 2026-11-27 on `db871d4e`, read-only)

| | Profiles (`Profile.tsx`) | Presets (`PresetsPanel.tsx`) | LUTs (`LUTControl.tsx`) |
|---|---|---|---|
| Groups | one level, `group` string in each profile file (`custom_profile.rs`) | one level of folders in `presets/presets.json` (`PresetItem::Folder`, `file_management.rs`), drag and drop, collapsible | none: flat `luts/` folder (`list_luts_in_dir`) |
| Group on create | free-text field (`CreateProfileModal`) | none: `ConfigurePresetModal` asks name and settings; move by dragging | none: Save LUT asks a name only |
| Layout | grid (3 columns, previews) or list (names only), `profileBrowserGrid` | list with 80×56 previews only | grid (3 columns, previews) only |
| Favourites | `favoriteProfiles` (ids) in settings, a Favorites section first | none | none |
| Group management | none (a group exists while it has a profile) | rename, delete, new folder (context menu) | none |

Previews: profiles and LUTs share `generate_lut_previews` (square
swatches of the open photo); presets have their own preview generator.
Back Up (`settings_backup.rs`) already copies `presets/`, `luts/`
(including subfolders) and `profiles/` with `settings.json`, so all of
this travels with a backup. Groups, favourites and layout are library
organisation, not edits: no XMP change.

## Goal: one browser, three kinds

The same behaviour in all three, from shared code:

1. **Sections:** Favorites first (only if any), then each group in name
   order, then ungrouped; a favourite also stays in its group (as
   Adobe's Profile Browser and today's profile list). Every section
   collapses; the open/closed state is remembered per browser.
2. **Two layouts**, a switch at the top, remembered per browser:
   **Grid** (3 columns of square previews, name below) and **List**
   (small preview, name, details). Profiles' list gains previews;
   presets gain the grid.
3. **Favourite star** on hover, filled when set (today's profile star).
   Stored in settings as `favoriteProfiles` (kept), `favoritePresets`
   (preset ids), `favoriteLuts` (file paths relative to `luts/`).
4. **Group picker** wherever one is created or saved: Create / Update
   Profile, Create Preset and Update Preset, Save LUT, and the import
   dialogs: a dropdown of the existing groups plus "New Group…" and
   "No Group". Replaces the free-text field in Create Profile.
5. **Move to Group ›** in each item's right-click menu (all three);
   presets keep drag and drop. **Group right-click:** Rename Group,
   Delete Group (asks; its items move to "No Group", decision L3), for
   all three.
6. **One place to browse: the Looks tab** (L6–L8). Develop's Presets
   tab becomes **Looks**, with a **Presets · Profiles · LUTs** switch at
   the top (remembered), a name search for the shown kind, the
   grid/list switch, **＋** (create the shown kind) and import. Hover
   previews a profile or LUT on the photo (as today's tool lists do);
   a click applies it, and the active item shows its strength slider
   under it (preset Amount, profile Amount, LUT Intensity). Those
   sliders are the tools' own controls on the same adjustment keys, so
   moving one moves the other.
7. **Tool rows choose nothing themselves** (L7). Basic → Profile keeps
   the name field, ✕, Amount, and Save to Profiles / Update; Look → LUT
   keeps the name field, ✕ and Intensity. The lists that unfold there
   today are removed. Clicking the name opens Looks on that switch,
   scrolled to the current item, with a **‹ Back to Adjustments** pill
   that returns to the tool panel you came from (`lastEditingPanel`).

## Design

- **Shared frontend** (new `src/components/ui/LooksBrowser/`):
  `BrowserSection` (collapsible header), `BrowserViewSwitch`,
  `BrowserTile` / `BrowserRow` (preview, name, star, badges such as
  B&W or the presets' masks/crop icons), `GroupPicker`, and a
  `useBrowserFavorites(settingsKey)` hook in place of the profile's own
  toggle. Profile, LUT and Presets panels keep their own data, preview
  loading and actions; they pass items and handlers in. Presets keep
  dnd-kit and their inline Amount slider (shown under the active item in
  both layouts).
- **Profiles:** no storage change (`group` already exists); the group
  picker and Move to Group reuse `rename_custom_profile` (it already
  moves to a group); Rename / Delete Group loop over that command or get
  one batch command.
- **Presets:** no format change (one level of folders already); Create
  Preset gets a target folder (`save_presets` already takes the tree;
  the frontend places the preset), favourites by preset id.
- **LUTs:** groups as one level of **subfolders** of `luts/` (L1, L2). `list_luts` lists `luts/` and its subfolders and returns a
  `group` per entry; import, Save LUT and Move to Group write into the
  chosen subfolder; Rename / Delete Group rename or remove a subfolder.
  Edits since `1.115.1` embed the table (`lutData`), so moving a LUT
  never changes their look; older edits hold only `lutPath`, so a path
  that no longer exists falls back to a LUT with the same file name
  anywhere in `luts/` (`get_or_load_lut`).
- **Looks tab:** `Panel.Presets` keeps its internal value (`'presets'`,
  so saved panel state and the `toggle_presets` keybind stay valid);
  only its label changes to Looks (right-panel switcher, menu bar Tools
  entry, Settings → Keybinds). A new `LooksPanel` holds the switch and
  shows the Presets, Profiles or LUTs browser; the kind shown is in the
  UI store (`looksKind`) so a tool row can open the tab on its kind.
  Profile and LUT browsing (previews, hover preview, select, right-click
  actions, Create / Import) move from `Profile.tsx` and `LUTControl.tsx`
  into their browsers; the tool rows keep what adjusts the photo.
  Profiles are not offered for masks today; LUTs keep whatever masks
  use now (checked when phase 3 starts).

## Phases (one MINOR each)

1. **Shared browser, Looks tab, presets:** the shared components; the
   Presets tab becomes Looks with its switch (Profiles and LUTs show
   their current lists there until their phase); presets get the grid,
   Favorites, search, group picker in Create / Update Preset, Move to
   Group.
2. **Profiles in Looks:** the profile browser on the shared components
   (list with previews, collapsible sections, group picker in Create /
   Update, Move to Group, Rename / Delete Group); Basic → Profile
   becomes the slim row that opens Looks, with the Back pill.
3. **LUTs in Looks:** subfolder groups (Rust: `list_luts`, import, Save
   LUT, move, group rename/delete, the by-name fallback; tests), list
   layout, favourites, group picker in Save LUT and Import; Look → LUT
   becomes the slim row.
4. **New Look dialog** (L9): one dialog from Looks' ＋ for all three
   (Type: Preset / Profile / LUT, Name, Group, one settings tree whose
   sections are the profile bake groups), replacing
   `ConfigurePresetModal` and `CreateProfileModal`. Until then each
   dialog only gains the group picker.

Order note: phase 1 starts with presets (the tab they already own), so
the Looks tab exists before profiles and LUTs move in; phases 2 and 3
can swap.

Each phase: Clippy gate when Rust changes, `tsc`/ESLint against `HEAD`,
English strings only (`en.json`, listed under "Pending translations").

## Owner decisions (2026-11-27)

- **L1 LUT groups are subfolders of `luts/`** (not a `groups.json`
  index): visible and editable in Finder/Explorer, a LUT pack can be
  imported as a folder; old path-only edits find a moved LUT by file
  name.
- **L2 One level of groups everywhere** (as LrC preset groups and ACR
  profile groups); no nesting.
- **L3 Delete Group moves its items to "No Group"**; nothing is
  deleted with the group.
- **L4 Scope: these three browsers only.** Tone curve and Orbit Blend
  Pad presets (`NamedPresetBar`) and export presets stay as they are.
- **L5 Plan item 86, after item 69** (first planned before 69's
  Windows/Linux bar; owner 2026-11-27 later: finish the menu work
  first). Same batch branch
  (`dev/menu-bar-entries`, owner rule: never two unmerged branches),
  one commit per phase.
- **L6 One Looks tab** for presets, profiles and LUTs (not three
  browsers that only share a design).
- **L7 The tool rows' unfolding lists are dropped;** the name opens
  Looks.
- **L8 The tab is called Looks;** the key stays P.
- **L9 One New Look dialog, as the last phase.**

## Progress

- 2026-11-27: owner request; code check and this plan; decisions L1–L5,
  then the Looks tab (L6–L9, owner's follow-up: "Profiles, LUTs and
  presets are in 3 different places").
- 2026-11-27: **phase 1 built as `1.121.0`** on `dev/looks-browser`
  (L5's batch branch `dev/menu-bar-entries` was merged meanwhile, so a
  new one from `develop` `9c8a414b`), not committed. Shared parts in
  `src/components/ui/LooksBrowser/`: `useLooksBrowser(kind)` (one hook
  for favourites, grid/list and section open state, keyed in
  `BROWSER_SETTINGS`; Basic → Profile already uses it), `BrowserSection`,
  `BrowserViewSwitch`, `BrowserItem.tsx` (`BrowserTile`, `BrowserRow`,
  `BrowserItems`, which puts the active item's slider under it or under
  its grid row), `GroupPicker` (`GroupChoice`: none / existing / new).
  `LooksPanel` + `LooksHeader` (kind in settings as `looksKind`, not the
  UI store, so it survives restarts); Profiles and LUTs show
  `ProfilePanel` and the new `LutTool` until phases 2–3. Settings:
  `favoritePresets`, `presetBrowserGrid` (default list, as before),
  `looksKind`, `looksSections` (`kind:section` → open). Choices made
  while building (owner may revise): presets' groups keep their stored
  order (drag to reorder, Sort All) rather than name order; folders start
  closed as before, Favorites and No Group open; No Group's header shows
  only beside other sections; a search opens every section with
  matches; grid previews are the existing preset previews cropped
  square; the list's details line is the settings count; a group's
  right-click also offers New Preset in that group.
