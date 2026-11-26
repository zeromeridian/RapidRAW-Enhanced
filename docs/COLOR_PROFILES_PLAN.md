# Color Profiles Plan

Status (2026-11-26): **Phases 1 and 2 built as `1.112.0`** on
`dev/custom-profiles` (owner said go 2026-11-26; the owner commits);
decisions 1–7 taken by the owner (below). Plan item 83 in
`UPSTREAM_FEATURE_GAP.md`. Phase 3 and decision 6 (`lutData`) open.

## Progress

- **`1.112.0` (Phases 1–2 core):** new `custom_profile.rs` (data, u16
  table zstd+base64, decoded-table cache, `profiles/*.tirprofile` files,
  commands list/load/delete/create, GPU bake `bake_lattice`); shader
  `apply_profile` after Brightness, `apply_calibrations` before it when a
  profile is on, profile tone curve (`CURVE_OWNER_PROFILE`) before the
  photo's curves, entry point `bake_profile`; uniforms reuse the four
  spare pads plus four curves at the end of `GlobalAdjustments`;
  `RenderRequest::profile` at every render site; frontend Light →
  Profile block (`Profile.tsx`: grouped list, hover preview, Amount,
  clear, delete) and `CreateProfileModal.tsx`; Copy & Paste group,
  History labels; LUT Intensity 0 fix (`Effects.tsx`).
- **`1.112.1` (owner 2026-11-26: "add everything that can be added"):**
  the bake also takes Color Calibration (exact, at its place: before the
  profile when the photo has one, after the tonal sliders otherwise), the
  tone sliders one by one (only Shadows and Blacks approximate: they alone
  read the surround), the Zone Editor (carried like the tone curve, its
  mask smoothing included, applied before the photo's own and in the mask
  blend backdrop, blended by Amount) and the photo's current profile at
  its Amount (`Bake`, `bake_profile` binds its table; the new table takes
  its shaper). A profile carries one curve and one Zone Editor: when the
  current profile, baked in, has one, it wins and the photo keeps its own
  (`kept_keys`, a toast says so). Known limit: a current profile at an
  Amount other than 100 passes its curve and Zone Editor on at full
  strength (its table is baked at its Amount). Not bakeable: everything
  spatial, the tone mapper and the finishing LUT.
- **`1.113.0` (owner's step 2, 2026-11-26; photos keep their copy, owner
  choice):** profiles keep a `recipe` (the ticked settings as the edit
  held them, file only, stripped from edits by `toEmbedded`) and a
  `revision`; right-click **Edit Profile** puts the recipe on the open
  photo's sliders with the profile taken off (Cancel restores the edit),
  **Update Profile** bakes a new revision into the same file and id
  (`update_custom_profile`); **Rename…** changes name, group, B&W flag
  and the file name (`rename_custom_profile`, `save_profile`). `1.112.x`
  profiles have no recipe: rename only. Also the decision 4 table format
  version 2.
