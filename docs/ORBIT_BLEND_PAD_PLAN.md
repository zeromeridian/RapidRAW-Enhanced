# Orbit Blend Pad Plan

Status (2026-11-13): **steps 1 (`1.49.0`, owner commit `59e355b6`), 2
(`1.50.0`, owner commit `65c00ea1`), 3 (`1.51.0`, owner commit
`a5b55723`), 4 (`1.52.0`, owner commit `90583026`) and 5 (`1.53.0`,
uncommitted) done** on `dev/orbit-blend-pad`: all five planned steps
built. Next: steps 6–8 below (owner, 2026-11-13); the owner's hands-on
checks and merge whenever they choose.
`UPSTREAM_FEATURE_GAP.md` Plan item 27.

**User guide:** `ORBIT_BLEND_PAD_GUIDE.md` explains every behaviour with
examples (owner, 2026-11-13); keep it in step with each change.

**Owner decisions (2026-11-13):** brought forward, ahead of the remaining
P1 items (14–16). **No standalone prototype:** the pad is built inside
ThisIsRAW in five steps, one MINOR version each. The owner's prototype
specification below stays as the reference for the value model, the
interaction and the tests; its standalone-page parts (WebGL page, `pad.js`
as a classic script, `npx serve`, README) no longer apply.
`docs/orbit-blend-pad.html` (the owner's Phase 1 reference page) and
`docs/Orbit Blend Pad.md` (the owner's concept note for TIR) were read in
full at the start.

**Design (agent, from the concept note):**
- The pad **adds on top of the sliders** (confirmed by the owner,
  2026-11-13: keep it this way): its offsets are added to the slider
  values, so they combine or cancel out, the total kept within the
  slider's range (hue wraps); with the puck at the centre the photo looks
  as the sliders set it. The pad never moves a slider; only Bake (step 3)
  writes its offsets into them. The stored edit keeps the pad (shape, anchors, puck,
  amount), never the computed values.
- **Rust is the source of truth.** `blend_pad.rs` resolves the pad inside
  `get_all_adjustments_from_json`, so preview, export, thumbnails, batch
  and the "edited" check all see it; XMP sync carries `blendPad` with the
  rest of the adjustments. The UI gets a TypeScript copy of the maths for
  live readouts (step 2), kept in step by shared test vectors.
- Value model: the specification's axis model with two-sided
  normalisation (`w = ±1` at the anchor and at its opposite edge point,
  curve on |w|, × target × amount). Anchors on one parameter add; the sum
  is clamped to the slider's range (hue wraps), rounded to the slider's
  step, then added to the slider and clamped again.
- Parameters (step 1): the cheap global sliders, all uniforms in the main
  shader: Exposure, Brightness, Contrast, Highlights, Shadows, Whites,
  Blacks, Temperature, Tint, Vibrance, Saturation, Hue, Clarity, Dehaze,
  Structure, Centré, Vignette Amount. A hidden section (eye off) also
  hides the pad's offsets on it.
- Agent defaults, to confirm with the owner when the step that uses them
  starts: at most **8 anchors** (concept note; the prototype spec said 5),
  perimeter position `t` from the right, anticlockwise (top = 0.25).

**Steps:**
1. **Resolver and data** (`1.49.0`): `blendPad` in the adjustments,
   `blend_pad.rs` with the parameter list and the circle, applied in
   `get_all_adjustments_from_json`; tests from the specification (±1 and
   0, defaults at the top give Contrast +60 / Temperature −25 /
   Saturation +30, stacking and clamping, hue wrap, deterministic grid,
   muted and unknown anchors). No UI: no visible change yet.
2. **Pad panel** (`1.50.0`): the circle with three fixed anchors
   (defaults Contrast +60 top, Temperature +50 bottom-right, Saturation
   −60 bottom-left), tool and target per anchor, puck drag (latest frame
   wins, Shift 4× finer, arrow keys, double-click to centre, the puck
   moves only when grabbed), live values, Amount, on/off, Before (`\`)
   as today, one undo step per drag, copy/paste and presets carry it, the
   TypeScript resolver with the shared vectors. The panel is its own tab
   in the right-panel switcher, like Favorites (owner, 2026-11-13).
3. **Anchor editing** (`1.51.0`). **Also new tools (owner, 2026-11-13):
   Blur, Glow, Light Flare and Grain** on the pad. Checked: Grain and Glow
   are plain uniforms; Flare's generation pass already runs every frame
   while Flare is above 0, so a pad drag costs what a slider drag does.
   **Blur = a new photo-wide Gaussian Blur** (owner, 2026-11-13): the
   masks' Gaussian Blur (one Amount slider, 0–100, a mix toward the cached
   ~40 px structure blur) brought to the whole photo as an Effects slider,
   then put on the pad. Motion Blur and Lens Blur stay off the pad.
   **At most 8 anchors** (owner, 2026-11-13). One-sided tools (Glow,
   Flare, Grain, Blur, 0–100) must still combine and cancel with their
   slider, so the anchors' sum is no longer clamped to the slider's range
   (that dropped every negative offset); only the slider plus the sum is.
   Then: add a tool at the largest free gap,
   drag anchors along the edge, an inspector (target, curve, mute,
   remove), opposite-point markers, a ghost marker on each slider for the
   pad's offset, Bake (write the offsets into the sliders, centre the
   puck).
4. **Shapes** (`1.52.0`). **Also (owner, 2026-11-13):** a slider the pad
   moves shows the combined value (slider + pad) next to its own value,
   in brackets, e.g. "+20 [+60]", only while the pad moves it; it goes
   with the ghost tick from step 3 (same `blendPadValue`).
   Then: triangle, square, rectangle, pentagon, hexagon,
   from one shape definition (outline, clamp, opposite points) in Rust
   with its TypeScript copy; anchors keep `t` when the shape changes.
5. **Pad presets** (`1.53.0`): named presets (shape and anchors, with or
   without the puck), load, rename, overwrite, delete, export and import
   JSON, cleaned by the resolver's sanitising, versioned.

**Further steps (owner, 2026-11-13: schedule these), smallest first:**
5a. **Clarity** (`1.54.0`, S–M; owner 2026-11-13 after a hands-on test:
   Whites −80 with the puck opposite brightened the photo, correctly, but
   the label showed only "→ −80"). All three agreed fixes:
   (1) pad labels and tool cards always show the tool's current value
   ("now +75"), the target smaller; (2) the selected tool's line drawn
   from its dot to its opposite ring, labelled with the value at both
   ends, and "Target" renamed "At the dot"; (3) a per-tool **Reverse**
   switch (on by default, as now): off, the tool fades to 0 at the
   centre and gives nothing beyond it. (3) changes the maths: Rust and
   the TS mirror, a shared vector, an optional anchor field (pad format
   stays version 1), presets carry it.
6. **Remember each tool's target** (`1.55.0`, S; done, see Progress).
   **Also (owner, 2026-11-13): a new pad's default tools become
   Exposure +0.50, Whites +25 and Blacks −25** (instead of Contrast,
   Temperature, Saturation), at the top, bottom right and bottom left.
   Original note: an anchor keeps the
   last target per tool, so switching Exposure → Contrast → Exposure
   restores the Exposure target instead of converting the share. Stored
   with the anchor (pad format stays version 1, the extra field is
   optional; Rust ignores it).
7. **Blend modes** (`1.56.0`, M): besides Axis (today), **Normalized**
   (inverse-distance weights that always sum to 1: crossfades between
   tools, never neutral; guard the puck exactly on an anchor) and
   **Polar** (direction picks the blend of the two nearest anchors,
   distance from the centre sets strength). One `mode` field on the pad,
   resolved in Rust with the TS mirror and new shared vectors; mode
   picker in the panel; presets carry it.
8. **A pad per mask** (`1.57.0`, L): each mask can have its own pad that
   drives that mask's sliders (`MaskAdjustments`), resolved in
   `get_mask_adjustments_from_json` like the photo's; the pad panel edits
   the selected mask's pad when a mask is active; copy/paste and presets
   of masks carry it; check the mask parameter list (masks' slider
   ranges differ, e.g. noise reduction) and the "edited" check.

**Deferred (owner, 2026-11-13):** heavier tools on the pad (Motion Blur,
Lens Blur, Color Mixer channels, curve handles; would update on release).
Restart: when the owner asks.
**Not wanted for now (owner, 2026-11-13):** drag recording and playback;
more shapes (ellipse, custom outline). Restart: when the owner asks.

**Progress:**
- Step 1 (`1.49.0`, 2026-11-13, owner commit `59e355b6`):
  `src-tauri/src/blend_pad.rs` (`PARAMETERS`, `Shape::Circle` with
  `point_at`/`clamp`/`axis_weight`, `Curve`, `Offsets`), resolved in
  `get_global_adjustments_from_json`'s `get_val` (no copy of the
  adjustments JSON per frame; a slider the pad does not move keeps its
  value exactly). `BlendPad`/`BlendPadAnchor` types and `blendPad: null`
  default in `src/utils/adjustments.ts`. 14 tests (12 in `blend_pad`, 2 in
  `image_processing`). Copy/paste group, history label and the
  TypeScript resolver come with the panel in step 2.
- Step 2 (`1.50.0`, 2026-11-13, owner commit `65c00ea1`): `BlendPadPanel.tsx`, a
  right-panel tab after Favorites (`Panel.BlendPad`, Orbit icon). The pad
  is an SVG (theme colours, axis gradients, labels inside the view box,
  live values while dragging); the puck moves only when grabbed, one
  update per animation frame, Shift ×0.25, arrows 0.02 (Shift 0.005),
  double-click centres; drag sets `isSliderDragging`, so history merges
  a drag into one step. Per slot: tool dropdown and target slider; a new
  tool keeps the target's share of its range (agent's choice). Amount,
  on/off, header Centre and Reset. A photo without a pad shows the
  default one; the first change stores it. Parameters come from Rust
  (`get_blend_pad_parameters`, `useBlendPadParameters`); `utils/blendPad.ts`
  mirrors the maths, checked with Rust against `blendPad.vectors.json`
  (`node scripts/check-blend-pad.mjs`, 12 cases). Slider labels shared
  with Favorites through the new `useControlLabel`. Copy/paste group
  "Blend Pad" (presets follow it), history label, strings in 12 locales.
- Step 3 (`1.51.0`, 2026-11-13, owner commit `a5b55723`): **photo-wide Gaussian
  Blur** (`GlobalAdjustments.gaussian_blur_amount` in the retired
  `_pad_motion_blur1` slot, no layout change; shader mixes toward the
  cached structure blur before the masks' blur; Effects slider for photo
  and masks through `AdjustmentSlider`, copy/paste group, Effects reset
  list). **21 pad tools** (`gaussianBlurAmount`, `glowAmount`,
  `flareAmount`, `grainAmount` added). **Sum limit:** the anchors' sum is
  bounded by the slider's whole span (`limit_offset`), only slider + sum
  by its range, so one-sided tools combine and cancel. **Panel:** anchor
  cards (tool, target ±reach, curve, mute, remove; min 1), Add tool
  (largest free gap, 40 % of the reach, max 8), drag a dot along the edge,
  selection ring, opposite-point rings, Bake (header stamp; offsets into
  the sliders, puck centred, one labelled history step), ghost tick on
  the photo's sliders (`Slider.ghostValue`, from `blendPadValue`).
  Vectors: 13 cases. Agent choices: a new tool's target is 40 % of its
  reach; a target's double-click reset returns there too.
- Step 4 (`1.52.0`, 2026-11-13, owner commit `90583026`): `Shape` gains Triangle,
  Square, Rectangle (3:2), Pentagon, Hexagon from one definition
  (`corners`, `perimeter_path`, `point_at` by arc length from where the
  +x ray meets the outline, `edge_distance` by ray–edge intersection,
  radial `clamp`); `utils/blendPad.ts` mirrors it step for step, plus
  the UI-only `positionOf` (pointer → perimeter position, its inverse)
  and `oppositePoint`. Panel: Shape picker (keeps `t`, re-clamps the
  puck), outline/clip/gradients/opposite rings follow the shape, labels
  placed from each dot. Sliders show the combined value as "[60] 20"
  (`Slider.ghostValue`, tooltip "With the Blend Pad"). Tests: every
  shape gives +1 at the anchor (corners included), −1 at the opposite
  point, 0 at the centre, clamps inside and keeps weights in −1…1; the
  triangle's two sides differ; vectors 18 cases (square, triangle,
  hexagon); the Node check also round-trips `positionOf` on every
  shape. Agent choices: every shape fits the unit circle (labels keep
  their room); triangle, pentagon, hexagon have a corner at the top,
  square and rectangle sit flat; the rectangle is 3:2 landscape; the
  puck is clamped toward the centre (radially), not to the nearest edge
  point.
- Step 5 (`1.53.0`, 2026-11-13, uncommitted). Owner decision
  2026-11-13: pad presets hold only the pad and live in the pad panel,
  stored like the tone curve presets (app settings,
  `AppSettings.blend_pad_presets`); regular presets keep including the
  pad. `utils/blendPad.ts`: `sanitizeBlendPad` (never trusts input:
  version 1 only, unknown tools and bad values dropped, targets within
  reach and on the step, ≤ 8 anchors, puck inside the shape),
  `BlendPadPreset` (`includesPuck`; without it the puck is stored and
  loaded at the centre), create/load/update/dirty helpers,
  `sanitizeBlendPadPresets` (also makes ids and names unique, "Name 2").
  `BlendPadPresetBar.tsx`: preset picker (modified "*"), Save/Update
  button, "more" menu (Save as new, Rename, Delete, Export one, Export
  all, Import). Rust `export_blend_pad_presets` / `import_blend_pad_presets`
  write and read the JSON file (format marker and version; import also
  takes a bare list or one preset). The curve name modal became the
  shared `PresetNameModal` (texts as props, optional extra controls;
  `normalizeToneCurvePresetName` renamed `normalizePresetName`); Curves
  looks and works as before. Tests: Rust settings and file round trips;
  the Node check round-trips every vector case through a preset and
  checks the cleaning (unknown tool, limit, bad values, newer version,
  clashing names).
- Step 7 (`1.56.0`, 2026-11-13, uncommitted): `blend_pad::Mode`
  (Axis default, Normalized, Polar; `mode` on the pad, absent = Axis; an
  unknown mode makes Rust ignore the pad, TS cleaning maps it to Axis).
  `from_pad` now collects the taking-part tools (valid, not muted, known
  slider) and asks `Mode::factors` for each tool's factor; Axis keeps the
  exact old arithmetic (all earlier tests and vectors unchanged).
  Normalized: shares 1/d² normalised to 1, a dot takes all, curve on the
  share. Polar: the neighbours around the puck's direction (first on
  ties, wrapping past 0) mixed by angle, strength = distance / edge
  distance, curve on the strength; one tool = distance only. TS:
  `modeFactors` + `anchorValues` (all tools' current values together,
  used by the labels, cards and `resolveBlendPad`). Panel: Mode picker
  with a hint; opposite rings, the selected line, Reverse and the far
  glow only in Axis. Vectors 23 (4 mode cases); Rust tests for both
  modes and an unknown mode. Guide: "Blend modes" with Examples 9–10.
  Agent definitions (from the concept note): Normalized exponent 2;
  Polar mixes linearly by angle.
- Step 6 (`1.55.0`, 2026-11-13, owner commit `69b62d6f`): `BlendPadAnchor.targets`
  (optional map tool → last value at the dot; the renderer ignores it,
  `sanitizeBlendPad` keeps known tools within reach, the "modified" check
  leaves it out); `switchAnchorTool` restores a remembered target or
  keeps the share for a new tool; `targetWithinReach` now shared by the
  share rule and the cleaning. New pads default to **Exposure +0.50**
  (top), **Whites +25** (bottom right), **Blacks −25** (bottom left)
  (owner 2026-11-13, values chosen from the agent's options). Guide:
  new Example 4 (switching back), defaults stated, examples renumbered.
  Node check: defaults, share for a new tool, both restores, unknown and
  same tool. No Rust change.
- Fix `1.54.1` (2026-11-13, owner commit `3f5e3b10`; owner report): the preset
  picker forgot the loaded preset when the panel was switched (its
  selection was component state). The pad now records `presetId` (set on
  load and on "Save as new"; ignored by the renderer, stripped from
  presets, excluded from the "modified" check), so the name survives
  panel switches, reloads and copy/paste; a deleted preset simply
  matches nothing.
- Step 5a (`1.54.0`, 2026-11-13, owner commit `40de3841`): pad labels always show "now X" (accent) and "→ target" (grey,
  `tspan`s); tool cards: "At the dot" with "now X" as the slider's label
  addon; selected tool: dashed line dot → opposite point with the far
  value (`SelectedAxis`); per-tool **Reverse** (`Anchor.reverse` in Rust,
  `#[serde(default = true)]`; `BlendPadAnchor.reverse?` in TS, absent =
  on; off: a negative weight contributes nothing); reverse-off tools fade
  their opposite ring and the far half of their glow. The preset
  "modified" check treats a missing `reverse` as on. Shared `Switch` now
  honours its `id` prop (several "Reverse" switches share a label).
  Vectors 19 cases. `ORBIT_BLEND_PAD_GUIDE.md` written (owner request).

## Owner's specification (2026-11-13; verbatim, headings one level down)

### Task: Build the "Orbit Blend Pad" in four phases

Build a standalone web prototype of a new photo-editing control, one phase at a time. Each phase must work and pass its tests before the next one starts. The question behind it all: is dragging a single point to blend several adjustments predictable and pleasant?

Favour speed and clarity over architecture. Keep the pad maths in its own module, because it will be ported later. Write it so the later phases add to it rather than replace it.

`orbit-blend-pad.html` is a working reference for Phase 1. Match how it behaves, in Blend → Axis mode.

#### The control

Adjustment parameters ("tools") sit as **anchors** on the edge of a shape. Each anchor has a **target value**. Each tool works along an **axis** that runs from its anchor, through the centre, to the opposite edge. Dragging a **puck** inside the shape sets a value for every tool, and the photo updates live.

These rules hold in every phase:

- **The centre is the midpoint:** with the puck at the centre every tool is at 0, so you see the original photo.
- **Each axis is two-sided:** a tool reaches its full target at its anchor and the exact reverse at the opposite edge. For example, Contrast +60 at the top becomes −60 at the bottom.
- **Tools pull on each other:** moving the puck towards one tool also moves the other tools along their axes. With three tools 120° apart, heading straight for one anchor pushes the other two halfway in reverse. This is intended.
- **Deterministic:** the same anchors, settings, shape and puck position always give identical values, whatever path the drag took.
- **The puck moves only when grabbed:** clicking empty pad space does nothing. Double-click the puck to send it back to the centre.

#### Value model (shared by all phases)

All maths runs in normalized space, with the shape centred on (0,0). The edge is a closed outline, and an anchor sits at a perimeter position t (0..1) along it. For a circle of radius 1, that's (cos 2πt, sin 2πt).

```
u_i     = a_i / |a_i|                    (unit direction of anchor i)  
s       = p · u_i                        (how far the puck has travelled along that direction)  
w_i     = s / |a_i|          if s >= 0   (towards the anchor)  
        = s / |o_i|          if s <  0   (towards the opposite edge point o_i)  
w_i     = clamp(w_i, -1, 1)  
value_i = target_i * curve(|w_i|) * sign(w_i) * amount
```

- On a circle, |a_i| = |o_i| = 1, so w_i is simply p · a_i.
- o_i is where the ray from the centre in direction −u_i leaves the shape.
- curve: linear (default) | soft (smoothstep, gentler near the centre) | ease-in. The same curve is applied on both sides of the centre.
- The puck is clamped to the inside of the shape.
- When two anchors share a parameter, their values add, then clamp to the parameter's range.
- One-sided parameters (such as Fade, 0..100) clamp at 0 on their reverse side.
- Hue offsets wrap instead of clamping.

Put this in `pad.js` as pure functions with no DOM access: `resolvePad(pad) -> { paramId: value }`. It returns every known parameter, with 0 meaning neutral. It must load as a classic `<script>` and as a Node module.

#### Adjustments (shader, all phases)

Use WebGL2 in a fragment shader. Images are JPEG or PNG, scaled down to at most 2048 px on the long edge. Every adjustment is cheap and driven by a uniform:

- Exposure (-2..+2 EV)
- Contrast (-100..+100, S-curve around mid-grey)
- Shadows (-100..+100, lift/drop luminance below ~0.4 with a smooth mask)
- Highlights (-100..+100)
- Saturation (-100..+100)
- Temperature (-100..+100, warm/cool tint)
- Fade (0..100, lifts the black point)
- Hue shift for one colour band, such as blues (-180..+180)

---

#### Phase 1: three fixed tools on a circle

Scope:

- A circle with exactly **3 anchor slots, fixed and evenly spaced**: top, bottom-right and bottom-left, 120° apart. Anchors cannot be moved.
- Each slot has a dropdown to pick its tool and a target control. Defaults: Contrast +60 (top), Temperature +50 (bottom-right), Saturation −60 (bottom-left).
- The curve is fixed at linear.
- Image picker plus drag-and-drop. The image is on the left. On the right is a square pad on a dark field (#141414) with a thin light outline, a small crosshair at the centre, and anchors as light dots with uppercase labels outside the circle. Labels must never be clipped by the pad's edge.
- A faint gradient along each axis shows its direction: warm on the positive side, cool on the reverse.
- Drag the puck to update the image. Shift gives 4x finer drag, and arrow keys nudge the puck. While dragging, live labels show each tool's current value.
- A master "amount" slider (0..1), plus a "Hold for original" button and the \ key, which do the same thing.
- Pointer moves are throttled to requestAnimationFrame, and only the latest position is rendered. A small FPS counter sits in a corner.

Tests (`pad.test.js`, plain Node with `assert`, no framework):

- w = +1 on an anchor, 0 at the centre and −1 at the opposite edge
- with the defaults, the puck at the top gives Contrast +60, Temperature −25 and Saturation +30
- a one-sided parameter clamps at 0 on its reverse side
- stacking when two slots share a parameter, then clamping
- hue wrap
- resolving a grid of puck positions twice gives identical output

Done when the tests pass, the page runs at 30 fps or better while dragging a 2048 px image on a laptop, and a short README explains how to run it.

#### Phase 2: up to 5 tools, placed by the user

Adds:

- An "Add tool" dropdown places a new anchor at the largest free gap on the edge. **Maximum 5 anchors**, minimum 1.
- Drag anchors along the edge to place them.
- Click an anchor to open a small inspector with target, curve, mute and remove.
- Optional: show a faint marker at each anchor's opposite edge point, so you can see where its reverse sits.
- Default setup: the Phase 1 three.

Tests: add tests for the curve options (still ±1 at the ends and 0 at the centre), mute, largest-gap placement and the 5-anchor limit.

#### Phase 3: additional shapes

Adds:

- A shape picker: circle, triangle, square, rectangle, and optionally pentagon and hexagon. Each shape is centred on (0,0) and scaled to fit the pad.
- Anchor positions stay as perimeter t (0..1). When the shape changes, anchors keep their t and move to the same relative position on the new outline.
- Use the two-sided normalization from the value model, so every anchor still gives exactly +1 at the anchor and −1 at its opposite edge point. On a triangle these two distances are different.
- Puck clamping, opposite edge points and the outline drawing all come from one shape definition in `pad.js`.

Tests: for every shape, check the centre gives 0, w = +1 on an anchor (corners included), w = −1 at its opposite edge point, the puck clamps inside the outline, and w never leaves −1..1.

#### Phase 4: save and load named presets

Adds:

- Save the current setup as a named preset, with shape, anchors and all their settings, puck and amount. Presets can be loaded, renamed, overwritten and deleted.
- Presets are stored in localStorage, wrapped in try/catch, so the page still works when storage is unavailable.
- "Export JSON" and "Import JSON" for one preset or all of them.
- The preset schema has a `version` field. Presets saved in earlier phases (circle only) load in later ones. Invalid or unknown fields are cleaned up by a pure `sanitizePad` in `pad.js`, never trusted.

Tests: round-trip save and load gives identical `resolvePad` output, and `sanitizePad` rejects bad input, drops unknown tools and enforces the anchor limit.

---

#### Constraints for all phases

- `index.html` plus `pad.js`, `pad.test.js` and at most one more JS file. Plain JS with no framework, no build step and no dependencies. It must run by opening the file or with `npx serve`.
- At the end of each phase, update the README with how to run it and anything that felt wrong while you built it.

#### Out of scope

RAW files, blend modes other than axis blending, exporting the edited image, undo history, mobile layout.
