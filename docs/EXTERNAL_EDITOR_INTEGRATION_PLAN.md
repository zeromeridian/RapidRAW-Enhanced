# External Editor Round Trip and Photo Craft Integration Plan

## Status (revised 2026-11-14)

- **Steps 1–4 shipped** (`1.25.2`–`1.28.0`, plus **Open in** on the Develop
  canvas in `1.29.1`) and are in `develop`. None has been checked hands-on
  by the owner yet (checks below).
- **Upstream borrowings** (`1.48.0`, 2026-11-13, Plan item 12, on
  `dev/edit-in-borrowings`): saves in a subfolder of the staging folder
  count, and an editor that quits with an error within 10 s of starting
  ends its session with an error toast. Not yet checked hands-on.
- **Step 5, RAW integration (Phase 3): deferred.** Before starting it,
  document and test the `--edit` exit codes.
- **Linux Flatpak: deferred** by the owner (2026-11-02); see "Deferred:
  Linux Flatpak".
- **Every way of saving** (`1.56.2`, 2026-11-14, Plan item 15, on
  `dev/editor-copies`, uncommitted): each image saved in the staging
  folder (the render, a Save As to another name or format, a subfolder)
  gets its own copy beside the source, named as it was saved (`-2`, … when
  taken); saving it again replaces only that copy; several saves in one
  poll are all promoted. Sessions now keep every handled file in the
  catalog table `editor_round_trip_files`; sessions from older versions
  load as one file. Decision 3 (window or tab) needed no change. Not yet
  checked hands-on.
- **Wide-gamut option (decision 5): moved to the GPU epic** by the owner
  (2026-11-14), `UPSTREAM_FEATURE_GAP.md` item 19b. The render clamps to
  sRGB right after tone mapping, so a ProPhoto TIFF today would hold only
  sRGB colours.
- **Known gap:** a copy that is open in Develop does not reload when the
  editor saves it again.

**Owner rule (2026-11-01):** update this file and `HANDOFF.md` after every
edit to this work. Shipped behaviour goes into `FEATURES.md` and
`RELEASE_NOTES.MD`. The full per-step implementation and validation log is
in `HANDOFF-ARCHIVE.md` ("Superseded EXTERNAL_EDITOR_INTEGRATION_PLAN.md
progress", 2026-11-10).

### What each step shipped

1. **TIFF colour profile and shared safe write** (`1.25.2`): TIFF exports
   embed the sRGB ICC profile; `file_management::write_file_atomically` is
   shared.
2. **Round-trip sessions** (`1.26.0`, `editor_round_trip.rs`): **Open in**
   renders `<app cache>/external-edits/<uuid>/<stem>-Edit.<tif|jpg>` and
   opens the editor; a watcher (1.5 s) promotes each settled save to
   `<stem>-Edit.<ext>` beside the source (`-Edit-2`, … when taken) and adds
   it to the Library, stacked; sessions survive restarts (catalog table
   `editor_round_trips`).
3. **Cleanup and Edit Original** (`1.27.0`): a session ends after 7 days
   without a new save; Settings → Data Management → **Clear External Edit
   Copies**; **Open in → Original File** edits a non-RAW file itself.
4. **Photo Craft entry** (`1.28.0`): Settings finds Photo Craft (macOS
   Applications folders, Windows Program Files and `%LOCALAPPDATA%\Programs`,
   Linux `PATH`) and offers **Add**; each editor has a preferred format
   (TIFF, JPEG, or ask); **Open in** lists editors first.

### Owner hands-on checks still pending

- Step 1: `sips -g profile` on an exported TIFF shows sRGB; Photoshop or
  Photo Craft shows sRGB; Import Lightroom Edits still applies.
- Step 2: abandon an edit (nothing left behind); save, then save again;
  save while ThisIsRAW is closed; two edits at once; recursive view;
  auto-stacking off.
- Step 3: Clear External Edit Copies with an edit open; Original File on a
  `-Edit.tif`, save, the thumbnail refreshes; Original File disabled for a
  RAW. (Expiry after 7 days is covered by unit tests only.)
- Step 4: with Photo Craft in `/Applications`, Settings shows it found,
  **Add** works and the menu shows `Photo Craft (TIFF)`; changing the
  format changes the menu; an older settings file without formats still
  loads. Windows and Linux detection need a check on those machines.

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
   `photocraft` on `PATH` on Linux (the Flatpak `ai.storyteller.photocraft`
   is deferred, see "Deferred: Linux Flatpak"), the per-user or all-users
   `ArtCraft\PhotoCraft` folder on Windows. Default its format to 16-bit
   TIFF (owner decision 7).
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
2. **Decided 2026-11-10: handle every way the editor saves** (no hands-on
   test needed). The session promotes any supported image saved into the
   staging folder, whether Save writes back to the TIFF or Save As picks a
   new name or format. A PSD-only save is still not picked up, because
   ThisIsRAW cannot read PSD (Photo Craft's MIT/Apache PSD crate would be
   the way to add it if wanted).
3. **Decided 2026-11-10: assume nothing about windows.** Whether the editor
   opens the copy as a new tab or a new window must not matter to the
   session.
4. **Decided 2026-11-01: Lightroom's `-Edit` suffix** (`<stem>-Edit.tif`,
   collision-safe as `<stem>-Edit-2.tif`, …), replacing
   `_thisisraw-edit-<timestamp>`. Existing `_thisisraw-edit` files are left
   as they are.
5. **Decided 2026-11-10: sRGB plus a wide-gamut option.** sRGB stays the
   default; each editor can choose a 16-bit ProPhoto RGB TIFF instead, as
   Lightroom Classic offers. **2026-11-14 (owner): deferred to the GPU
   epic** (item 19b), because the pipeline clips to sRGB before output.
6. **Decided 2026-11-01: keep unsaved sessions for 7 days.**
7. **Decided 2026-11-02: a preferred format per editor.** Each configured
   editor stores TIFF, JPEG, or "ask each time"; Photo Craft defaults to
   TIFF.
8. **Decided 2026-11-02: defer the Linux Flatpak.** Step 4 detects only a
   `photocraft` executable on `PATH`. See "Deferred: Linux Flatpak".

## Deferred: Linux Flatpak

Not implemented; the owner deferred it on 2026-11-02. Supporting the
Flatpak `ai.storyteller.photocraft` needs all three:

1. **Detection:** `flatpak info ai.storyteller.photocraft` (or the exported
   `.desktop` file under `/var/lib/flatpak/exports` or
   `~/.local/share/flatpak/exports`).
2. **Launch:** `flatpak run ai.storyteller.photocraft <file>`. Today
   `open_external_editor` requires the editor path to exist on disk, so it
   needs a Linux-only launch form for a Flatpak app ID.
3. **Staging:** the Flatpak can read only `xdg-documents` and
   `xdg-pictures`, not ThisIsRAW's app cache, so its sessions must stage
   under `~/Pictures/.ThisIsRAW External Edits/` (owner decision 1's
   fallback, still unconfirmed). Cleanup and Clear External Edit Copies
   must cover that folder too.

Until then, a Flatpak user can add the editor by hand only if it is also
installed another way, and the round trip will not work with the Flatpak
build.

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
