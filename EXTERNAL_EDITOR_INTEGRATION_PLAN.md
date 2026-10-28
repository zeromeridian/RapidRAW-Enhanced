# External Editor Round Trip and Photo Craft Integration Plan

## Status

Proposal only, written 2026-10-27 at the owner's request; no code has been
changed. Nothing here is decided until the owner answers the questions in
"Owner decisions". Revise this file as phases land, and record shipped
behaviour in `FEATURES.md` and `RELEASE_NOTES.MD`.

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

## Current implementation

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
| TIFF exports carry no ICC profile                          | `export_processing.rs` embeds `SRGB_ICC_PROFILE` for JPEG and PNG only, so editors must guess the colour space of the round-trip TIFF |
| No "edit the existing copy" path                           | Running **Open in** on a `_thisisraw-edit` file renders a new copy of it instead of reopening it                                      |

## Photo Craft facts (v0.16.0)

From its README and `docs/control-protocol.md`:

- An open-source (MIT or Apache-2.0) reimplementation of Photoshop in pure
  Rust (egui UI, wgpu compositor), in early alpha. Builds exist for macOS,
  Windows, Linux, and FreeBSD.
- It reads and writes PSD/PSB (8/16/32-bit, CMYK, Lab) and layered TIFF, and
  reads XCF, Krita, OpenRaster, Paint.NET, and Affinity files. It lists no
  camera RAW formats; its sibling app, LightCraft, covers RAW development.
- It opens a file passed as a command-line argument (`photocraft image.psd`).
- `photocraft-cli` provides `run`, `batch`, `serve` (headless, stdio or TCP),
  and `mcp`.
- The desktop control channel is `photocraft --control <port>
--control-token-file <path>`. It speaks newline-delimited JSON over
  `127.0.0.1` and needs a 256-bit token (`auth` as the first request). Its
  methods include `app.open {path}`, `app.save {path?}`, `app.quit`, and
  `ui.*`. Opens and saves are confined to
  `--automation-read-root`/`--automation-write-root`.
- The control channel has **no save or close notifications** and no
  protocol version. `file.saveAs` and `file.saveACopy` are refused. Idle
  connections close after 30 s.
- Plug-in compatibility is listed as a gap, and there is no
  external-raw-processor setting.

Implications:

- 16-bit TIFF is the right handoff format. Photo Craft keeps its layers in
  the TIFF, and ThisIsRAW, which cannot read PSD, displays the flattened
  image a Photoshop-style layered TIFF stores in its main image.
- Detecting saves must rely on the file system. The control channel cannot
  report them.

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
6. **Colour profile.** Embed the sRGB ICC profile in TIFF exports, which
   also fixes normal TIFF exports. Optionally add a wide-gamut 16-bit
   working space for round trips; that needs a decision.
7. **Shared session recovery.** Because sessions live in the catalog, a
   restart resumes watching, and a save made while ThisIsRAW was closed is
   promoted on the next launch.

Reuse: `ExportImages` and its `isExplicitFilePath` mode,
`open_external_editor`, `get_file_modification_stamp`'s logic (moved into
the manager), `autoStackCreatedImages`, the `thumbnail-generated` event
path, and the existing atomic-write helper in `lightroom_xmp.rs`
(`write_metadata_atomically`, which `CODE_AUDIT_FINDINGS.md` item 1 already
proposes to share).

Cross-platform: staging uses the Tauri app cache directory on all three
platforms, and promotion is a copy (sources may be on another volume). On
Windows, the editor may still hold the staging file open; the copy only
reads it, and a failed read is retried on the next poll.

### Phase 2 — Photo Craft as a first-class editor

1. **Ready-made editor entry.** Offer Photo Craft in Settings → External
   Editors when it is found: `/Applications/PhotoCraft.app` on macOS,
   `photocraft` on `PATH` for Linux, the standard install location on
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

1. **Staging folder (recommended) or a hidden file beside the original.**
   Staging leaves nothing behind for abandoned edits.
2. **Photo Craft's Save on an opened TIFF.** Verify whether Cmd/Ctrl+S writes
   back to the TIFF or asks for a PSD. If it saves a PSD, either the session
   watches the folder for any saved file, or ThisIsRAW gains PSD reading
   (Photo Craft's standalone PSD crate is MIT/Apache).
3. **Single instance.** Verify whether launching Photo Craft with a file
   while it is running opens the file in the existing window.
4. **File-name suffix.** Keep `_thisisraw-edit` or adopt Lightroom's `-Edit`.
5. **Round-trip colour space.** sRGB only, or also a wide-gamut 16-bit
   option.
6. **Retention** for unsaved sessions (proposed: 7 days).

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
