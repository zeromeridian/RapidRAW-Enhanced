# Streamlined Import Plan (Lightroom Classic style)

Status: decided, not started in code (owner, 2026-11-19). Plan item 64
in `UPSTREAM_FEATURE_GAP.md`, top priority (owner 2026-11-19: before
every other Plan task). Branch `dev/streamlined-import` from `develop`
`4f67d9b6`. Four phases, one MINOR build each, each checked by the
owner before the next.

Progress:

- Phase 1 (`1.98.0`, 2026-11-19, not committed): import moved out of
  `file_management.rs` into `src-tauri/src/photo_import.rs`:
  `ImportSettings` gains `name_clash` (`ImportNameClash`: AddSuffix,
  Skip) and `month_names`; `date_subfolder` replaces the chrono-format
  replace (text kept literally, unsafe parts dropped, `MMMM` new);
  `ImportNamePlanner` gives names case-insensitively, with one number
  per shot (source folder + stem) across its extensions;
  `ImportRun::import_one` per file, errors collected; `ImportReport`
  (destination, imported, issues `NameTaken`/`Failed`/`SourceKept`,
  not started, cancelled, moved, folders, time) sent with
  `import-complete`; `cancel_import` and `preview_import_folder`
  commands. The cancel slot `AppState.import_task_token` shares
  `app_state::start_cancellable_task` / `cancel_task` with the preset
  batch (which used to inline them). Settings `last_import_settings`
  (JSON, cleaned by `utils/importSettings.ts` `readLastImportSettings`).
  Frontend: `ImportSettingsModal.tsx` rewritten (Copy/Move
  `SegmentedSwitch`, destination with Choose…, subfolder `Dropdown`
  with Custom, name-clash `Dropdown`, example path), new
  `ImportSummaryModal.tsx` (in `AppModals`), new
  `panel/library/ImportProgress.tsx` in the Library header next to the
  new Import button (`MainLibrary.tsx`); keybind `import_photos`
  (Cmd/Ctrl+Shift+I); `import-complete` adds an outside destination to
  the Library roots (`useTauriListeners.ts`). Placeholders of es, fr,
  pt and pl showed translated tokens (`AAAA`, `JJ`, `RRRR`) the code
  never understood; all now show `YYYY/MM-DD`.
- Found, not changed (ask later): import copies a photo's `.tirdata`
  but not its `.xmp` sidecars (`IMG_1.CR3.xmp`, `IMG_1.xmp`), unlike
  rename (`rename.rs`), so Lightroom edits on a card or in a source
  folder stay behind.

## Owner's request (2026-11-19)

A clear Import button; pick a destination root; automatic date
subfolders (e.g. `YYYY/YYYY-MM/YYYY-MM-DD`, as in LrC); keywords during
import; rename with the rename dialog; import status; a short summary
when done. (Auto-advance was raised with it; it already exists through
Caps Lock, owner: leave it out.)

## Current code (checked 2026-11-19)

- `import_files` (`src-tauri/src/file_management.rs`) copies the files
  one by one, emitting `import-start`, `import-progress`,
  `import-complete` and `import-error`. `ImportSettings`:
  `filename_template`, `filename_texts`, `organize_by_date`,
  `date_folder_format` (`YYYY`/`MM`/`DD` replaced by chrono codes),
  `delete_after_import` (Trash, else delete). A renamed copy records the
  original name (`remember_original_file_name`). Android content URIs
  have their own branch.
- **The first failing file stops the whole import** (`return` in the
  loop): the files before it stay copied, the rest are skipped, and only
  "Import failed" shows. A name that already exists is such a failure.
- Source: a file picker only (`handleImportClick`,
  `src/hooks/useFileOperations.ts`); the destination is the folder that
  was right-clicked or is open (`importTargetFolder`).
- Dialog: `src/components/modals/ImportSettingsModal.tsx`, the shared
  `FilenameTemplateEditor` (rename Phase 4, `1.77.0`), "Organize by
  date" with a free-text format (default `YYYY/MM-DD`), delete after
  import.
- Status: `useTauriListeners.ts` feeds `importState`
  (`useProcessStore`), shown as a one-line text in the Library header
  (`MainLibrary.tsx`) and a spinner in an empty grid. No summary.
- **No Import button on the desktop**: only the folder context menus
  (`useAppContextMenus.ts`); Android has a floating button
  (`MainLibrary.tsx`). Cmd/Ctrl+Shift+I is free (plain `I` toggles
  Metadata, `keyboardUtils.ts`).
- Keywords: `add_tag_for_paths` (`tagging.rs`) tags paths, writing
  `dc:subject` to XMP; typed keywords take an existing spelling (item
  42).
- Creator/copyright: the Metadata panel's Author and Copyright
  (`EDITABLE_FIELDS`, `MetadataPanel.tsx`) save through
  `update_exif_fields` into the `.tirdata` sidecar's `exif` map as
  `Artist`/`Copyright`; exports write them (`exif_processing.rs`). They
  never reach the `.xmp` sidecar.
