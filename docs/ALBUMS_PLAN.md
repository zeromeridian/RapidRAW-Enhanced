# Albums Plan (Plan items 75–78)

More power for albums, closer to Lightroom Classic's collections: an easier
New Album, drag and drop, a target album, album export (rendered or as a
copy), SFTP upload, and smart albums. Owner request and decisions
2026-11-26. Plan entries: `UPSTREAM_FEATURE_GAP.md` items 75–78. Each item
is its own MINOR on its own `dev/…` branch from `develop`.

## Owner decisions (2026-11-26)

1. **Order:** item 75 (New Album, drag and drop, target album) → item 76
   (album export) → item 77 (SFTP upload) → item 78 (smart albums, with
   item 70's saved filter presets).
2. **New Album** is reachable without a right-click: a "+" on the Albums
   section header and a keybind.
3. **Drag and drop:** photos dropped on an album are added to it. Album
   groups do not accept drops.
4. **Target album key:** a free, rebindable key. B stays Show Original.
5. **Copy export** copies the **original files only** (no XMP, no `.tirdata`,
   no Edit In files). **Virtual copies are skipped** in a copy export.
6. **Rendered album export** (JPEG, TIFF, …) **includes virtual copies**,
   like any export.
7. **Remembered settings:** only an album with an upload target remembers
   its export preset and destination (like an LrC published collection).
   Local exports are set up each time.
8. **Upload:** SFTP only. No plain FTP (it sends the password unencrypted),
   no FTPS, WebDAV, S3 or photo-site APIs for now. Immich stays Not wanted
   (owner 2026-11-10).
9. **Sign-in:** SSH keys through ssh-agent, or a password typed once per
   app session and kept in memory only. Passwords are never stored.
10. **Smart album scope:** all library folders, from the first version.
11. **Smart album rules:** LrC-style rows with Match all / any / none and
    nested groups, in **one rule format shared with item 70** (saved Library
    filter presets).
12. **First-version rule fields:** rating, flag, colour label, keywords,
    file name, file type, has edits, is in album, is in folder. No EXIF or
    date rules yet (can come later on the same index).

## How Lightroom Classic does it (reference)

- **Collections panel "+"**: Create Collection, Create Smart Collection,
  Create Collection Set. The Create Collection dialog has Location (inside a
  set) and options Include selected photos, Make new virtual copies, Set as
  target collection.
- **Target collection:** right-click a collection → Set as Target
  Collection; its name gets a "+". B adds the selection to it, or removes
  photos already in it. The Quick Collection is the default target. Smart
  collections cannot be targets.
- **Drag and drop:** dragging photos onto a collection adds them; smart
  collections and collection sets don't accept drops.
- **Smart collection:** "Match [all / any / none] of the following rules";
  Alt/Option-click on "+" adds a nested group with its own all/any/none.
  Members update live as photos change.
- **Publish services** (for item 77's remembered target): a collection
  bound to a service and settings; changed photos are marked for
  republishing.

## Code check (2026-11-26)

- **Storage:** `AlbumItem` (`file_management.rs`, serde-tagged `Album` /
  `Group`) in one `albums.json` in the app data folder (`get_albums_path`).
  Writes are serialized since item 34c (`lock_albums`, `read_albums`,
  `write_albums`). The frontend saves the whole tree (`SaveAlbums`); the
  backend adds paths with `AddToAlbum` (no duplicates) and follows renames
  and moves with `sync_album_path_changes`. Virtual copies are stored as
  `?vc=` paths. Albums are not in XMP; that matches LrC (collections live in
  the catalog), so nothing here touches XMP or presets.
- **Album view:** `handleSelectAlbum` (`useAppNavigation.ts`) →
  `get_album_images`. View prefixes in `utils/libraryViews.ts`
  (`ALBUM_VIEW_PREFIX`, `isCollectionView`).
- **Creating:** only the Albums section's right-click
  (`handleAlbumTreeContextMenu`, `useAppContextMenus.ts`) →
  `isCreateAlbumModalOpen` / `isCreateAlbumGroupModalOpen` →
  `handleCreateAlbumItem(name, type)` (`App.tsx`, `AppModals.tsx`). The
  Albums `SectionHeader` (`FolderTree.tsx`) has no button; other sections
  already show hover buttons (`showHeaderButtons`).
- **Dragging:** thumbnails start a drag with
  `writeLibraryDragPayload(…, { kind: 'files', paths })`
  (`LibraryItems.tsx`); folder nodes read it with `readLibraryDragPayload`
  and **move** files (`onDropFiles`). `AlbumTreeNode` has no drop handler.
- **Keys:** B = `show_original` (`keyboardUtils.ts`). Free today: Shift+B,
  Cmd/Ctrl+N.
- **Export:** `export_images(paths, …)` (`export_processing.rs`) takes any
  list of paths, with `ExportSettings`, presets (`ExportPresetsList`,
  `appSettings.exportPresets`) and conflict handling that never overwrites
  unasked (`ExportConflictModal.tsx`). `ExportPanel.tsx` exports
  `pathsToExport` = `multiSelectedPaths` in the Library. No copy-originals
  mode, no upload.
- **Library-wide data:** `keyword_index.rs` already walks every library
  root (`library_roots`, `scan_scopes`, own 4-thread pool), stamps each
  sidecar and XMP (`index_stamp`), reads each photo's metadata
  (`read_entry` → `load_sidecar` + `sync_metadata_from_xmp`) and keeps only
  keyword tags (`keyword_tags`) in `keyword_index_files` /
  `keyword_index_tags` (`library_catalog.rs`). Flags and colour labels are
  tags too (`color:…`, `utils/imageFlags.ts`), and the sidecar holds rating
  and adjustments, so the same pass can record everything item 78 needs.
- **Filters:** `utils/libraryFilters.ts` (rating, flags, colours, file
  types, edit state), `utils/metadataFilter.ts` (item 63's bar), search
  (`ADVANCED_QUERY_REGEX`, `useSortedLibrary.ts`).
- **Network:** `reqwest` with `rustls` is already a dependency. No SSH
  crate.
- **Upstream (v1.7.0, up to `3bb44170`):** no smart albums, target album or
  album export. Drag to album and album export exist only inside the Immich
  integration (`bca01587`, `50fa28c1`), which is Not wanted. Nothing to
  port; keep `AlbumItem` and `albums.json` as upstream has them.

## Item 75: New Album, drag and drop, target album

**New Album**
- Hover "+" on the Albums header (same style as the other section header
  buttons) with New Album, New Album Group and, from item 78, New Smart
  Album. Right-click entries stay.
- Keybind `new_album`, default Cmd/Ctrl+N, Library section, rebindable;
  also in the menu bar's Library menu (item 69, `menuBar.ts`).
- The create dialog gains, for albums: **Include selected photos** (on by
  default when photos are selected, hidden when none) and **Set as target
  album**. The new album goes inside the group that was right-clicked, as
  today; from the "+" it goes to the top level.

**Drag and drop**
- `AlbumTreeNode` accepts the `files` payload on albums only: highlight on
  drag over, `dropEffect = 'copy'`, drop → `AddToAlbum` → refresh
  `albumTree`, toast with the number added ("3 photos added to Travel";
  "already in the album" when none were new). Folder drops keep moving
  files; the cursor and highlight must make the difference clear.
- Groups, smart albums (item 78) and the `folders` payload are refused
  (`dropEffect = 'none'`).
- Dropping virtual copies adds the `?vc=` paths, as the context menu does.

**Target album**
- Album right-click → **Set as Target Album** / **Clear Target Album**.
  The target shows a "+" after its name in the tree. One target at a time;
  none by default (there is no Quick Collection).
- Keybind `toggle_target_album`, default **Shift+B** (free; rebindable):
  adds the selection to the target, or removes it when **every** selected
  photo is already in it (LrC's toggle). Toast says which. With no target,
  the toast says how to set one.
- Also a photo right-click entry "Add to Target Album" and a menu bar
  entry (item 69).
- Stored as `targetAlbumId` in settings. Cleared when that album is
  deleted (and checked at load against the tree).

**Saving and compatibility:** no change to `albums.json`'s shape. New
strings in `en.json` only (porting rule on translations).

## Item 76: Export album

- Album right-click → **Export Album…** opens the export panel with the
  album's photos as the export set (an explicit source list beside
  `pathsToExport`, so the selection is not changed), title showing the
  album name and count. Also from the menu bar (item 69).
- **Mode switch** in the panel when the source is an album:
  - **Export** (default): the normal rendered export with every current
    setting and preset. Virtual copies are included.
  - **Copy originals**: copies each original file unchanged to the chosen
    folder. No sidecars, no XMP, no Edit In files. Virtual copies are
    skipped; the final toast says how many were skipped. The file settings
    (format, size, quality, watermark, metadata) are hidden; destination,
    subfolder and Keep folder structure stay. Name clashes go through the
    same conflict handling as export (never overwrite unasked). A photo
    whose original is missing or a cloud placeholder is reported, not
    fatal.
- The copy mode is new backend code (a small `copy_originals` command
  next to `export_images`, same progress events and cancel) rather than a
  flag inside the render path.
- Destination and preset are not remembered per album (decision 7); the
  panel keeps its usual last-used settings.

## Item 77: SFTP upload

- An album can have an **upload target**: host, port, user, remote folder,
  sign-in method (SSH key through ssh-agent, or password), export preset,
  and what to do with existing remote files (skip / replace / rename, the
  same choices as export conflicts). Set in a dialog from the album's
  right-click (**Set Up Upload…**); the album shows an upload icon.
- **Upload Album** renders the photos with the album's preset into a
  temporary folder, uploads them, then deletes the temporary folder
  (also after a failure or cancel). Progress and cancel like export.
- **Security (owner priority; speed is secondary):**
  - Library: `russh` + `russh-sftp` (pure Rust, same code on macOS, Linux
    and Windows). Do not use `ssh2` (C libssh2 and OpenSSL on Linux). Check
    the crates' current versions, licences and maintenance before adding.
  - Host keys checked against `~/.ssh/known_hosts`. Unknown host: show the
    key's SHA-256 fingerprint and ask before trusting; a changed key is an
    error that names the host, never a prompt to accept. Trusted keys
    added by the app go to the app's own known-hosts file, not the user's.
  - Sign-in: ssh-agent (`SSH_AUTH_SOCK`) first. A password, if chosen, is
    asked once per app session, kept in memory only, and dropped on quit.
    Nothing secret is written to settings, logs, toasts or error messages.
    No keychain (decision 9), so no Linux Secret Service dependency.
  - Each file is written as `name.part` and renamed when complete, so a
    broken upload never leaves a half file under the real name. Remote
    paths are built from the album's remote folder and the export file
    name only; reject `..` and absolute names.
  - Upload targets live in settings (no secrets in them). Older builds
    ignore the field.
- **Windows:** ssh-agent on Windows is a named pipe (OpenSSH agent) or
  Pageant; it must compile and fail clearly if it can't connect. macOS and
  Linux are the tested platforms.
- **Not in this item:** marking changed photos for republishing (LrC's
  "Modified Photos to Re-Publish"); a later item if wanted.

## Item 78: Smart albums

**Rules**
- LrC-style editor: "Match all / any / none of the following rules", rule
  rows (field, operator, value), "+" adds a row, Alt/Option-click "+" adds
  a nested group with its own all / any / none.
- Fields and operators (first version):
  - Rating: is, is not, ≥, ≤ (0–5).
  - Flag: is Pick / Rejected / Deferred / Unflagged.
  - Colour label: is, is not, none.
  - Keywords: contains, contains all, does not contain, is empty (user
    keywords; AI tags as in the Keyword List).
  - File name: contains, starts with, ends with, is.
  - File type: is RAW / JPEG / TIFF / … (the Quick Filter's types,
    `libraryFilters.ts`).
  - Has edits: yes / no (same test as the edit-state filter).
  - In album: is / is not a chosen album (plain albums only, so no loops).
  - In folder: is within a chosen folder (including subfolders).
- **One rule format with item 70:** a versioned JSON (`{ version, match,
  rules: [ … | { group } ] }`) in one module used by smart albums and by
  item 70's filter presets, so a filter preset can later become a smart
  album and back. Evaluate with the same helpers as the Library filters
  (no second parser), so a rule and its Quick Filter match the same photos.

**Library-wide index**
- Widen `keyword_index.rs` into the library metadata index rather than a
  second scanner: the same roots, stamps, pool and events, also recording
  per photo (and virtual copy) rating, flag, colour label and has-edits
  (file name, type and folder come from the path). Existing tables keep
  serving the Keyword List. Bump the catalog's index version so the first
  launch rescans; the catalog stays a disposable acceleration index
  (`LARGE_LIBRARY_BACKGROUND_SCANNING_PLAN.md`: no full scans on the UI
  path, external disks not spun up more than today, item 71's launch
  behaviour kept).
- Changes made in the app update the index at once (as `record_tags`
  does for keywords); changes made outside are picked up by the stamps on
  the next scan.
- While a scan is running, a smart album shows what is indexed so far
  with "Reading library… N left", as the metadata bar does.

**Saving and compatibility**
- Smart albums are saved in their **own file**
  (`albums/smart_albums.json`, versioned), not as a new `AlbumItem`
  variant: an older build would fail to read the whole `albums.json` and
  show no albums. A smart album can sit inside a group: its own record
  stores the parent group's id (the group's `children` are unchanged), and
  the tree merges the two files when it is drawn. An older build shows the
  plain albums and simply no smart albums. Deleting a group moves its
  smart albums to the top level.
- In the tree: own icon, live count, open view like an album
  (`ALBUM_VIEW_PREFIX` path or a new `Smart: ` view prefix in
  `libraryViews.ts`, counted as a collection view, so import and paste
  stay off). Right-click: Edit Smart Album…, Rename, Duplicate, Delete,
  Export Album… (item 76). No drops, no target, no Remove from Album.
- Renamed or moved photos need no sync: membership is computed.

## Open points (ask one at a time when each item starts)

- Item 75: does Include selected photos default to on? (Proposal: on
  when photos are selected.)
- Item 77: one upload target per album, or reusable targets (servers)
  picked per album? (Proposal: reusable servers, album picks one plus a
  remote folder.)
- Item 78: should a smart album's "In folder" rule list only library
  roots and their subfolders? (Proposal: yes.)
- Item 78: EXIF and date rules: when? (Owner 2026-11-26: not in the first
  version.)

## Validation (beyond `AGENTS.md`)

- Item 75: drop on album, on group (refused), on folder (still moves);
  Shift+B add, remove, no target; delete the target album.
- Item 76: rendered export of an album with virtual copies (all exported,
  names per item 34a); copy mode skips virtual copies and reports them;
  clashes; missing originals.
- Item 77: a test SFTP server (OpenSSH in a local container or VM): key
  sign-in through the agent, password sign-in, unknown host prompt,
  changed host key refused, cancel mid-upload (no `.part` left under the
  real name, temp folder removed), no secret in logs.
- Item 78: rules against the Quick Filter on the same photos; a large
  library on an external disk (scan time, no extra spin-ups); an older
  build opening the albums folder still shows every plain album.
