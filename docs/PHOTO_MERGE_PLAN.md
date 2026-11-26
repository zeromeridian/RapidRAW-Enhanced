# Photo Merge Plan: HDR and Panorama (proposed Plan item 75)

Port of upstream's shared merge backend (`src-tauri/src/merge/`,
`MergeModal.tsx`), which replaces the fork's HDR merge and panorama
stitcher. Plan entry: **not yet in `UPSTREAM_FEATURE_GAP.md`**; the owner
adds it as item 75 (or renumbers) before work starts. Branch (when it
starts): `dev/photo-merge` from the latest `develop`.

**Status (2026-11-22):** plan written, **no owner decisions yet**. Do not
start coding until the owner has answered the decisions below and added
the Plan item. Feasibility report (owner's overview, not a source of
truth): the "TIR: HDR and Panorama merge feasibility" doc, 2026-11-22.

## Owner's request (2026-11-22)

"Analyze the feasibility to have a built in HDR and Panorama stacking
tool in TIR", followed by "write a plan in the repo for the coding agent".
Reference behaviour is Lightroom Classic's Photo › Photo Merge (HDR,
Panorama, HDR Panorama).

## Current code (checked 2026-11-22, `develop` `36718d25`)

Both tools are upstream's pre-`v1.6.0` code, never reworked in the fork.

- **HDR:** `merge_hdr` / `save_hdr` (`lib.rs`), `HdrModal.tsx`.
  `hdr_deghosting.rs`: `load_hdr_frames` decodes with
  `load_base_image_from_bytes` (RAW: linear, with the fork's highlight
  compression up to `clamp_limit` in `raw_processing.rs`; non-RAW:
  `apply_srgb_to_linear`), reads ISO and exposure time from EXIF (fails
  without them); `align_hdr_frames` is FAST + BRIEF with a rigid
  transform to the middle frame. No deghosting despite the file name.
  Merge: `image_hdr` 0.6.0 `hdr_merge_images` (Poisson estimator, weights
  ∝ exposure time, **no saturation weight**), then
  `apply_histogram_stretch` (min–max to 0–1), `apply_linear_to_srgb`.
  Output `<stem>_Hdr.tiff`, 32-bit float, sRGB-encoded, via
  `exif_processing::save_converted_image`.
- **Panorama:** `stitch_panorama` / `save_panorama`
  (`panorama_stitching.rs`), `panorama_utils/processing.rs`,
  `panorama_utils/stitching.rs`, `PanoramaModal.tsx`. RAWs go through
  `apply_cpu_default_raw_processing` (gamma 2.38, contrast 1.28, clamp
  0–1) before stitching. Planar homographies per pair (RANSAC), a
  spanning tree (`build_stitching_order`), chained; `progressive_seam_stitcher`
  with a DP seam and 100 px feather. Output `<stem>_Pano.tiff`, float,
  display-referred. No options; 800 px preview.
- **Fork-only pieces to keep:** `file_management::unique_output_path`
  (free output names), virtual paths resolved with `parse_virtual_path`,
  source EXIF on outputs (`1.45.0`, `save_converted_image`,
  `write_exif_sidecar`), oversized images shrunk to fit the GPU
  (`gpu_processing::fit_to_gpu`, item 39 decision 1).
- **Entry points:** `useAppContextMenus.ts`, `useProductivityActions.ts`,
  `useTauriListeners.ts` (`hdr-*`, `panorama-*` events), `AppModals.tsx`,
  `useUIStore.ts`.

## Upstream source

On upstream `main` only (fetched by the owner to `3bb44170`, 2026-11-20),
not in a release, newer than the last triage (`b0978936`):

| Commit | Date | Content |
| --- | --- | --- |
| `7918387b` | 2026-11-16 | Panorama rewrite: rotation model, bundle adjustment, lens distortion, exposure and vignetting compensation, graph-cut seams (`maxflow.rs`), multi-band blending; Projection (Auto, Perspective, Cylindrical, Spherical), Boundary Warp, Auto Crop, Exposure Compensation; live preview |
| `5e7882fe` | 2026-11-17 | RAW panoramas blended in linear space; seams kept off borders; bounded memory |
| `3bb44170` | 2026-11-20 | Shared `merge/` backend for panorama, HDR and focus stacking; RAW HDR to linear float DNG (`dng.rs`) with measured exposures, clip-aware weights (`hdr/radiance.rs`) and automatic deghosting; JPEG exposure fusion (`hdr/exposure_fusion.rs`); one `MergeModal.tsx`; `image-hdr` removed, `flate2` added; `raw_processing.rs` skips clipped-pixel recovery for float data; Boundary Warp edge fix |

