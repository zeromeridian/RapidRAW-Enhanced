# Zone Tint Plan

Status (2026-11-13): **not started.** `UPSTREAM_FEATURE_GAP.md` Plan item 28
(P0, owner 2026-11-13: after the remaining P1 items and after item 27, the
Orbit Blend Pad). Four phases, each shippable and gated by its exit check.

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

## Open decisions (ask the owner when the item starts)

- Hue control: full wheel per zone or hue slider with swatch (spec).
- Blend-mode backdrop with Zone Tint (above).
- Lightroom 3-way grading import onto Zones II, V, VIII (spec).
- Colour images and monoRAW: out of scope now (spec); confirm.

**Progress:** none yet. Record each finished phase here (version, date,
exit check result).