- Presets UI: `NamedPresetBar` (`NamedPresetBar.tsx`,
  `utils/namedPresets.ts`), shared by rename templates, Blend Pad and
  Zone Editor presets.

## Decisions (owner, 2026-11-19)

1. **Import button:** a labelled Import button in the Library header
   (left of its right-hand group) and Cmd/Ctrl+Shift+I; the folder
   right-click entry stays (agent: it fills in that folder as the
   destination).
2. **Source:** a folder or memory card (subfolders included,
   switchable), shown as a grid of thumbnails, all ticked, with Check
   All / Uncheck All; picking single files stays possible.
3. **Destination:** any folder (Choose…), remembered, defaulting to the
   last one used (else the open folder); a destination outside the
   Library's roots is added to the Library after the import.
4. **Subfolders:** a dropdown: Into one folder, `YYYY/YYYY-MM-DD`,
   `YYYY/YYYY-MM/YYYY-MM-DD`, `YYYY/MM/DD`, `YYYY/MM-DD`, `YYYY-MM-DD`,
   `YYYY/Month/DD` (localised month name), Custom… (today's tokens plus
   `MMMM` for the month name), with a live example path.
5. **Keywords:** one comma-separated field with suggestions from the
   Keyword List (the Tagging panel's input; existing spelling wins),
   applied to every imported photo through the usual sidecar/XMP path.
6. **Name already exists:** a remembered choice, Add suffix (`name-1`,
   `name-2`, RAW+JPEG partners alike) or Skip, listed in the summary
   either way (agent default: Add suffix).
7. **Suspected duplicates** (LrC "Don't Import Suspected Duplicates"):
   deferred by the owner 2026-11-19; restart: owner request.
8. **Status:** a progress bar in the Library header (count, current
   file, Cancel); a failure no longer stops the import; when done, a
   summary dialog (copied, suffixed, skipped and failed with reasons,
   expandable; destination folders; keywords applied; time taken) with
   "Show in Library" (opens the destination) and Close.
9. **Import Presets** through the shared `NamedPresetBar` (save,
   update, rename, delete, export, import) at the top of the dialog,
   holding the whole setup (destination, subfolders, rename template,
   keywords, clash choice, creator/copyright); the dialog reopens with
   the last preset or settings used. Move is never stored and always
   starts at Copy (first answer "remember last only", revised by the
   owner the same day). Agent: keywords come only from a preset; without
   one the field starts empty, so last shoot's keywords are not applied
   by accident.
10. **Applied during import besides keywords:** creator and copyright
    only (no develop preset, rating, label or flag).
11. **Creator and copyright in XMP:** with XMP sync on, import and the
    Metadata panel write `dc:creator` and `dc:rights`, and an XMP
    carrying them is read back, like keywords.
12. **Modes:** a Copy / Move choice at the top replaces the "delete
    after import" switch (Move trashes the sources after a successful
    copy, as today); no Add mode (adding a folder to the Library does
    that).
13. **Phases:** the four below.
14. **Item 30 folded in** (Import from card or camera, deferred
    2026-11-15): phase 2 also detects memory cards and cameras that
    mount as drives (a `DCIM` folder) on macOS, Linux and Windows and
    lists them as sources, and groups the tick grid by capture date with
    a tick per day. Not taken from item 30 (owner 2026-11-19): RAW+JPEG
    pairs as one tile, a second copy to a backup folder (restart: owner
    request). Owner 2026-11-19: a connected camera shows on the Mac as
    an external drive with folders (USB mass storage), so the `DCIM`
    drive detection covers it; cameras that connect only over PTP/MTP
    (not readable as folders on macOS and Windows) stay out of scope as
    in item 30 (restart: owner request), and so does tethering (item
    22).
15. **Auto-open:** when a card or camera (a drive with `DCIM`) is
    connected while the app runs, the Import dialog opens with it as the
    source; a Settings → Library switch turns this off (default on).

## Phases

1. **`1.98.0` — button, destination, subfolders, robust run, report.**
   Import button and shortcut; destination field (remembered, added to
   the Library when outside it); subfolder dropdown with example path;
   Copy / Move; name-clash choice; the loop continues past failures and
   collects per-file results; header progress bar with Cancel; summary
   dialog.
2. **`1.99.0` — folder or card source with a tick grid**: detected
   cards and cameras (`DCIM`) in the source list, thumbnails, Check All
   / Uncheck All, grouped by capture date with a tick per day
   (decision 14); the dialog opens by itself when a card is connected
   (decision 15).
3. **`1.100.0` — keywords, creator and copyright**, with `dc:creator` /
   `dc:rights` in XMP for import and the Metadata panel.
4. **`1.101.0` — Import Presets.**

## Out of scope

- Suspected-duplicate check (deferred, decision 7).
- RAW+JPEG pairs as one tile, backup second copy, PTP/MTP cameras,
  tethering (decision 14).
- Progress and Cancel follow export's own events (`export-cancelling`
  …); P3 item 20 (background job tracker) may absorb both later.
- Rename Phase 5's per-folder sequence (useful for date folders) stays
  deferred (`RENAME_PLAN.md`).
- Add (import in place), develop presets, rating, label or flag on
  import.
