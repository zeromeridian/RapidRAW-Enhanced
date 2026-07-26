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

## Working Tree

Expected intentional source changes:

- `src/components/panel/BottomBar.tsx`
- `src/components/views/LibraryView.tsx`
- `src/components/views/EditorView.tsx`
- `src/App.tsx`
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

- Version: `1.6.0`
- Architecture: `amd64` / `x86_64`
- DEB:
  `src-tauri/target/release/bundle/deb/RapidRAW_1.6.0_amd64.deb`
- AppImage:
  `src-tauri/target/release/bundle/appimage/RapidRAW_1.6.0_amd64.AppImage`

These packages include the seven Productivity buttons but predate the Physical
Copy and Virtual Copy buttons. Rebuild before distributing if the copy buttons
must be included.

SHA-256 at the time of this handoff:

```text
75c2bcbdecfcc51e1e9f7eb38790efe2ce8c46d0e2f9ca1716a06478375519ab  RapidRAW_1.6.0_amd64.deb
499eb4858aff132f8b2653133298ab4550f9823c0931f15a7ddcd5e76449de2e  RapidRAW_1.6.0_amd64.AppImage
```

These hashes become stale after any rebuild and must then be replaced.

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
- Latest `vite build` after adding Physical Copy and Virtual Copy: passed.
- Tauri release compilation: passed.
- DEB generation: passed and verified as `amd64`.
- AppImage generation: passed and verified as x86-64.
- `git diff --check`: passed after the toolbar implementation.
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