- **`1.114.0` (step 3):** a Lightroom-style Profile row (label, field with
  the chosen profile opening the list, clear / create / import buttons;
  owner 2026-11-26: the name at the block's edge got lost); **Save to my
  profiles** for an embedded profile not in the folder
  (`save_embedded_custom_profile`), **Import Profiles…** and right-click
  **Export…** (`import_custom_profiles`, `export_custom_profile`); a
  profile added with an id already in the folder gets a new id
  (`add_to_folder`); table format version 3. Owner's check: all OK.
- **`1.115.0` (step 4):** the list can show a grid of previews (the open
  photo with each profile, its edit as the grid opens, masks left out;
  `generate_profile_previews` with `with_profile` mirroring the
  frontend's `withProfile`; LUT and profile swatches share
  `lut_processing::render_swatch`) or a plain list, remembered
  (`profileBrowserGrid`, default grid); starred profiles listed first
  under Favorites (`favoriteProfiles`, by id, in the app settings).
  Previews do not follow slider moves while the grid is open; they are
  rendered again when it reopens with another edit. Next: 5 `lutData`
  and Phase 3.
- **Deviations from the design below (agent, 2026-11-26):** table stored
  as 16-bit integers and uploaded as `Rgba32Float` (not f16: the
  shaper-encoded values needed the precision); shaper 16 stops below and
  8 above 1.0, and a colour outside that range is scaled into it and back
  (exposure-like), so nothing is clamped (owner's critical point); the
  bake is its own entry point, not a `SAMPLE_PROBE` stage (probes write
  8-bit); Amount 0 switches the profile off entirely, which removes
  decision 1b's side effect; Brightness is bakeable with Tone.
- **"Not yet covered" points resolved:** (1) Glow/Halation light is added
  before the slot, so it passes through the profile (only their internal
  source estimate does not); (2) Dehaze, Centré and Flare are not baked
  and stay per photo, before the profile; (3) the bake reads only the
  global values.
- **Open:** run the GPU bake test on a machine with a GPU (it skips in
  the agent sandbox); measure the XMP size of a 33³ profile (decision 4;
  logged at creation); app checks; Phase 2 extras (Favorites, thumbnail
  grid, "Save to my profiles" for an embedded profile, rename); Phase 3;
  decision 6. A saved Light tool order gets Profile appended last
  (`reconcileOrder`); Customize Panels moves it.

**Goal:** custom profiles as Photoshop's Adobe Camera Raw (ACR) creates
them (owner 2026-11-26): bake a look from the current develop settings
into a profile (a 3D LUT), pick it from a browser, and dial it with an
Amount slider. **Camera profiles are out of scope** (owner 2026-11-26:
not wanted). The profile is the
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
- **Critical: adjustments stack on top of the look, uncapped** (owner
  2026-11-26). Whatever the profile's LUT does, the regular sliders
  must still apply on top of its full result; the values need not add
  numerically (the owner considered and declined settings-based
  profiles that sum values, keeping Adobe-style LUT profiles), but
  nothing may be capped. Example: Exposure +50 in the profile and +70
  on the slider must look brighter than either, not stop at a ceiling.
  Requirements: (1) the LUT works on linear, unclipped values through
  the log shaper and stores its output unclipped (f16), with a shaper
  range wide enough for the look plus extreme slider moves; (2) no clamp
  at 1.0 between the profile and the later sliders, so Highlights,
  Whites, the tone mapper and curves act on the whole result; (3)
  Exposure is bakeable as a relative multiplier (it commutes with the
  photo's own Exposure, so +50 inside and +70 outside look exactly like
  +120); (4) tests for extreme combinations at the shaper's range ends
  (no hard edge, no banding).
- **White Balance bakeable too** (owner 2026-11-26; beyond ACR, which,
  as recalled, does not offer it): an optional Create Profile checkbox,
  off by default. Exposure (`apply_linear_exposure`, × 2^ev) and White
  Balance (`apply_white_balance`, per-channel multipliers) are pure
  multiplications, so baking them as relative multipliers inside the
  LUT is exact and stacks with the photo's own values. Brightness
  (`apply_filmic_exposure`) is a curve: bakeable, stacks visually, not
  an exact sum. After baking, the baked values are reset in the source
  edit as usual.
- **ACR-style custom profiles only, no camera profiles** (owner
  2026-11-26). DCP camera profiles (the old Phase 5) are dropped; the
  removed text is in `HANDOFF-ARCHIVE.md` ("Superseded 2026-11-26").
  Restart: owner request.

## How Adobe does it (ACR and LrC)

- **Custom (creative) profiles** are XMP files holding an RGB 3D LUT
  (plus an optional base camera profile) and allow the **Amount** slider
  (0–200, default 100). LrC uses them but cannot make them.
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
- **Not yet covered (found 2026-11-26):** (1) Glow and Halation run their
  own Brightness and tonal steps on a blurred copy (`apply_glow_bloom`,
  `apply_halation`), so they would not see a profile applied at the
  slot; (2) Dehaze, Centré tone/colour and Light Flare run before the
  slot, so the profile acts on their result and the bake must reproduce
  or exclude them; (3) White balance and Brightness reach the slot as
  `t_*` values, apparently with mask contributions already summed in;
  the bake should use the global values only.

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
  Fog, Relight, Lens Blur, masks), and the tone mapper choice and the
  finishing LUT; curves travel as the profile's own tone curve
  (decision 3). See decision 2 for the tonal
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

## Tests

- Round trip next to `natural_tone_mapper_round_trips_through_xmp`.
- Identity profile at any Amount renders the same as no profile (f16
  tolerance).
- Bake → reset → apply reproduces the original render of the lattice
  stages (ΔE limit to set from measurement).
- Uniform layout and naga tests for the new bindings.
- Edit with an embedded profile opens on a machine without the file.

## Open decisions (owner)

1. **Exact slot. Decided (owner 2026-11-26): (a)**, after WB +
   Brightness, before Contrast/Highlights/Shadows/Whites/Blacks. Owner's
   criteria: closest to real colour profiles, most flexibility, no
   quality loss; (a) matches the DNG order (white balance and exposure,
   then the look table, then the tone curve) and keeps Exposure/WB per
   photo. Lens, noise reduction, sharpening, Clarity, Structure,
   Exposure, Glow, Halation, Flare, Dehaze and Centré also run before
   it. The current LUT stays as the finishing Effects → LUT.
1b. **Color Calibration. Decided (owner 2026-11-26): as close to Adobe
   as possible.** On a photo with a profile, Color Calibration (global
   and per mask) runs before the profile, as in ACR/LrC, where
   Calibration adjusts the camera colour under the look; without a
   profile it stays where it is, so existing edits render identically.
   Side effect: profile set at Amount 0 can differ slightly from no
   profile (Calibration's position); removing the profile restores the
   old render exactly.
2. **Tonal sliders in the bake** (Contrast, Highlights, Shadows, Whites,
   Blacks): they use the edge-aware tonal base, so a lattice can only
   bake their per-pixel form. **Decided (owner 2026-11-26): bake the
   per-pixel form**, closest to ACR; the Create dialog marks these five
   as approximate (close, not identical, mostly Highlights/Shadows on
   detailed areas), and they are reset after baking like the rest.
3. **Curves in the bake. Decided (owner 2026-11-26): the profile
   carries a curve.** Curves run after the tone mapper, outside the
   slot, so the profile stores the photo's tone curve (all channels,
   point and parametric as rendered) next to its 3D LUT and applies it
   at the curve stage, just before the user's own curves, blended by the
   same Amount (like a DNG profile's own tone curve). Exact, closest to
   ACR; the user's Tone Curve stays free and is reset after baking.
4. **Lattice and embedding. Decided (owner 2026-11-26): measure first,
   then 33³ embedded** if the compressed XMP size stays reasonable;
   fall back to 17³ embedded with 33³ in the file only if it does not.
   **Measured (owner, `1.112.1`):** profile files 119–131 KB, a photo's
   `.tirdata` with one 139 KB. **Decided (owner 2026-11-26): shrink it
   losslessly**, 33³ kept: format version 2 (`1.113.0`) stores each
   entry's step from "no change" along red, bytes split (`encode_table`);
   a smooth 33³ test look 200 KB → 23 KB; version 1 still loads.
   **Real profile (owner's "test 3", every group ticked, `1.113.0`):**
   file 82 KB, `.tirdata` 85 KB; table 76 KB as stored. Measured
   alternatives (lossless): red steps with channels planar and zigzag
   55 KB; 3D (Lorenzo) prediction 62 KB; raw residual 68–88 KB. Jumps of
   up to 30,720 of 65,535 sit in the deepest shadows (Color Grading's and
   the colour tools' shifts on near-black values, large in the log
   shaper), so ~55 KB is the lossless floor for such a profile.
   **Decided (owner 2026-11-26): adopt it** as format version 3
   (`1.114.0`: red steps zigzag-coded, channels one after another; smooth
   test look 23 → 14 KB); versions 1–2 still load, a newer version is
   refused instead of misread.
5. **`.cube` import.** `.cube` LUTs assume display sRGB input, which the
   scene slot does not get. **Decided (owner 2026-11-26): not
   supported**; `.cube` files stay finishing LUTs in Effects → LUT, and
   profiles are only those created in ThisIsRAW. Phase 4 is dropped.
6. **`lutData`.** Phase 3 makes this more pressing, since saved
   finishing LUTs would otherwise travel as a path only. **Decided
   (owner 2026-11-26): embed it**: fill `lutData` so the existing LUT
   tool's table travels in the edit (separate PATCH/MINOR); edits
   without it keep loading from `lutPath`.
7. **Plan item number and position. Decided (owner 2026-11-26):** new
   Plan item 83, the next new item, ahead of 57 → 53 → 54; item 54
   (Spektrafilm) later reuses the embedded `lutData` work.