Upstream's `merge/` depends on modules the fork does not have (checked):
`app::memory_budget::MemoryBudget`, `export::tasks::estimate_export_memory`,
`library::sidecars`, `render::color_space` (`WORKING` = Rec.2020 since
upstream `5705db6e`, 2026-11-17, which the fork never took).

## Open decisions (owner)

Each has a recommended default. Record the answer here with who decided
and the date; do not code a phase whose decisions are open.

1. **Approach.** Port upstream's `merge/`; build a fork version; keep
   today's tools. *Default: port, from the diff of upstream's settled
   state (rule 4).*
2. **Focus stacking.** Keep deferred under item 22; add as a phase.
   *Default: keep deferred; revisit after phase 3.*
3. **Timing.** Start now; after upstream's next release; after a week
   with no upstream change under `merge/`. *Default: next release or a
   quiet week, whichever comes first; after the current queue.*
4. **Item 52 (pink DNGs).** Fold into this plan's step 1 or keep apart.
   *Default: fold in; step 1 has to touch the same linear-DNG path.*
5. **Source list in the merged file.** Write source paths into the
   ThisIsRAW XMP payload or not. *Default: write them (enables Create
   Stack and "show sources").*
6. **Develop settings from the sources.** Fork RAW defaults on the merged
   DNG (upstream); copy White Balance / profile from the reference frame
   (LrC, behaviour not yet confirmed). *Default: RAW defaults. Never copy
   lens corrections: the panorama solver models distortion.*
7. **LrC extras (step 5).** Which and in what order: Deghost Amount
   (None/Low/Medium/High) with Show Deghost Overlay; Shift-modified
   headless merge with the last settings; Create Stack; HDR Panorama;
   Fill Edges. *Default: deghost amount + overlay and headless first,
   Create Stack next, HDR Panorama last; Fill Edges out of scope.*
8. **Output names.** LrC `-HDR.dng` / `-Pano.dng`; upstream `_Hdr` /
   `_Pano`. *Default: LrC's.*
9. **JPEG/TIFF brackets.** Exposure fusion to a display TIFF (upstream);
   radiance merge to DNG (LrC). *Default: upstream's fusion.*
10. **Old modals and commands.** Remove `HdrModal`, `PanoramaModal`,
    `hdr_deghosting.rs`, `panorama_stitching.rs`, `panorama_utils/` once
    each replacement lands, or keep them behind a setting. *Default:
    remove; existing `_Hdr.tiff` / `_Pano.tiff` files are plain TIFFs and
    need no code.*

## Design

- **Module:** bring `merge/` over as one module under
  `src-tauri/src/merge/` with upstream's internal layout, so later
  upstream fixes apply by path. Do not take upstream's backend split
  (`ad1dc9b9`) for the rest of the crate.
- **Shims** (one file, `merge/fork_compat.rs` or similar): memory
  estimate and budget (port `MemoryBudget` alone if it is small; it is
  what keeps multi-frame 61 MP merges from exhausting memory), sidecar /
  virtual path helpers mapped to `file_management.rs`, and a colour-space
  module that exposes the **fork's** working space.
- **Working space:** first find and document the fork's working primaries
  (where the camera matrix lands in `raw_processing.rs` / `image_loader.rs`).
  `dng.rs`'s `xyz_to_working` and every `luminance` call must use them.
  A wrong matrix gives a colour cast on every merged DNG.
