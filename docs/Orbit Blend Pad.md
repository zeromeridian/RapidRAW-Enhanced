## Summary and feasibility

**Yes, this is feasible, and the core is small.** Turning a puck position into a set of slider values is a few lines of maths per frame. The real work is in three places: making it feel predictable, keeping the preview fast when heavy tools (Dehaze, local contrast, masks) are on the pad, and storing it so exports and thumbnails match what you saw.

The idea has a known cousin in audio: XY "morph" or "vector" pads that blend several parameters by moving one point. Photo editors mostly don't have it, which is what makes it interesting.

The recommended first version: a circle, up to 8 anchors on its edge, each anchor tied to one parameter with a target value. The centre of the circle is the untouched image; dragging toward an anchor pushes its parameter toward the target. Working name in this doc: **Orbit Blend Pad** ("the pad"). Target host: This is RAW (TIR); the same module could later move into monoRAW with a B&W-only parameter list.

Rough effort for v1 inside TIR: 3–5 weeks of focused work, assuming TIR keeps RapidRAW's split of a React/TypeScript UI, a Rust backend and a GPU shader pipeline. Check that assumption against the repo before planning further.

## The concept

The pad replaces "set five sliders" with "find one place". You choose the parameters, place them around a shape, and explore the space between them by dragging a single point.

How a session goes:

1. Open the pad panel and pick a shape (circle by default).
2. Add parameters from a searchable list of every adjustable tool (Contrast, Shadows, Dehaze, Red Saturation, Blue Hue…). Each becomes an **anchor** on the shape's edge.
3. Give each anchor a **target value** (e.g. Contrast +40, Blue Hue −25). Drag anchors along the edge to rearrange them.
4. Drag the **puck** inside the shape. The image updates live: the closer the puck is to an anchor, the closer that parameter gets to its target.
5. Release. The position is stored with the edit; one undo step covers the whole drag.

Two design rules keep it understandable:

- **The centre is neutral.** Puck in the middle = the image as it was before the pad. That gives a built-in before/after.
- **The pad adds, it doesn't replace.** Its output is an offset on top of the normal sliders, so manual edits still mean something. Sliders show a small ghost marker for the pad's contribution.

## Value model

Every anchor turns the puck's position into a **weight** between 0 and 1; the parameter's offset is that weight times the anchor's target. Everything else is choosing how weight falls off with distance.

For anchor i at position aᵢ, puck at p, both in the shape's normalized space (next section):

```latex
d_i = \lVert p - a_i \rVert, \qquad w_i = f\!\left(1 - \frac{d_i}{r_i}\right), \qquad \Delta v_i = w_i \cdot T_i
```

Here rᵢ is the anchor's reach (default 1 = centre-to-edge, so the centre gives w = 0), Tᵢ is the target offset, and f is a falloff curve clamped to 0–1 (linear, smoothstep, or ease-in). The final value is the slider value plus Δvᵢ, clamped to the parameter's legal range.

Three blend modes, all worth supporting eventually:

|   |   |   |   |
|---|---|---|---|
|Mode|Behaviour|Feels like|Ship in|
|Independent (default)|Each anchor has its own reach; influences can overlap and stack|A map of zones|v1|
|Normalized|Inverse-distance weights that always sum to 1 (wᵢ ∝ 1/dᵢ^k)|Crossfading between presets; never neutral|v2|
|Polar|Angle picks the blend of the two nearest anchors; distance from centre sets intensity|A colour wheel: direction = character, radius = strength|v2|

Independent mode keeps the neutral centre and is the easiest to explain on camera. Normalized is better when anchors are whole looks rather than single sliders. Polar is the most "instrument-like" and suits a circle best.

Per-anchor options: target, reach, falloff curve, invert (push away instead of toward), and mute. Two anchors may control the same parameter (e.g. Contrast +40 at the top, Contrast −30 at the bottom); their offsets add.

