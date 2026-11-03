# External Editor Round Trip and Photo Craft Integration Plan

## Status

In progress on branch `dev/photocraft-integration` (started 2026-11-01).
Owner decisions 1, 4, and 6 were made on 2026-11-01. Decisions 2, 3, and 5
are still open; 2 and 3 only need a hands-on check in Photo Craft.

**Owner rule (2026-11-01):** update this progress list, and `HANDOFF.md`,
after every edit to this work, so progress and the remaining tasks are
always current. Record shipped behaviour in `FEATURES.md` and
`RELEASE_NOTES.MD`.

### Progress

The steps implement the phases under "Strategy". Each one ships on its own.

1. **Step 1: TIFF colour profile and shared safe-write helper** (`1.25.2`):
   built; waiting for the owner's hands-on checks.
   - Done: TIFF exports embed the sRGB ICC profile (`TiffIccProfile` in
     `export_processing.rs`, tag 34675, UNDEFINED type).
     `file_management::write_file_atomically` is extracted from
     `lightroom_xmp.rs`, which now uses it. The two TIFF DPI tests also
     check that the profile is present, including after the metadata merge
     that **Open in** uses. Release notes, version `1.25.2`, and
     `CODE_AUDIT_FINDINGS.md` item 1 are updated.
   - Validation: `cargo fmt -p ThisIsRAW -- --check` passes; `cargo clippy
     --all-targets --all-features -- -D warnings` exits 0; `cargo test
     --lib` 105 passed (Homebrew rustc 1.97.1; the pinned 1.96.1 toolchain
     is not installed in the sandbox).
   - Built: `1.25.2-dev-photocraft-integration` `.app` (checksums in
     `HANDOFF.md`). Not yet committed.
   - Remaining: the owner's hands-on checks (`sips -g profile` on
     an exported TIFF; Photoshop or Photo Craft shows sRGB; Preview
     Lightroom Edits still applies).
2. **Step 2: backend session manager** (Phase 1.1–1.3 and 1.7; MINOR
   release `1.26.0`): built; waiting for the owner's hands-on checks.
   - Done (backend): new `src-tauri/src/editor_round_trip.rs` (named
     "round trip" so it is not confused with the reverse `--edit`
     `ExternalEditSession`). `start_editor_round_trip` renders through
     `export_images_impl` into `<app cache>/external-edits/<uuid>/<stem>-Edit.<tif|jpg>`
     (16-bit TIFF or quality-100 JPEG, metadata kept), records the rendered
     file's size and mtime, and opens the editor with
     `open_external_editor`. A failed render or launch removes the staging
     folder. Sessions are kept in memory and in the new catalog table
     `editor_round_trips` (`library_catalog::save_editor_round_trip` /
     `load_editor_round_trips`).
   - Watcher: `start_watcher`, started in the Tauri setup hook except for
     headless export, resumes sessions whose staging folder still exists,
     then polls every 1.5 s. It takes the newest supported, non-hidden image
     in the staging folder (so PSDs and editor temporaries are ignored), and
     promotes it once two polls see the same size and mtime and it differs
     from the last handled file. Promotion copies it with the new
     `file_management::copy_file_atomically` to `<stem>-Edit.<ext>` beside
     the source (`-Edit-2`, … when taken); later saves replace that copy
     unless the extension changed. It emits `editor-round-trip-saved`
     `{sourcePath, outputPath, isNew}`. A failed copy is retried on the
     next poll.
   - Also: the shared atomic-write core now gives files normal permissions
     (`0o666` minus umask on Unix) instead of owner-only `0o600`; the TIFF
     metadata writer now accepts the `.tif` extension (a `.tif` export
     previously got no EXIF); `get_file_modification_stamp` is removed.
   - Validation so far: strict Clippy exits 0; `cargo test --lib` 109
     passed (new: `editor_round_trip` ×3,
     `editor_round_trips_insert_then_update_saved_state`).
   - Done (frontend): **Open in** calls `start_editor_round_trip`
     (`Invokes.StartEditorRoundTrip`); the `editor-round-trip-saved`
     listener in `useTauriListeners.ts` adds a new copy to the open folder
     view (flat or recursive) through `get_album_images`, then calls
     `autoStackCreatedImages`; a later save drops its cached preview and
     calls `regenerate_thumbnails`. `export-complete` now refreshes the
     Library only when exports were tracked. Removed: `externalEditLaunch`,
     `externalEditWatch`, the 2 s polling effect, `ExternalEditLaunch`, and
     the `open_external_editor` and `get_file_modification_stamp` commands
     (`open_external_editor` is now backend-only). Prettier passes; no
     ESLint or `tsc` diagnostics on changed lines (two `tsc` errors in
     `useAppContextMenus.ts` exist at `HEAD`).
   - Release notes, `FEATURES.md`, and version `1.26.0` updated.
   - Final checks: `cargo fmt --check` passes, strict Clippy exits 0,
     `cargo test --lib` 109 passed.
   - Built: `1.26.0-dev-photocraft-integration` `.app` (checksums in
     `HANDOFF.md`). Not yet committed.
   - Remaining: the owner's hands-on checks
     (abandon an edit; save, save again; save while ThisIsRAW is closed;
     two edits at once; recursive view; auto-stacking off). Not handled
     yet: a copy that is open in Develop does not reload when the editor
     saves again. The Linux Flatpak staging fallback waits for owner
     confirmation.
