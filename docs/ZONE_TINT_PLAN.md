# Zone Tint Plan

Status (2026-11-14): **Phases 1 and 2 done** on `dev/zone-tint` (from
`develop` `492bfffe`, committed as `b23d9d3d`), built as `1.57.0`; Zone
Tint then moved to its own right-toolbar panel (`1.57.1`) with an
upright zone scale and a tinted zones list (`1.57.2`), then an overall
Amount and Fill between along a curve (`1.57.3`, uncommitted); the GPU
exit check and the hands-on check still have to run on the Mac. Next:
Phase 3. `UPSTREAM_FEATURE_GAP.md` Plan item 28 (P0, owner
2026-11-13: after item 27, the Orbit Blend Pad, whose steps 1–7 are done).
Item 30 (import from card or camera) follows it. Four phases, each
shippable and gated by its exit check.

**Specification:** the owner's `BW Zone System Coloring.md` (2026-11-13)
is the source of truth for the zone model, colour maths, UI, data model,
phases and acceptance tests. This file holds only what the fork's code
changes about it, the decisions still open, and progress.

## Fit with the current code (checked 2026-11-13)

- **Pipeline position exists.** Black & White is the `monochrome` flag
  (global and per mask). `shader.wgsl` converts the final display sRGB to
  grey with `monochrome_srgb` after exposure, tone, HSL (the B&W mix), colour
  grading, vignette, tone mapping, the point and per-channel curves (global
  and mask) and the LUT, and just before grain. Zone Tint goes directly
  after the global and mask `monochrome` steps: it reads the final tones and
  matches the spec's order (curve and vignette before, grain after). This
  answers the spec's open questions on vignette order (before, as today) and
  on a single place where L is known after the curve (yes).
- **Colour space.** `final_rgb` is display-encoded sRGB at that point, so
  the tint converts `srgb_to_linear` → OKLab, adds (a, b) at the same L,
  then back, with the gamut reduction along the hue.
- **Grain stays neutral:** `grain_delta` adds the same value to all three
  channels.
- **Blend modes:** masks with a non-Normal blend mode composite after grain
  against a monochrome backdrop, so a tinted result blended against it loses
  part of its tint. Decide in Phase 2 whether the backdrop gets the tint too.
- **Colour Grading has no visible effect in B&W today** (it runs before the
  monochrome step), which is the gap Zone Tint fills. It stays as it is.
- **XMP:** the edit's adjustments travel in the fork's ThisIsRAW XMP
  payload, so a new `zoneTint` block syncs once added there; add a round-trip
  test next to `natural_tone_mapper_round_trips_through_xmp` (AGENTS.md
  edit-portability rule). Also: copy/paste groups, presets, the
  `is_visible("color")` section gating in `image_processing.rs`, and
  `INITIAL_ADJUSTMENTS`.
- **GPU data:** the global uniform gets 11 × (a, b) precomputed on the CPU
  plus σ, t, offsets and widths; check the uniform layout test. Per-mask
  Zone Tint (Phase 4) grows `MaskAdjustments` like Plan item 25 (Point Color
  in masks): check the storage-buffer size there.
- **Hover readout:** reuse the probe path the pipettes and Point Color use
  (`curve_probe`/`hsl_probe`, `getPick`) at the Zone Tint stage instead of a
  new CPU buffer.
- **Mask smoothing** needs neighbours: a small blur pass over an L texture
  computed after the curves; the existing blur textures are taken before the
  tone steps and cannot be reused. Phase 3, as the spec says.
- **Histogram alignment:** the histogram's x axis is display sRGB value, not
  OKLab L; place the swatch strip by each zone centre's sRGB value so they
  line up.
- **Lightroom import** maps no split toning or colour grading today, so the
  spec's question about mapping LRC 3-way grading onto Zones II, V and VIII
  is a new import feature, not a change.