## Shapes and normalized space

All maths runs in a normalized space where the shape fits in −1…1 on both axes, so the same weights come out whatever the shape or panel size. A shape only has to answer three questions: is this point inside, what is the nearest inside point (to clamp the puck), and where is the edge point at perimeter position t (0…1, to place anchors).

|   |   |   |   |
|---|---|---|---|
|Shape|Inside test|Anchor position on edge|Notes|
|Circle|x² + y² ≤ 1|(cos 2πt, sin 2πt)|v1 default|
|Ellipse|Scale to a unit circle by its aspect, then test|Circle position, scaled back|Distances measured in circle space so anchors on the long axis aren't weaker|
|Square / rectangle|max(\|x\|, \|y\|) ≤ 1 after aspect scaling|Walk the perimeter by arc length|Corners make natural "extreme" spots|
|Polygon (triangle, hexagon)|Point-in-polygon|Walk vertices by arc length|Triangle with 3 anchors = classic three-way blend|
|Custom path|Signed distance to path|Arc length along the path|Later; nice but rarely needed|

Each shape implements one small interface (`contains`, `clamp`, `pointAt(t)`, `aspect`). Changing shape keeps every anchor's t, so the layout survives the switch. Anchors stay on the edge by default; an "unpin" option lets one sit inside the shape for advanced layouts.

## Architecture inside This is RAW

The pad should be a **resolver** that sits in front of the existing render pipeline: it reads the stored pad and slider values and hands the renderer one flat set of effective values. The renderer never needs to know the pad exists.

Where each piece lives:

|   |   |   |
|---|---|---|
|Component|Layer|Job|
|Parameter registry|Shared (Rust, exported to TS)|One list of every pad-eligible parameter: id, range, neutral value, type (linear / circular / discrete), cost class|
|Pad resolver|Rust (source of truth)|Pure function: adjustments + pad → effective adjustments|
|Resolver mirror|TypeScript|Same maths, for instant slider ghost values and readouts only|
|Pad panel|React|Shape canvas, anchors, puck, anchor inspector|
|Drag controller|React|Pointer events, rAF throttling, gesture start/end for undo|
|Persistence|Existing sidecar (.tirdata)|Stores pad definition + puck position, never the computed values|

The Rust resolver is the source of truth because exports, batch processing and thumbnails are produced in the backend from the sidecar. If the pad were only resolved in the UI, a thumbnail or batch export would silently ignore it. The TS mirror exists so the UI can show numbers without a round trip; a shared set of JSON test vectors keeps the two in step.

Flow of one drag frame:

1. Pointer moves; the controller stores the latest position and waits for the next animation frame.
2. On the frame, the puck position is written into the pad state (clamped to the shape).
3. The UI sends the updated adjustments to the backend through the same path a slider change uses today.
4. The backend resolves the pad into effective values and renders the preview.
5. If a newer position arrived while rendering, the in-between ones are dropped (latest wins).
6. On release, the controller closes the gesture: one undo entry, one sidecar write, and a full-quality render.

## Data model and persistence

The sidecar stores what you did (shape, anchors, puck position), not what it computed. That keeps files small and lets a better resolver improve old edits on purpose rather than by accident.

```
BlendPad {
  version: 1,                 // resolver version, for migrations
  enabled: bool,
  amount: 0..1,               // master strength, scales every offset
  shape: { kind: circle | ellipse | rect | polygon, aspect, rotation, sides? },
  mode: independent | normalized | polar,
  puck: { x, y },             // normalized space
  anchors: [
    { id, param: "basic.contrast", t: 0.25,   // position on the edge
      target: 40, reach: 1.0, falloff: smooth, invert: false, muted: false }
  ]
}
```

Rules:

- One pad per image in v1, stored as a field on the adjustments object so copy/paste settings and presets carry it for free.
- `version` is bumped whenever resolver maths changes. Old files resolve with the old maths unless the user opts in, so exports never shift silently.
- Pad **presets** save shape + anchors without the puck: a reusable instrument. Saving with the puck gives a named look.
- Later: pads per mask (the pad drives a mask's local parameters instead of the global ones). The model already allows it because `param` is just a path.

## Determinism

**The same pad setup and puck position always give exactly the same values.** The resolver is a pure function of the current state. It has no randomness, no memory of the drag path and no dependence on timing, so a spiral drag and a direct jump to the same spot end up identical.

"Same setup" covers all of the following; change any one and the values at that spot change too:

- Shape, its aspect and rotation, blend mode, master amount
- Each anchor's parameter, edge position, target, reach, falloff, invert and mute
- The underlying slider values (the pad adds an offset; the offset at a spot is fixed, the final value follows the slider)
- The resolver `version` stored in the sidecar

Guarantees and their limits:

- **Same machine:** values are identical, bit for bit.
- **Across machines:** floating-point results can differ in a far decimal place. Values are rounded to each parameter's slider step before rendering, so the effective values match.
- **Across GPUs:** the same values can render with tiny pixel differences, as with any GPU editor. This is outside the pad.
- **During a drag:** Heavy tools updating on release (see Real-time performance) can make the preview briefly lag. On release it settles on the exact values for that position.

Test: for a fixed setup, sample a grid of puck positions, resolve each twice and via different drag paths, and assert identical output. Run the same grid in Rust and TS against the shared vectors.

## Real-time performance

The pad's own maths costs microseconds; the risk is that it changes several expensive parameters at once, every frame. Target: the preview keeps up at 30 fps or better during a drag on a mid-range GPU, with a full-quality render within about 300 ms of release.

Techniques, in the order to try them:

1. **Latest-wins frame queue.** Never queue renders; if one is in flight, keep only the newest puck position.
2. **Reduced preview resolution while dragging**, the same trick TIR likely already uses for sliders. Full resolution on release.
3. **Cost classes in the registry.** Cheap (uniform-only shader changes: contrast, exposure, HSL, curves), Medium (needs a blur or pyramid: clarity, local contrast), Heavy (Dehaze with its own estimation pass, AI or luminance masks). Cheap parameters update every frame; Heavy ones can update at a lower rate or only on release, with a small marker on their anchor.
4. **Cache what doesn't depend on the pad.** RAW decode, demosaic and lens corrections sit upstream of all pad-eligible tools; if the pipeline caches the stage before the first changed parameter, a drag only re-runs the tail.
5. **Skip unchanged parameters.** Compare effective values to the last frame and send only diffs.

Measure before optimizing: add a dev overlay with resolver time, IPC time, render time and dropped frames per drag.

## UI and interaction details

Your mockup is already the right panel: dark field, thin outline, labelled anchors, a crosshair at centre. Additions that make it usable rather than just pretty:

- **Influence glow.** Each anchor draws a faint radial gradient showing its reach, so you can see where zones overlap before you drag.
- **Live readout.** While dragging, each anchor label shows its current offset ("CONTRAST +27"). Fades out after release.
- **Snap and fine control.** Double-click the puck to return to centre. Hold Shift for a 4× finer drag; hold Alt to lock movement to the line toward the nearest anchor.
- **Anchor editing.** Click an anchor to open a small inspector (target, reach, falloff, invert, mute). Drag it along the edge to move it. Right-click to remove.
- **Keyboard.** Arrow keys nudge the puck; Tab cycles anchors. This also makes the pad accessible without a mouse.
- **Panel size.** Square panel in the right sidebar, with an option to pop it out larger. All maths is size-independent.
- **Limit of 8 anchors.** More than that and the labels collide and the zones become too small to aim at.

The parameter picker should group tools as the sidebar does (Basic, Curves, Color, Details, Effects) and grey out ones that can't go on a pad (see Edge cases).

## Edge cases

|   |   |
|---|---|
|Case|Handling|
|Hue parameters (wrap around)|Treat as circular: offsets add modulo the hue range, so −90 and +270 behave the same|
|Toggles and dropdowns (e.g. a film sim choice, on/off)|Not pad-eligible in v1. Later: switch when weight passes 0.5, with a visible threshold ring|
|Slider value + offset beyond range|Clamp the effective value; show the anchor label in a warning tint when clamping|
|Same parameter on two anchors|Offsets add, then clamp|
|Parameter also moved by hand|Allowed; the pad offset sits on top. A "bake" action writes the effective values into the sliders and resets the pad|
|Curve points as parameters|Expose each curve's shadows/midtones/highlights handles as numeric parameters rather than the whole curve|
|Tool disabled or removed by an update|Anchor stays but shows as inactive; resolver skips it|
|Puck exactly on an anchor (normalized mode)|Guard against divide-by-zero: that anchor gets weight 1|
|Shape changed after anchors placed|Anchors keep their perimeter position t; puck is re-clamped|

## Phased roadmap

Start with a throwaway prototype to test the feel before touching TIR; the feel is the part most likely to need rethinking.

|   |   |   |   |
|---|---|---|---|
|Phase|Scope|Rough effort|Done when|
|0. Feel prototype|Standalone web page: a JPEG, WebGL for 4–5 cheap adjustments, circle pad, independent mode|2–4 days|Dragging feels predictable and you'd use it on a real photo|
|1. TIR v1|Parameter registry, Rust resolver + TS mirror, circle, independent mode, up to 8 anchors, sidecar, undo, latest-wins rendering|3–5 weeks|Exports and thumbnails match the preview; 30 fps drag with cheap tools|
|2. Shapes and modes|Ellipse, rectangle, polygons; normalized and polar modes; per-anchor falloff; pad presets; "bake"|2–3 weeks|Switching shape or mode never loses the layout|
|3. Depth|Pads per mask, heavy-tool cost handling, discrete parameters, puck path recording and playback|3–4 weeks|A recorded drag can be replayed frame-accurately|
|4. Reach|Port to monoRAW with a B&W parameter list; MIDI / gamepad / tablet XY input|Open|Same pad file format works in both apps|

Path recording in phase 3 has a ColrBent angle: replaying a slow drag across the pad is a ready-made way to show on video how an image's mood shifts, and a saved pad preset could sit alongside a Curve Stamp as a named, shareable "bend".

## Risks, open questions, testing

**Risks**

- **It feels random.** With many overlapping anchors, small moves cause changes nobody can predict. Mitigation: neutral centre, influence glow, 8-anchor cap, and the phase 0 prototype.
- **Heavy tools stutter.** Dehaze or mask-driven parameters on the pad may drop the frame rate. Mitigation: cost classes and deferred updates.
- **Preview and export drift.** Two resolver implementations could disagree. Mitigation: Rust is the source of truth; shared test vectors run in both CI suites.
- **Upstream churn.** RapidRAW changes may rename or restructure adjustment fields. Mitigation: the parameter registry is the only place that knows field paths.

**Open questions**

- Does TIR's preview already render at reduced resolution during slider drags, and how is that triggered?
- Is the adjustments object passed to the backend whole on each change, or as diffs?
- Should the pad offset apply before or after Auto adjustments, if TIR has them?
- One pad per image, or several stacked pads?

**Testing**

- Unit tests on the resolver: weight is 1 on an anchor and 0 at the centre (independent mode, reach 1); normalized weights sum to 1; hue offsets wrap; clamping holds.
- Shared JSON test vectors (pad + puck in, effective values out) run by both Rust and TS.
- Golden-image tests: a fixed RAW, fixed pad, fixed puck positions, compared against stored renders with a small tolerance.
- Performance benchmark: scripted 5-second drag, reporting average frame time and dropped frames per cost class.
- Sidecar round-trip and version-migration tests.