3. **Step 3: cleanup and Edit Original** (Phase 1.4–1.5; MINOR release
   `1.27.0`): built; waiting for the owner's hands-on checks.
   - Done (backend, `editor_round_trip.rs`): a session ends once it has
     seen no new save for 7 days (`RETENTION`, measured from the last
     handled file's mtime, so an unhandled save is always promoted first),
     or when its staging folder is gone. Ending deletes only the staging
     folder and the catalog row (`library_catalog::delete_editor_round_trip`);
     promoted copies are never touched. Saved sessions expire the same way,
     after which **Edit Original** is how the copy is edited again. On
     start, staging folders that no session owns are removed once older
     than 7 days. New commands: `get_editor_round_trip_cache_size`,
     `clear_editor_round_trips` (ends every session and empties the
     staging root), and `start_editing_original` (opens a file itself,
     ends any round trip whose copy it is so a later staged save cannot
     overwrite the direct edits, and watches it in memory until quit,
     emitting `editor-round-trip-saved` with `isNew: false` after a
     settled save). Strict Clippy exits 0; `cargo test --lib` 112 passed.
   - Done (frontend): Settings → Data Management → **Clear External Edit
     Copies** (size shown, confirm dialog), sharing a new
     `useClearableCache` hook in `SettingsPanel.tsx` with the AI Denoise
     cache control, which now uses it too. **Open in → Original File →
     editor** (`Invokes.StartEditingOriginal`) is enabled only for a
     non-RAW image; the existing `editor-round-trip-saved` listener
     refreshes its thumbnail. New strings in all 12 locales. Prettier
     passes; no ESLint or `tsc` diagnostics on changed lines; the
     `i18n:check` output is identical to `HEAD`'s (pre-existing failures).
   - Built: `1.27.0-dev-photocraft-integration` `.app` (checksums in
     `HANDOFF.md`). Not yet committed.
   - Remaining: the owner's hands-on checks (Clear External Edit Copies
     with an edit open; Original File on a `-Edit.tif`, save, thumbnail
     refreshes; Original File disabled for RAW). Expiry after 7 days is
     covered by unit tests only.
4. **Step 4: Photo Craft entry** (Phase 2): not started. Adds
   `detect_external_editors` and a ready-made 16-bit TIFF entry.
5. **Step 5: RAW integration** (Phase 3): deferred. Document and test the
   `--edit` exit codes first.

## Goal

