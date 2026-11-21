# Color Profiles Plan

Status (2026-11-21): **draft, not started; direction decided** (see
"Owner decisions"). No `UPSTREAM_FEATURE_GAP.md`
Plan item yet; number and position are the owner's to set (suggested:
after item 54, Spektrafilm LUTs, since both decide how a LUT travels).
One MINOR for Phases 1–2. Camera profiles (Phase 5) are a separate item.

**Goal:** Lightroom Classic style profiles, with the owner mainly
interested in **creating his own**: bake a look from the current develop
settings into a profile, pick it from a browser, and dial it with an
Amount slider, the way LrC's creative profiles work. The profile is the
**base** of the image: choosing it moves no slider, and every slider then
works on top of it, so the look can still be corrected with Shadows, Tone
Curve and the rest.

## Owner decisions

- **Profiles as the base, not LUTs as a finishing filter** (owner
  2026-11-21). Two options were weighed: (1) user-made LUTs in the
  existing end-of-pipeline LUT tool, mostly built but applied after every
  slider, so the sliders cannot correct the look (a filter over the
  finished photo, like a LUT in DaVinci Resolve); (2) user-made profiles
  in a new slot before the tone sliders, which behaves like LrC. The owner
  chose (2). A finishing LUT is kept as a by-product of the same Create
  dialog (Phase 3).

## How Lightroom Classic does it

- **Camera profiles** (Adobe Color, Adobe Monochrome, Camera Matching,
  ColorChecker profiles) are DCP files: two colour/forward matrices
  interpolated by white balance, a HueSatMap, a LookTable and a tone
  curve. LrC cannot make them; DNG Profile Editor, Calibrite or
  dcamprof/Lumariver do.
- **Creative profiles** are XMP files holding an RGB 3D LUT (plus an
  optional base camera profile) and allow the **Amount** slider (0–200,
  default 100). Camera profiles show no Amount slider.
- **Creating one:** only in Camera Raw (Option-click Create Preset →
  Create Profile). The chosen settings are baked into the LUT; local and
  spatial settings cannot be baked.
- **UI:** Profile row at the top of the Basic panel with a dropdown and a
  Browse button; the Profile Browser has groups (Adobe Raw, Camera
  Matching, Artistic, B&W, Modern, Vintage, user groups), Favorites,
  grid/list views, and a **live preview on the photo while hovering**.
  Choosing a B&W profile switches Treatment to Black & White.
- **Order as the user sees it:** the profile is the base; every slider
  works on top of it. Adobe does not document the internal order of the
  LUT against each slider; this plan only copies the visible behaviour.

## Fit with the current code (checked 2026-11-19, read-only)

- **The existing LUT is the last colour step.** In `shader.wgsl` `main`,
  `sample_lut_tetrahedral` runs after the tone mapper (AgX / Natural /
  Basic), after the global and mask curves, on display sRGB in [0, 1];
  only `monochrome_srgb` comes after it. It is a finishing filter, not a
  profile. A profile needs **its own slot** on linear, unclipped values.
- **Candidate slot:** after `apply_white_balance` and
  `apply_filmic_exposure` (Brightness), before `apply_tonal_adjustments`
  and `apply_highlights_adjustment` (around `shader.wgsl` lines 2201–2203).
  Exposure (`apply_linear_exposure`), white balance and Brightness then
  feed the look, as in LrC; Contrast, Highlights, Shadows, Whites, Blacks,
  the colour mixer, Point Color, Saturation/Vibrance, Color Grading, the
  tone mapper, curves and the LUT work on top of it. Check where the mask
  tonal/colour loops sit relative to this slot before fixing it.
- **Range:** RAW values are linear and can exceed 1.0 (decoder headroom,
  `highlight_compression` in `raw_processing.rs::develop_internal`).
  The slot needs a shaper in front of the LUT (see "Engine").
