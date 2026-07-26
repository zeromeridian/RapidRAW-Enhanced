# RapidRAW Fork Handoff

> **Living document:** Read this file before making changes. Update it in the same
> work session whenever code, configuration, build artifacts, validation results,
> blockers, or next steps change. Remove stale information instead of only
> appending notes.

## Project

- Repository: `/home/emil/git/RapidRAW`
- Upstream project: RapidRAW
- Fork goal: customize RapidRAW while preserving existing application behavior.
- Current platform target: Ubuntu Linux amd64 (`x86_64`).

## Current Work

The bottom toolbar now exposes every action from the image context menu's
**Productivity** submenu, followed by physical-copy and virtual-copy actions:

1. Auto Adjust Image
2. Denoise Image
3. Convert Negative
4. Stitch Panorama
5. Merge to HDR
6. Frame Image
7. Cull Image
8. Physical Copy
9. Virtual Copy

Implementation:

- `src/components/panel/BottomBar.tsx`
- Uses the existing Lucide icons and existing Tauri commands/modal state.
- Works in both Library and Editor views because they share `BottomBar`.
- Uses the current multi-selection, with the active editor image as a fallback.
- Selection limits match the context menu:
  - Auto Adjust, Denoise, Convert Negative: at least 1 image
  - Stitch Panorama: 2–30 images
  - Merge to HDR: 2–9 images
  - Frame Image: 1–9 images
  - Cull Image: at least 2 images
- Physical Copy and Virtual Copy require exactly one image.
- Copy actions preserve active-album membership and refresh the library after
  completion.
- A permanently visible customization control at the far right opens a
  Lightroom-style checklist.
- Rating, copy/paste controls, all nine action buttons, Quick Filter, Export,
  Zoom, and the filmstrip toggle can be shown or hidden independently.
- Visibility is persisted in `bottomToolbarVisibility`; missing keys default to
  visible for backward compatibility.

Manual Lightroom-style image stacking is implemented separately from RAW/JPEG
grouping:

- Select two or more library images and use **Stacking → Stack Selected Photos**.
- Stacks persist in `imageStacks` in application settings.
- Collapsed stacks show their selected cover plus a numeric count badge.
- Expanded stack members remain contiguous in their saved order.
- Clicking the numeric stack badge toggles that stack between collapsed and
  expanded in both grid and list modes; the grid badge is also keyboard
  accessible with Enter or Space.
- Context-menu actions expand/collapse, select a cover, and unstack.
- Stack badges appear in both grid and list library modes.
- Stack membership uses full image paths and does not modify `group_id`.

## Working Tree

Expected intentional source changes:

- `src/components/panel/BottomBar.tsx`
- `src/components/views/LibraryView.tsx`
- `src/components/views/EditorView.tsx`
- `src/App.tsx`
- `src/components/ui/AppProperties.tsx`
- `src/i18n/locales/en.json`
- `src-tauri/src/app_settings.rs`
- `src-tauri/tauri.conf.json`
- `src/utils/imageStacks.ts`
- `src/hooks/useSortedLibrary.ts`
- `src/hooks/useAppContextMenus.ts`
- `src/components/panel/library/LibraryItems.tsx`
- `HANDOFF.md`
- `AGENTS.md`

Before editing, always run:

```bash
git status --short
git diff --check
```

Do not discard unrelated user changes.

## Latest Build

Successful production build:

- Version: `1.6.1-colrbent.3`
- Architecture: `amd64` / `x86_64`
- DEB:
  `src-tauri/target/release/bundle/deb/RapidRAW_1.6.1-colrbent.3_amd64.deb`
- AppImage:
  `src-tauri/target/release/bundle/appimage/RapidRAW_1.6.1-colrbent.3_amd64.AppImage`

These packages include toolbar customization, persistent manual image stacking,
and click-to-toggle stack badges.

SHA-256 at the time of this handoff:

```text
87359c64f0b06e366febcecd454c92777c875349c8bee57af5850a91e14f9daf  RapidRAW_1.6.1-colrbent.3_amd64.deb
941e62207e19231f97ce01d4b4c92f199ac63a21d98d3903a0d3458e0161cac1  RapidRAW_1.6.1-colrbent.3_amd64.AppImage
```

These hashes become stale after any rebuild and must then be replaced.

## Versioning

- The application version is controlled by `version` in
  `src-tauri/tauri.conf.json`.
- Colrbent build numbering starts at `1.6.1-colrbent.1`.
- Keep the upstream-compatible base version and increment the Colrbent release
  number for each distributable build:
  `1.6.1-colrbent.1` → `1.6.1-colrbent.2` → `1.6.1-colrbent.3`.
- When rebasing onto a new upstream version, update the base and restart the
  Colrbent release counter, for example `1.7.0-colrbent.1`.
- Update this section, artifact paths, and checksums in the same session as each
  version bump and rebuild.

## Build Environment

The host initially lacked Node, Rust, and several development packages. An
isolated build environment was created under `/tmp`:

- Node.js: `/tmp/rapidraw-node`
- Cargo home: `/tmp/rapidraw-cargo`
- Rustup home: `/tmp/rapidraw-rustup`
- Local Ubuntu sysroot: `/tmp/rapidraw-build-sysroot`
- Downloaded DEBs: `/tmp/rapidraw-build-debs`
- Rust toolchain: `1.96.0`

`/tmp` is ephemeral. If these paths no longer exist, recreate the toolchain or
install the prerequisites normally. The successful bundle command used the
local toolchain/sysroot and built the `deb,appimage` targets.

The build downloads and verifies the Linux x86_64 ONNX Runtime resource at:

```text
src-tauri/resources/libonnxruntime.so
```

The resource and build outputs are ignored by Git.

## Validation Status

- `vite build`: passed.
- Latest `vite build` with clickable stack badges: passed.
- Latest `vite build` with toolbar customization: passed.
- Stack collapsed/expanded ordering checks: passed.
- Tauri release compilation: passed.
- `1.6.1-colrbent.3` DEB generation: passed; package metadata verified as
  version `1.6.1-colrbent.3`, architecture `amd64`.
- `1.6.1-colrbent.3` AppImage generation: passed; verified as an x86-64 ELF.
- i18n runtime check: passed (954 plural resolutions across 12 locales).
- `git diff --check`: passed after the toolbar implementation.
- `cargo fmt --check` was unavailable because the isolated minimal Rust
  toolchain does not include `rustfmt`; the modified Rust settings schema
  compiled successfully in the release build.
- Full `npm run typecheck`: fails due to numerous existing errors in unrelated
  files, including Curves, masking panels, navigation, library grids, and typed
  i18n calls. No reported typecheck error referenced `BottomBar.tsx`.
- Vite reports a non-blocking warning that the main JavaScript chunk exceeds
  500 kB after minification.
- `npm ci` reported 7 high-severity dependency audit findings. No automatic
  dependency upgrades were performed.

## Recommended Next Checks

1. Install either generated package on an Ubuntu amd64 test system.
2. Verify all nine toolbar icons in both Library and Editor views.
3. Test single and multi-selection disabled states.
4. Exercise each modal/action and confirm it receives the selected paths.
5. Check the toolbar at the minimum supported window width (`800px`) for
   crowding or overflow.
6. Restart the application and confirm hidden toolbar items remain hidden.
7. Hide every optional item and confirm the customization control remains
   available to restore them.
8. Create stacks in grid and list modes; restart and verify persistence.
9. Verify stack behavior under rating/color filters, search, albums, and
   RAW/JPEG grouping.

## Continuous Maintenance Protocol

Every agent or developer changing this repository must update this file before
handoff:

1. Describe the outcome, not a transcript of commands.
2. List files intentionally changed.
3. Record validation commands and their actual results.
4. Record artifact paths and refresh checksums after rebuilding.
5. Record unresolved blockers and the safest next action.
6. Delete or revise statements that are no longer true.
7. Keep this document concise enough to scan in under two minutes.

Last maintained: 2026-07-26.
