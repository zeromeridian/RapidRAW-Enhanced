# Lightroom-style Rename Plan

Status (2026-11-13): **not started.** `UPSTREAM_FEATURE_GAP.md` Plan item 29
(P0, owner 2026-11-13: the whole feature, its bug fixes included, after
item 28, Zone Tint). Five phases, each with its own version.

**Specification:** the owner's `LRC_based_rename.md` (2026-11-13) holds the
phases, token syntax and dialog design. This file records what the code
check confirmed, what the spec misses, decisions, and progress.

## Code check (2026-11-13)

All seven problems listed in the spec are present:

1. **XMP left behind:** `rename_files_blocking` renames only what
   `is_sidecar_of` matches, which is `.tirdata` only
   (`parse_sidecar_filename`); `resolve_xmp_path` knows both XMP naming
   styles but rename does not use it. Since edits travel between
   installations through XMP (AGENTS.md), a renamed photo loses them
   elsewhere. `find_all_associated_files` (delete, move to Trash) has the
   same gap: check delete, copy and move too when fixing it.
2. **RAW+JPEG pairs:** `group_id` exists only on listed `ImageFile`s
   (`assign_group_ids`); rename never looks at it.
3. **No clean-up:** the template result is joined to the folder as is, so
   `/` makes a subfolder path and `:` an invalid Windows name;
   `sanitize_filename_suffix` is used for export suffixes only.
4. **Swaps and case-only renames:** a clash check per file against the disk
   (`new_path.exists()`) rejects `img.cr3` → `IMG.cr3` on macOS and Windows
   and any A↔B swap.
5. **No rollback:** `fs::rename` one by one with `?`.
6. **Time zone:** `try_get_exif_creation_date` stores the camera's naive
   local time as UTC (`DateTime::from_naive_utc_and_offset`) and
   `generate_filename_from_template` converts it to `chrono::Local`, so at
   UTC−5 a 00:30 capture is named 19:30 the previous day. This affects
   export and import names too; fixing it changes their dates (release
   notes). Sorting compares the same values, so it is not affected.
7. **No preview:** `RenameFileModal.tsx` is a text field with token chips;
   the backend reports a clash only after the user confirmed.

Also found:

- **Sequence order** follows the order of the selected paths sent by the
  context menu (`finalSelection`), not the grid order.
- **Other path-keyed state** not updated by rename today: the catalog's
  `keyword_index_files` and `thumbnail_index` rows, `editor_round_trips`
  (`source_path`, `destination`), and the Edit Original watch list. Albums
  are updated (`sync_album_path_changes`).
- `file_management.rs` is 7,270 lines; the spec's separate `naming.rs` is
  right. Keep `generate_filename_from_template` as the thin wrapper, as the
  spec says, so export (`export_processing.rs`) and import keep working.
- The `{ss}` token was added in `1.45.0`; keep every existing token and the
  `{original_filename}_edited` default until Phase 4 replaces it.

## Open decisions (ask the owner when the item starts)

- Undo: a log on disk plus `undo_rename` (spec, Phase 2) versus only the
  rollback on failure first; History-panel undo is Phase 5.
- Presets: their own list in app settings, or shared with export and
  import from the start (spec puts sharing in Phase 4).
- Whether rename follows RAW+JPEG grouping always, or only when the pair is
  shown grouped (the grouping settings `require_matching_exif`,
  `group_edited_files`).
- Time-zone fix: apply it to export and import names in the same release
  (recommended, one shared function) and say so in the release notes.

**Progress:** none yet. Record each finished phase here (version, date,
result).