- **Existing "Export as LUT" bakes a display LUT, not a profile.**
  `export_adjustments_as_lut` (`export_processing.rs`) renders a 33³
  identity image with the spatial effects zeroed and calls
  `get_all_adjustments_from_json(…, false, …)`, so the lattice is
  rendered as **non-RAW**: display sRGB in, display sRGB out. That is
  right for a finishing LUT (Phase 3, video editors) and wrong for the
  profile slot, which needs linear RAW values and its own bake (Phase 2).
  Exposure, the tonal sliders and white balance are baked as they act on
  a non-RAW image, so a display LUT only approximates a RAW edit; colour
  tools and curves bake faithfully. **AgX bug:** the shader runs
  `agx_full_transform` regardless of `is_raw`, so an edit using AgX bakes
  AgX onto display values; Basic and Natural pass non-RAW values through,
  so the bake should force Basic. Not run yet.
- **LUT edits are not portable today.** Only `lutPath`, `lutName`,
  `lutIntensity` (and `lutSize`) are saved; `lutData` is listed in
  `app_settings.rs` and `INITIAL_ADJUSTMENTS` but nothing in Rust fills or
  reads it. An edit opened on another machine without the file loses the
  look. Profiles must embed their table (AGENTS.md edit-portability rule).
- **Known bug to fix first:** LUT intensity 0 snaps to 100
  (`src/components/adjustments/Effects.tsx:899`, `lutIntensity || 100`;
  upstream `8ca4176b`; the gap doc cites the old line 785). The profile
  Amount slider must not copy it.
- **Probe override exists.** `override SAMPLE_PROBE` (stages HSL, CURVE,
  MASK_CURVE, Point Color) already stops the shader at a stage and writes
  the value out. A `PROFILE_BAKE` stage can reuse it for the bake.
- **Black & White** is the `monochrome` flag, applied at the end; a B&W
  profile can set it like LrC's Treatment switch.
- **Camera colour** comes from rawler (CyberTimon's DngLab fork, git
  dependency): `develop_internal` keeps rawler's `Calibrate` step, then
  clamps channels at 0. **Assumption, not verified** (rawler's source is
  not in this repo): Calibrate converts to sRGB primaries, so colours
  outside sRGB are clipped before the shader. This matters for Phase 4
  and ties into item 19b's wide-gamut path.

## Engine (Phase 1)

- **Shaper.** The 3D LUT is indexed in a log2 encoding:
  `s(x) = clamp((log2(max(x, 2^-E_lo)) + E_lo) / (E_lo + E_hi), 0, 1)`
  per channel, with `E_lo` ≈ 12 stops below 1.0 and `E_hi` = log2 of the
  decoder headroom. The table stores output in the same encoding; the
  inverse `s⁻¹` returns linear values. Non-RAW images (linear after
  `srgb_to_linear`, ≤ 1.0) use the same shaper. Values outside the domain
  are clamped; record the shaper parameters in the profile so a later
  change of headroom does not break old profiles.
- **Amount:** `out = in + a · (P(in) − in)` in linear, `a` = Amount/100,
  0–200, default 100, result clamped at 0. Amount 0 = no profile.
- **Sampling:** reuse `sample_lut_tetrahedral`'s maths on a second 3D
  texture (binding next to `lut_texture`), f16 like today's LUT upload in
  `gpu_processing.rs`.
- **Global only.** Profiles are not per mask (LrC has none either).
- **Uniforms:** `has_profile`, `profile_amount`, shaper constants; check
  the uniform layout test and the naga test.

## Creating profiles (Phase 2)

- **Create Profile** dialog, modelled on Create Preset: name, group,
  B&W flag, and checkboxes for what to bake.
- **Bake:** render a lattice (33³ default) in shaper encoding through the
  stages **from the profile slot up to just before the tone mapper**, with
  masks and spatial effects off, using the photo's own `is_raw` (the RAW
  and non-RAW paths differ), via a `PROFILE_BAKE` probe stage. After
  saving, the baked settings are reset in the current edit so the photo
  looks the same with the profile applied at Amount 100.
- **Not bakeable:** anything spatial (Clarity, Structure, Dehaze,
  Sharpening, noise reduction, Glow/Halation/Flare, Vignette, Grain,
  Fog, Relight, Lens Blur, masks), and everything at or after the tone
  mapper (tone mapper choice, curves, LUT). See decision 2 for the tonal
  sliders and decision 3 for curves.
- **Profile Browser:** Profile row at the top of the first Develop tool,
  dropdown of Favorites and recent, Browse opens a browser with groups,
  Favorites, and hover preview (preview renders with the profile swapped
  in; reuse the LUT swatch path `generate_lut_previews` for thumbnails).