Match Lightroom Classic's **Edit in Photoshop** workflow for every configured
external editor, and integrate [Photo Craft](https://github.com/storytold/photocraft)
(checked at release `v0.16.0`) as a first-class editor:

1. Open a rendered copy of the current edit in the external editor.
2. The copy appears in the Library, stacked with its source, only once the
   user saves it in the editor. Abandoned edits leave nothing behind.
3. Later saves update the same Library image.
4. RAW integration: Photo Craft can use ThisIsRAW to develop a RAW file, the
   way Photoshop uses Camera Raw.

## Implementation before `1.26.0`

Kept for reference. Step 2 replaced the **Open in** flow and the gaps
below, except Edit Original (step 3); see "Progress".

**Open in → TIFF/JPEG → editor** (Library and Develop thumbnail menus, single
selection):

- `startExternalEdit` in `src/hooks/useAppContextMenus.ts` exports a
  full-resolution, metadata-preserving copy _beside the source_, named
  `<stem>_thisisraw-edit-<timestamp>.<tiff|jpg>` (16-bit TIFF or quality-100
  JPEG). It passes `trackCreatedImages: true`, so the copy is added to the
  Library and auto-stacked with its source straight away.
- The `export-complete` listener in `src/hooks/useTauriListeners.ts` then
  calls `open_external_editor` (`src-tauri/src/file_management.rs`). That
  launches the editor without a shell on macOS, Linux, and Windows. On macOS
  it accepts a `.app` bundle or an Adobe product folder that contains exactly
  one bundle.
- The same file then polls `get_file_modification_stamp` every 2 s for the
  one path in `useProcessStore.externalEditWatch`. On a change it reloads the
  whole folder with `refreshImageList`.
- The editors are user-managed in General Settings (`externalEditors` in
  `AppSettings`).

**Reverse protocol (ThisIsRAW as a RAW developer for another app):**

- `parse_launch_args` in `src-tauri/src/launch_request.rs` accepts
  `this-is-raw --edit <file> --output <file>`, which creates an
  `ExternalEditSession`. `useExternalEditSession.ts` opens the image in
  Develop. Finishing exports it to the caller's output path and exits the
  app, which is the Camera Raw role.
- `export <source> --output … --format … --quality …` performs a headless
  export with process exit codes (`resolve_exit_code`).

**Gaps compared with Lightroom Classic:**

| Gap                                                        | Effect                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The copy is written and catalogued before the editor opens | It appears in the Library and on disk even if never saved; abandoned edits leave `_thisisraw-edit` files next to originals            |
| One frontend watch at a time                               | Starting a second edit stops watching the first; the watch is forgotten on restart                                                    |
| A save reloads the whole folder                            | On network drives this runs `read_exif_for_paths` across the folder and can stall Develop (`CODE_AUDIT_FINDINGS.md` item 6)           |
| Only the modification time is compared                     | A refresh can pick up a file the editor is still writing                                                                              |
| No "edit the existing copy" path                           | Running **Open in** on a `_thisisraw-edit` file renders a new copy of it instead of reopening it                                      |

## Photo Craft facts (v0.19.0, checked 2026-11-01)

From its README, `docs/control-protocol.md`, `docs/development.md`,
`docs/user/guides/open-and-save-files.md`, and `apps/photocraft/src`.
Re-checked against `v0.19.0` (released 2026-11-01; `v0.17.0` and `v0.18.0`
in between). The original `v0.16.0` reading was wrong about RAW support
and did not cover single-instance launching; both are corrected below.

- An open-source (MIT or Apache-2.0) reimplementation of Photoshop in pure
  Rust (egui UI, wgpu compositor), in early alpha. Builds exist for macOS,
  Windows, Linux (including Flatpak), and FreeBSD.
- It reads and writes PSD/PSB (8/16/32-bit, CMYK, Lab) and layered TIFF, and
  reads XCF, Krita, OpenRaster, Paint.NET, and Affinity files.
- **It already develops camera RAW itself** (since before `v0.16.0`):
  `crates/raw` is a clean-room decoder for DNG, CR2, CR3, NEF, ARW, and
  others. Opening a RAW shows its own Camera Raw dialog, which reads and
  writes Adobe `crs:` `.xmp` sidecars (never beside a DNG, and never over a
  sidecar another app wrote). `v0.19.0` added encrypted Sony SR2 metadata
  and more DNG opcodes. There is still no external-RAW-processor setting.
- It opens a file passed as a command-line argument (`photocraft image.psd`).
  **Single instance:** on Windows and Linux a later launch hands its files
  to the running window as new tabs and exits (`single_instance.rs`); macOS
  does the same through LaunchServices. `--new-instance` and every
  `--control` launch opt out.
- **Save:** File › Save on an opened flat file writes back to that file in
  the format its extension names (JPEG keeps its quality). Layered saves
  go through Save As (PSD or `.pcraft`), or a TIFF with layers. Whether
  Save on a flat 16-bit TIFF prompts first still needs a hands-on check.
- **Flatpak sandbox:** the Linux Flatpak can only read and write
  `xdg-documents` and `xdg-pictures`. It cannot open a file in ThisIsRAW's
  app cache, so staging in the cache fails for the Flatpak build.
- It runs the same kind of round trip for vector smart objects
  (`external_svg.rs`, `docs/embedded-vector-editing.md`, new in `v0.17`–
  `v0.19`). It writes a private working copy to its cache, watches it off
  the UI thread, and accepts only a stable, validated save. Deleting the
  session removes the temporary folder without closing the editor. This is
  the design Phase 1 proposes.
- macOS bundle: `PhotoCraft.app`. Windows: per-user install under
  `Programs\ArtCraft\PhotoCraft` by default, or all users if chosen.
- `photocraft-cli` provides `run`, `batch`, `serve` (headless, stdio or TCP),
  and `mcp`.
- The desktop control channel is `photocraft --control <port>
--control-token-file <path>`. It speaks newline-delimited JSON over
  `127.0.0.1` and needs a 256-bit token (`auth` as the first request). Its
  methods include `app.open {path}`, `app.save {path?}`, `app.quit`, and
  `ui.*`. Opens and saves are confined to
  `--automation-read-root`/`--automation-write-root`.
- The control channel still has **no save or close notifications** and no
  protocol version (unchanged in `v0.19.0`). `file.saveAs` and
  `file.saveACopy` are refused. Idle connections close after 30 s.
- Plug-in compatibility is still listed as a gap (G16).

Implications:

- 16-bit TIFF is the right handoff format. Photo Craft keeps its layers in
  the TIFF, and ThisIsRAW, which cannot read PSD, displays the flattened
  image a Photoshop-style layered TIFF stores in its main image.
- Detecting saves must rely on the file system. The control channel cannot
  report them.
- Staging must use a folder the Linux Flatpak can reach (for example under
  `xdg-pictures`), or fall back to a hidden folder beside the source when
  the editor is the Flatpak. This affects owner decision 1.
- Phase 3 no longer has to give Photo Craft RAW support, which it already
  has. What it adds is letting the user choose ThisIsRAW's look over Photo
  Craft's own Camera Raw. Photo Craft writes `crs:` sidecars beside RAWs,
  but ThisIsRAW's XMP sync leaves sidecars written by other apps alone.

## Strategy

### Phase 1 — Lightroom-style round trip for every editor (ThisIsRAW only)

1. **Staging.** Export the copy into a per-session folder in the app cache,
   for example `<app cache>/external-edits/<session-id>/<stem>_thisisraw-edit.tif`,
   with `trackCreatedImages: false`. Nothing appears in the Library or next
   to the original yet.
2. **Backend session manager.** Add one Rust manager, kept in `AppState` and
   persisted in the existing SQLite catalog, that tracks any number of
   sessions: source path, staging path, editor, format, the promoted
   destination once one exists, and the last stamp. It replaces the frontend
   `externalEditWatch`.
   - Detect a save by polling the staging folder's modification time and
     size every 1–2 s, and act only once two consecutive readings agree
     (complete write). Polling, rather than change notifications, is
     deliberate: notifications are unreliable on SMB/NFS volumes and
     behave differently on each platform.
   - Watch the staging _folder_, not only the original file, so an editor
     that saves under a different name or extension is still noticed (see
     owner decision 2).
3. **Promotion on first save.** Copy the saved file atomically next to the
   source with a collision-safe name, the way export names files today.
   Register it through the existing `autoStackCreatedImages` path, so the
   auto-stacking settings still apply. Later saves overwrite that same
   destination atomically. Promotion emits an event that updates only that
   image's Library entry and thumbnail, not `refreshImageList`.
4. **Cleanup.** A session with no save is removed (staging folder deleted)
   after a configurable period, on app start for expired sessions, and from
   Settings → Data Management. Promoted files are never deleted.
5. **Edit the existing copy.** When the selected image is already a
   promoted round-trip file, **Open in** offers _Edit Original_ (open it
   directly, without rendering) alongside _Edit a Copy with ThisIsRAW
   Adjustments_, as Lightroom does.
6. **Colour profile.** Done in `1.25.2`: TIFF exports embed the sRGB ICC
   profile (tag 34675, UNDEFINED type), which also fixes normal TIFF
   exports. A wide-gamut 16-bit working space for round trips is still
   owner decision 5.
7. **Shared session recovery.** Because sessions live in the catalog, a
   restart resumes watching, and a save made while ThisIsRAW was closed is
   promoted on the next launch.

Reuse: `ExportImages` and its `isExplicitFilePath` mode,
`open_external_editor`, `get_file_modification_stamp`'s logic (moved into
the manager), `autoStackCreatedImages`, the `thumbnail-generated` event
path, and `file_management::write_file_atomically` (shared in `1.25.2`;
`CODE_AUDIT_FINDINGS.md` item 1).