- **Loading merged DNGs:** float DNGs must load **unclamped** and without
  highlight recovery (upstream's `RawImageData::Float` check), decided per
  file from the DNG itself, not from the global Linear RAW setting
  (`linearRawMode`). Otherwise `develop_internal` clamps at `clamp_limit`
  and the HDR headroom is lost. Keep Natural and the fork's RAW defaults
  (`1.34.0`).
- **Tone mapper:** `output.rs`'s preview rendering may use upstream's
  Basic/AgX for the dialog preview only; the saved DNG carries no tone
  choice and opens with the fork's defaults.
- **Frontend:** rebuild `MergeModal.tsx` on the fork's components, store
  and modal conventions; one dialog with the kind chosen (Panorama, HDR).
  Strings in all 12 locales (upstream's text where it has them). Entry
  points: thumbnail context menu (as today) and, if `MENU_BAR_PLAN.md`'s
  menu exists by then, Photo › Photo Merge.
- **Platforms:** pure Rust (`nalgebra`, `rayon`, `half`, `flate2`); no
  OS-specific code. Must build on macOS ARM64, Linux and Windows.

## Saving, older edits, presets

- A merge creates a new file; it is not an edit. Nothing new in the
  ThisIsRAW XMP payload except the optional source list (decision 5).
- RAW sources → linear float DNG beside the first source (name per
  decision 8, free name via `unique_output_path`), with the reference
  frame's EXIF. It opens and edits like any RAW; its edits round-trip
  through its own XMP sidecar; presets apply as to any RAW.
- JPEG/TIFF sources → TIFF (decision 9).
- Existing `_Hdr.tiff` / `_Pano.tiff` files and their edits are unchanged.
- Last-used merge options are stored in app settings (not XMP), per kind.

## Steps

One MINOR per feature step, PATCH for fixes, per the repo's rules.

1. **Foundation** (with step 2's MINOR, or a PATCH first if item 52 is
   folded in and shipped alone). Shims; fork working space in the
   colour module; per-file float-DNG loading; golden tests (below).
   Check: a hand-made linear float DNG with values above `clamp_limit`
   loads without clipping; a gray patch of known XYZ renders neutral.
2. **Panorama** (MINOR). Upstream `7918387b` + `5e7882fe` + the panorama
   parts of `3bb44170`. Merge dialog with Projection, Boundary Warp,
   Auto Crop, Exposure Compensation, live preview. RAW panoramas save as
   linear DNG. Replace the old panorama command and modal (decision 10).
   Check: a 3-frame handheld row and a 7-frame wide (>180°) row stitch
   without visible seams; Auto picks Cylindrical/Spherical for the wide
   one; a 30,000 px result opens (GPU fit) and exports at full size.
3. **HDR** (MINOR). `hdr/` (radiance, exposure fusion), measured
   exposures, deghosting, DNG output, Auto Crop; remove `image-hdr`.
   Replace the old HDR command and modal.
   Check: a −2/0/+2 EV RAW bracket with a clipped sky gives a smooth sky
   (no banding, no grey highlights); a bracket with a walking person has
   no ghost; a JPEG bracket fuses; the DNG edits like a RAW.
4. **Docs.** `FEATURES.md`, `RELEASE_NOTES.MD`, gap doc ("Completed
   ports"), a short `PHOTO_MERGE_GUIDE.md` for photographers if the
   owner wants one.
5. **LrC extras** (MINOR, fork-only, only with decision 7). Deghost
   Amount scales upstream's `GHOST_THRESHOLD` (0.25) and `GHOST_SPREAD`;
   overlay shows the ghost mask in the dialog preview; headless merge
   with Shift on the menu entry or shortcut, using the stored options;
   Create Stack uses the fork's existing stacks; HDR Panorama runs HDR per
   bracket (grouped by capture time or by the user's selection order),
   then stitches the DNGs.

## Tests

Keep these in the fork so later upstream ports can be checked against
them:

- Synthetic bracket of a known radiance ramp at −2/0/+2 EV with clipping:
  merged values within 2% of the ramp, including where the brighter
  frames clip (the old merge was about 2 EV low there).
- Exposure mismatch: EXIF says 1 EV, data says 1.3 EV → the measured ratio
  is used (capped at 2×).
- Ghost: an object moved between frames comes from the reference frame
  only.
- DNG round trip: write → load with the fork's decoder → same linear
  values (half-float tolerance) and neutral gray.
- Two-frame planar panorama with a known shift: placement within 1 px.
- Float DNG load is not clamped and skips highlight recovery; integer
  RAWs unchanged (existing golden tests stay green).

## Out of scope

- Fill Edges (content-aware fill of panorama borders): needs inpainting
  at panorama size; revisit after step 5 if the owner asks.
- Focus stacking unless decision 2 says otherwise (item 22).
- HDR display output and gain maps (upstream `9be7729d`, `12a47cf3`):
  separate upstream items, not needed to merge or edit HDR DNGs.
- Upstream's Rec.2020 working-space move (`5705db6e`): separate decision.