## Finishing LUTs (Phase 3, by-product)

- The Create dialog gets a second target, **Save as LUT**: a display LUT
  baked the way `export_adjustments_as_lut` does it (non-RAW lattice,
  tone mapper forced to Basic for the bake), saved into the LUT folder
  (`import_luts_to_dir`) so it shows in the LUT browser with a swatch
  (`generate_lut_previews`), and still exportable as `.cube`.
- It lands in the existing Effects → LUT tool, after every slider, with
  the limits described in "Owner decisions".
- Same "reset the baked settings" choice as Create Profile, so the LUT
  is not applied twice to the photo it was made from.

## Storage and portability

- **Profile file:** `profiles/` in the app data folder, one file per
  profile (fork format, e.g. `.tirprofile`): id (UUID), name, group,
  format version, B&W flag, lattice size, shaper parameters, compressed
  f16 table, content hash.
- **In the edit** (ThisIsRAW XMP payload): `profile: { id, name, hash,
  amount, monochrome, data }` with the table **embedded**. Size guess,
  to measure: 33³ × 3 × f16 = 216 KB raw before compression; 17³ is
  29 KB raw. If an embedded profile's hash is not in `profiles/`, the
  edit still renders from `data` and the browser offers "Save to my
  profiles".
- **Older edits:** no `profile` key → no profile → identical pixels.
- **Presets** carry the profile (reference + data) like LrC presets;
  own Copy & Paste group (`app_settings.rs` group list), Auto Sync,
  history label, `is_image_edited`.
- **Lightroom import** (`lightroom_xmp.rs`): `crs:Look` is reported, not
  imported (unchanged).
- **Platforms:** GPU and file code only; no OS-specific API.

## Phases

1. Engine slot, shaper, Amount, embedded storage, loading `.tirprofile`
   files; Amount bug fix shared with the LUT tool.
2. Create Profile (bake), Profile Browser, presets / Copy & Paste.
3. Save as LUT from the same dialog (finishing LUT, see above), with the
   AgX bake fix.
4. Optional: import `.cube` as a profile (decision 5).
5. Camera profiles (DCP): separate Plan item, after item 19b.

## Tests

- Round trip next to `natural_tone_mapper_round_trips_through_xmp`.
- Identity profile at any Amount renders the same as no profile (f16
  tolerance).
- Bake → reset → apply reproduces the original render of the lattice
  stages (ΔE limit to set from measurement).
- Uniform layout and naga tests for the new bindings.
- Edit with an embedded profile opens on a machine without the file.

## Open decisions (owner)

1. **Exact slot** (the end-of-pipeline slot is ruled out by the owner's
   2026-11-21 decision). (a) after WB + Brightness, before the tonal
   sliders (candidate above) / (b) before Exposure. **Default: (a)**;
   the current LUT stays as the finishing Effects → LUT.
2. **Tonal sliders in the bake** (Contrast, Highlights, Shadows, Whites,
   Blacks): they use the edge-aware tonal base, so a lattice can only
   bake their per-pixel form. (a) exclude / (b) bake the per-pixel form
   with a warning. **Default: (a).**
3. **Curves in the bake.** Curves run after the tone mapper, outside the
   slot. (a) not bakeable / (b) add a 1D tone curve to the profile,
   applied at the slot. **Default: (a)** for Phase 2; (b) later if looks
   without tone feel too thin.
4. **Lattice and embedding.** (a) 33³ embedded / (b) 17³ embedded,
   33³ in the file. **Default: measure first**, then (a) if sidecars stay
   reasonable.
5. **`.cube` import.** `.cube` LUTs assume display sRGB input, which the
   scene slot does not get. (a) not supported (use Effects → LUT) /
   (b) import through an assumed display transform. **Default: (a).**
6. **`lutData`.** Phase 3 makes this more pressing, since saved
   finishing LUTs would otherwise travel as a path only. (a) fill it so
   the existing LUT tool embeds too
   (separate PATCH/MINOR) / (b) leave it. **Default: (a)**, decided
   with item 54.
7. **Plan item number and position.** Owner.