Cross-platform: staging uses the Tauri app cache directory on all three
platforms, and promotion is a copy (sources may be on another volume). On
Windows, the editor may still hold the staging file open; the copy only
reads it, and a failed read is retried on the next poll.

### Phase 2 — Photo Craft as a first-class editor

1. **Ready-made editor entry.** Offer Photo Craft in Settings → External
   Editors when it is found: `/Applications/PhotoCraft.app` on macOS,
   `photocraft` on `PATH` or the Flatpak `ai.storyteller.photocraft` on
   Linux, the per-user or all-users `ArtCraft\PhotoCraft` folder on
   Windows. Default its format to 16-bit TIFF.
2. **Launch** through the existing `open_external_editor` with the staging
   file as the only argument. No new process code is needed.
3. **Control channel: deferred.** Revisit it when Photo Craft adds save or
   close notifications and a protocol version. It could then open files in
   an already running window, and close the session when the document is
   closed.

### Phase 3 — RAW integration (Camera Raw equivalent)

1. **Photo Craft opens RAWs through ThisIsRAW.** ThisIsRAW's side already
   exists (`--edit <raw> --output <file>`). Photo Craft needs a "Camera Raw
   handler" preference that runs `<handler> --edit <raw> --output <tmp.tif>`,
   waits for the process to exit, and opens `<tmp.tif>` if the exit code is 0. This is a small change to an MIT/Apache Rust project; propose it
   upstream to Photo Craft. Before relying on the protocol, test ThisIsRAW's
   exit codes for Done, Cancel, window close, and export failure, and document
   the protocol as a stable contract.
