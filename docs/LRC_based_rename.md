Based on a read-only review of the RapidRAW-Enhanced repo. TIR already has a basic token rename, so this plan builds on it rather than starting from scratch.
What TIR already has
• One shared template function. generate_filename_from_template in file_management.rs is used by rename, import and export. That's the right setup: making it better improves all three at once.
• The tokens are simple text replacement. There are nine: {original_filename}, {original_filename_number}, {sequence}, {YYYY}, {MM}, {DD}, {hh}, {mm}, {ss}. There are no format arguments, filters or EXIF fields.
• The rename command. rename_files takes the selected paths, applies the template, renames the image plus its .tirdata sidecars (virtual copies included), and updates albums.
• The interface. RenameFileModal.tsx is a text field with clickable token chips, sharing FILENAME_VARIABLES with the export and import settings in ExportImportProperties.tsx.
Problems in the current rename
1.  XMP files get left behind. Only .tirdata files count as sidecars when renaming. resolve_xmp_path exists but isn't used, so IMG_001.xmp keeps its old name and gets separated from its photo.
2.  RAW+JPEG pairs are renamed separately. group_id pairing exists, but rename ignores it. If you select only the RAW, the JPEG keeps its old name.
3.  No name clean-up. A template containing / or : produces an invalid name, or a path into a subfolder. Only export suffixes go through sanitize_filename_suffix.
4.  Swaps and case-only renames fail. Each new name is checked against files on disk one at a time. On macOS, renaming img.cr3 → IMG.cr3 is rejected as "already exists", and so is A↔B ordering.
5.  A failure partway through leaves a mess. Renames happen one by one with ?, so an error halfway through leaves some files renamed and others not, with no rollback and no undo.
6.  Capture times are probably shifted by your time zone. try_get_exif_creation_date treats the camera's local timestamp as UTC, and the template then converts it to local time. A photo taken at 00:30 could be named with the previous day's date. A one-line test would confirm this.
7.  No preview. You only see the result after the files have been renamed.
Phase 1: Token engine (Rust, new file src-tauri/src/naming.rs)
• Put it in its own file instead of file_management.rs. That file is almost 7,000 lines and is often being edited, so a separate file keeps merge conflicts down.
• The engine has three parts:
    ◦ Parser: turns the template into a parsed structure and reports errors with character positions.
    ◦ Context: reads each image's EXIF data once, via exif_processing.
    ◦ Evaluator: builds the name and cleans it (illegal characters, Windows reserved names, trailing dots, length cap).
• Syntax: {token:format|filter?fallback}. Every existing token keeps working unchanged, so saved export and import presets don't break.
• New tokens:
    ◦ Dates: {date:YYYYMMDD}, {capture:…}, {filedate:…}, {today:…}
    ◦ Sequence: {seq:4:start=101}
    ◦ EXIF: {camera}, {lens}, {iso}, {focal}, {aperture}, {shutter}
    ◦ Library metadata: {rating}, {label}, {title}
    ◦ Custom: {text}
• Filters: upper, lower, slug, trim:N.
• Treat capture time as a naive local time throughout, which fixes problem 6.
• generate_filename_from_template becomes a thin wrapper, so export and import pick up the new engine with no further changes.
Phase 2: Safe rename (Rust)
• preview_rename(paths, template, opts): no changes to disk. Returns the new names, clashes, cleaned characters and missing-EXIF warnings.
• apply_rename(plan). It renames everything that belongs to a photo together: .tirdata and virtual-copy sidecars, .xmp files in both naming styles, and grouped RAW+JPEG files. Then it:
    ◦ checks clashes against the whole batch and the folder, case-insensitively;
    ◦ renames everything to temporary names first, then to the final names;
    ◦ rolls everything back if any rename fails;
    ◦ updates albums (as it does now), the keyword index and the thumbnail cache.
• Undo log on disk, plus an undo_rename command.
Phase 3: Rename dialog (React)
• Rebuild RenameFileModal with:
    ◦ grouped token chips;
    ◦ a preview of the first and last file that updates 150 ms after you stop typing;
    ◦ inline template errors;
    ◦ a clash/warning count, with Rename disabled while there are clashes.
• Saved presets live in app_settings.
• Sequence order follows the grid's sort order, as in LRC. Today it follows the order the paths arrive in.
• Every new string goes through the i18next keys under modals.renameFile.*.
Phase 4: Share the editor with export and import
• Export and import use the same template editor component and presets.
• The {original_filename}_edited special case in ExportPanel.tsx and export_processing.rs should be replaced by a proper default preset.
Phase 5: Extras
• A {stamp} token for the name of the look or curve preset on the image.
• Restarting the sequence in each folder.
• Undo from the History panel.
