# Orbit Blend Pad Plan

Status (2026-11-13): **not started.** `UPSTREAM_FEATURE_GAP.md` Plan item 27
(P0, owner 2026-11-13: start after the remaining P1 items). Phases run in
order; each must work and pass its tests before the next starts.

**Open before Phase 1** (ask the owner when the item starts):
- The Phase 1 reference `orbit-blend-pad.html` (owner, 2026-11-13) is in
  `docs/`, tracked: one self-contained page ("Orbit Blend Pad · Phase 1",
  473 lines, inline script, a Blend → Axis mode). Read it fully before
  Phase 1; decide with the owner whether it moves next to the prototype.
- `Orbit Blend Pad.md` (owner, 2026-11-13): the owner's feasibility and
  concept note for the control inside TIR (up to 8 anchors, effort,
  preview speed, storage). Background for porting the prototype later;
  read it before Phase 1.
- Where the prototype lives (for example `prototypes/orbit-blend-pad/` in
  this repository, or a separate folder) and whether it is committed.
- "Run with `npx serve`" conflicts with the no-npm-registry rule for agents
  (owner, 2026-11-04): agents verify by opening the file (or a local static
  server that needs no download); the README may still mention `npx serve`.

**Progress:** none yet. Record each finished phase here (date, what passed,
what felt wrong) and keep the README in step.

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