- **Curve Stamp** does not exist in TIR yet (ColrBent's); treat it as a
  separate later item.

## Owner decisions (2026-11-14)

- **Ranges of zones:** Shift-click selects every zone between the
  selected one and the clicked one, Cmd/Ctrl-click toggles single zones;
  hue and strength are written into each selected zone, so each can still
  be fine-tuned later (no separate "band" layer). This moves the spec's
  multi-select from Phase 3 into Phase 2.
- **Hue control:** a colour wheel (hue and strength in one control, like
  Colour Grading's wheels), not a hue slider. The wheel's angle must be
  the OKLab hue the Rust side uses (`zoneTint.zones[n].hue`, 0° = +a).
- **Place in the GUI** (revised by the owner 2026-11-14, after `1.57.0`):
  its own panel in the right toolbar (`Panel.ZoneTint`, `Blend` icon,
  after the Orbit Blend Pad), no longer an Adjustments section; not
  inside the Color section and not docked under the histogram. The
  first version (`1.57.0`) was a collapsible Adjustments section shown
  only while Black & White was on. Agent choice (Phase 2): the 11
  swatches are equal width; placed by display value, Zones 0–II would
  share the first ~9 % of the strip.
- **Zone layout** (owner 2026-11-14, option A of four offered): an
  upright scale beside the colour wheel, X at the top, names on the
  left, an accent bar marking the selection, each zone's tint as a band
  on the scale's right edge; readable at any sidebar width. It replaced
  `1.57.1`'s horizontal ramp, which the owner found hard to read when
  narrow. Rejected: two rows, three Zone System groups, Arabic numerals,
  a zone list as the selector. The wheel's label joins neighbouring
  zones into ranges ("Zones IV–VII").
- **Tinted zones list** (owner 2026-11-14): below the sliders, every
  tinted zone, neighbours with the same hue and strength on one line,
  lightest first like the scale, with hue and strength; a click selects
  the zones, × removes their tint (one history step).
- **Overall Amount** (owner 2026-11-14; range agent choice): a stored
  `zoneTint.amount` (0–2, default 1, absent = 1) that multiplies every
  zone's strength in `zone_tint.rs`, the product capped at 100; the zones'
  own values never change. Not in the owner's spec's data model (an
  addition, version stays 1).
- **Ramp across a range** (owner 2026-11-14, chosen over a strength
  curve editor and a curve for Amount): "Fill between" writes the zones
  strictly between the first and last selected zone (an unbroken range of
  three or more) from the ends' tints along a Blend Pad curve
  (`BLEND_PAD_CURVES`, `applyBlendPadCurve` in `utils/blendPad.ts`), as
  ordinary per-zone values in one history step. Agent design: the ends
  are the end zones themselves (no extra pickers); tints blend as
  colour-wheel vectors (hue direction, strength length), like the
  shader's sum, so opposite hues meet in a neutral middle instead of
  sweeping through the hues between (a blue → amber hue blend went green).

- **Blend-mode backdrop:** carries the Zone Tint, so masks in a
  non-Normal blend mode keep the zone colours. Done in `shader.wgsl`: the
  monochrome-and-tinted backdrop is computed once per pixel, only where a
  blend-mode mask covers it.
- **Versioning:** no build for Phase 1; the first build is `1.57.0`
  with Phase 2.

## Open decisions (ask the owner when the phase starts)

- Lightroom 3-way grading import onto Zones II, V, VIII (spec).
- Colour images and monoRAW: out of scope now (spec); confirm.

## Progress

- **Phase 1, maths and shader** (2026-11-14, uncommitted, no version
  yet: nothing writes `zoneTint`, so renders are unchanged).
  `zone_tint.rs`: the `zoneTint` block (spec data model: version 1,
  enabled, zones with hue, strength, centerOffset, width, softness,
  protect; maskSmoothing is left for Phase 3) becomes
  `ZoneTintSettings` (per zone a, b, centre, 1/(2σ²); Protect; enabled
  only for a Black & White photo with its Color section visible and at
  least one tinted zone, a newer version is ignored), the last field of
  `GlobalAdjustments`. `shader.wgsl`: `linear_srgb_to_oklab`,
  `oklab_to_linear_srgb`, `apply_zone_tint` (normalised Gaussian weights
  offset by the nearest zone so narrow zones cannot underflow, Protect,
  chroma reduced along the hue by a 12-step search when out of gamut),
  called right after the global and mask monochrome steps, before
  grain. Tests: `zone_tint::tests` (chroma vector, off cases, clamping),
  `zone_tint_reaches_the_shader_only_for_a_visible_black_and_white_photo`,
  the layout test, and the GPU exit check
  `zone_tint_colours_its_zones_and_keeps_every_tone` (grey ramp, 16-bit
  output: L within 0.001, Zone VII peak, Zone IV neutral, uniform tint,
  clean ends), which **skips in the sandbox (no GPU adapter)**; run
  `cargo test --lib zone_tint` from `src-tauri` on the Mac.
- **Phase 2, panel and saving** (`1.57.0`, 2026-11-14, uncommitted).
  A sixth Adjustments section `zoneTint` (`ADJUSTMENT_SECTIONS`,
  `SectionVisibility`, `CollapsibleSectionsState`, open by default),
  shown only while Black & White is on and never in masks
  (`isAdjustmentSectionShown`, used by `ControlsPanel` and `MasksPanel`);
  its eye switches the tint off (Rust checks `is_visible("zoneTint")`).
  `components/adjustments/ZoneTint.tsx`: the swatch strip (zone grey,
  tint dot, Shift-click range, Cmd/Ctrl-click toggle, never empty), the
  shared `ColorWheel` (new `showLuminance` prop, off here) whose hue and
  saturation become the selected zones' hue and strength, Softness and
  Protect sliders (L ×100). `zoneTint` is `null` until edited
  (`createZoneTint`); reset, copy/paste (own group), presets, history
  label and XMP need nothing else. **Hue is the wheel's (HSV) hue**:
  `zone_tint::oklab_hue` turns it into the OKLab direction of that
  colour, so the photo turns the colour the wheel shows (test
  `wheel_hues_tint_toward_the_colour_the_wheel_shows`). Tests added:
  `zone_tint_round_trips_through_xmp`,
  `a_zone_tint_counts_as_an_edit_only_on_a_black_and_white_photo`.
  Strings in all 12 locales. Exit check (tint, save, reopen, export match
  the preview): **not run in the app yet**.
- **Own panel and new strip** (`1.57.1`, 2026-11-14, uncommitted):
  `components/adjustments/ZoneTint.tsx` became
  `components/panel/right/ZoneTintPanel.tsx` (header with eye and reset;
  on a colour photo the hint plus a Black & White switch). `zoneTint` left
  `ADJUSTMENT_SECTIONS`, `Sections`, `CollapsibleSectionsState` and
  `ADJUSTMENT_SECTION_COMPONENTS`; `isAdjustmentSectionShown` is gone.
  `sectionVisibility.zoneTint` stays (the panel's eye, Rust
  `is_visible("zoneTint")`). The Adjustments reset no longer clears Zone
  Tint; saved section orders or a `section:zoneTint` favourite drop it
  silently. Strings reused (no locale changes).
- **Upright scale and tinted zones list** (`1.57.2`, 2026-11-14,
  uncommitted): `ZoneStrip` became `ZoneScale` beside the wheel;
  `tintRuns` builds the list; `setZonesTint` is shared by the wheel and
  ×. New strings `adjustments.zoneTint.tintedZones` and `.untint` in all
  12 locales; the list's H/S labels reuse the wheel's.
- **Amount and Fill between** (`1.57.3`, 2026-11-14, uncommitted):
  `zone_tint.rs` reads `amount` (test
  `the_amount_scales_every_zone_up_to_full_strength`); the panel gains the
  Amount slider (reuses `adjustments.effects.amount`) and the curve
  dropdown with Fill between (new strings `adjustments.zoneTint.fill`,
  `.fillHint` in 12 locales; curve names reuse the Blend Pad's). The
  Blend Pad's curve list moved from `BlendPadPanel.tsx` to
  `utils/blendPad.ts` so both panels share it.
