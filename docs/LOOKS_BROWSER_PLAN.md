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

## Phases (one MINOR each)

1. **Shared browser + profiles:** the shared components; the profile
   browser moves onto them (list with previews, collapsible sections,
   group picker in Create / Update, Move to Group, Rename / Delete
   Group).
2. **LUTs:** subfolder groups (Rust: `list_luts`, import, Save LUT,
   move, group rename/delete, the by-name fallback; tests), list layout,
   favourites, group picker in Save LUT and Import.
3. **Presets:** grid layout, Favorites section, group picker in Create /
   Update Preset, Move to Group in the right-click menu, collapsible
   state remembered.

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
- **L5 Plan item 86, next:** started right after the `1.119.0` menu
  entries, before item 69's Windows/Linux bar. Same batch branch
  (`dev/menu-bar-entries`, owner rule: never two unmerged branches),
  one commit per phase.

## Progress

- 2026-11-27: owner request; code check and this plan; decisions L1–L5.
  No code yet.