2. **RAW smart objects (later).** Photo Craft supports smart objects
   (`doc.replaceSmartObject`). A smart object could embed the RAW plus the
   versioned ThisIsRAW adjustment payload as XMP; reopening it would launch
   the Phase 3.1 protocol and replace the contents. This depends on Photo
   Craft maturing and is out of scope for now.

## Owner decisions

1. **Decided 2026-11-01: stage in the app cache.** Staging leaves nothing
   behind for abandoned edits. The Linux Flatpak editor cannot read the app
   cache, so it stages under the Pictures folder instead
   (`~/Pictures/.ThisIsRAW External Edits/`), as recommended. Confirm this
   fallback before implementing it.
2. **Photo Craft's Save on an opened TIFF.** The docs (`v0.19.0`) say Save
   writes back to the opened file in its own format; confirm hands-on for a
   16-bit TIFF. If the user does Save As to PSD, the session either watches
   the folder for any saved file, or ThisIsRAW gains PSD reading (Photo
   Craft's standalone PSD crate is MIT/Apache).
3. **Single instance.** Answered by the docs (`v0.19.0`): yes on every
   platform, so the file opens as a new tab in the running window. Still
   confirm hands-on on macOS.
4. **Decided 2026-11-01: Lightroom's `-Edit` suffix** (`<stem>-Edit.tif`,
   collision-safe as `<stem>-Edit-2.tif`, …), replacing
   `_thisisraw-edit-<timestamp>`. Existing `_thisisraw-edit` files are left
   as they are.
5. **Round-trip colour space.** sRGB only, or also a wide-gamut 16-bit
   option.
6. **Decided 2026-11-01: keep unsaved sessions for 7 days.**

## Validation (per phase)

- Open in Photo Craft, Photoshop, and Pixelmator Pro on macOS; Photo Craft
  and GIMP on Linux; Photo Craft on Windows (CI or a test machine).
- Abandon an edit: nothing appears in the Library or beside the source;
  staging is removed after the retention period.
- Save once, save again, then save after restarting ThisIsRAW. Each updates
  the same promoted file and its thumbnail without a folder reload.
- Two concurrent sessions on different images.
- A source folder on a network drive: no Develop stall during promotion.
- Colours match between ThisIsRAW's export and the editor's display.
- Phase 3: Done, Cancel, window close, and a failing export each return
  the documented exit code to the caller.
