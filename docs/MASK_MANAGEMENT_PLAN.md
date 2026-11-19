# Mask Management Plan (LrC-style components)

Status: proposed (owner, 2026-11-17). WP0's code fix done as item 43
(`1.85.2`, owner commit `9563da6f` on `fix/mask-drop-insert`), but the
drop it fixes cannot be reached yet (see P1); making it reachable is
part of WP3 (owner 2026-11-17). WP1 done (`1.93.0`, branch
`dev/mask-revamp`, not committed; owner decision 2026-11-18: first
component is the base). WP5 done next (`1.94.0`, same branch, not
committed), brought forward after the owner found mask updates slow
(2026-11-18). WP2, WP3, WP4 and WP6 not started. Plan item 51 in
`UPSTREAM_FEATURE_GAP.md`. Code check
2026-11-17: section 1 and the problems P1, P2 and P7 match the code. Item 41
(stronger feather) follows this plan.

Progress:

- WP1 (`1.93.0`): `generate_mask_bitmap` takes the first component that
  returns a bitmap as the base (after its invert and opacity); this covers
  masks and AI edits, since both use it. Frontend `withAdditiveBase` /
  `withAdditiveBases` (`utils/adjustments.ts`) store the first component
  as Additive on load (`normalizeLoadedAdjustments`) and after every add,
  delete, paste, duplicate and drag in `MasksPanel.tsx` and `AIPanel.tsx`.
  Hiding the first component does not rewrite modes: the next visible one
  renders as the base but keeps its stored mode for when the first is
  shown again. Row 1 already had no mode button; its "Base" tooltip comes
  with WP2's badge. Three new Rust tests cover section 5's cases except
  the order of Additive components and the WP5 cache key.
- WP5 (`1.94.0`): `MaskCaches` in `AppState.mask_cache` holds whole masks
  and components, each a `BitmapCache` bounded at 256 MB that drops the
  least recently used (a small map in `mask_generation.rs`; `hashlink`
  is only a transitive dependency, so none was added).
  `sub_mask_cache_key` hashes type and parameters (destructured; id,
  visible, invert, opacity and mode left out, since they apply after
  drawing). Colour and luminance masks were never invalidated by a
  geometry change (the key held no geometry); both keys now add
  `calculate_geometry_hash` for masks/components that read the warped
  photo. `combine_mask_bitmap` takes the component bitmaps from a
  closure (fresh in `generate_mask_bitmap`, cached in
  `get_cached_or_generate_mask`) and combines raw buffers with rayon;
  the live overlay (`generate_mask_overlay`) now goes through the cache
  too. Radial and linear gradients draw rows in parallel with the
  rotation's sin/cos hoisted. Bit-identical (tests against the old
  loops). Measured at 2560 × 1707 with a 40-stroke brush and a
  subtracted radial: a full redraw took 440 ms, a drag step now 3 ms of
  mask work plus 25 ms for the overlay PNG (faster PNG compression
  tried: no gain, reverted). WP5's acceptance check with an AI
  component is covered by the key test (a component's key does not
  change when another component does); a counter would need `AppState`
  in tests and was not added.

Goal: make building masks from components (add, subtract, intersect, invert)
feel like Lightroom Classic. The data model already matches LrC's
mask → components structure, so this is mainly a UI and compositing change,
not a schema change.

Before starting, follow `AGENTS.md`: read `docs/HANDOFF.md`, respect the
Validation Gates, and update `HANDOFF.md`, `FEATURES.md` and
`RELEASE_NOTES.MD` as that file requires. Line numbers below are approximate
as of 2026-11-17; locate code by symbol name.

## 1. Current state

Backend, `src-tauri/src/mask_generation.rs`:

- `MaskDefinition { id, name, visible, invert, opacity, blend_mode, adjustments, sub_masks }`
- `SubMask { id, mask_type, visible, invert, opacity, mode, parameters }`
- `SubMaskMode { Additive, Subtractive, Intersect }`, serialized camelCase.
- `generate_mask_bitmap` starts `final_mask` at 0 (black). For each visible
  sub-mask it applies sub-mask invert, then opacity, then combines:
  Additive = `max`, Subtractive = `saturating_sub`, Intersect = `min`.
  Mask-level invert and opacity are applied afterwards.
- `mask_cache_key` hashes the whole `MaskDefinition` except `adjustments`.
  `get_cached_or_generate_mask` caches one bitmap per mask and clears the
  whole cache when it holds more than 50 entries.

Frontend:

- `src/components/panel/right/Masks.tsx`: `SubMaskMode` string enum
  (`'additive' | 'subtractive' | 'intersect'`), `SubMask`, `ToolType`.
- `src/components/panel/right/MasksPanel.tsx`: the panel, the
  `handleAddSubMask(containerId, type, mode = Additive, insertIndex = -1)`
  signature, `handleAddMaskContextMenu` (Add menu with Subtract and Intersect
  submenus), the container row, the "Add new component" row, and drag and
  drop (`handleDragEnd`).
- `src/components/panel/right/MaskEditorShared.tsx`: `SubMaskRow` and its
  hover controls, including the mode button that cycles
  Add → Subtract → Intersect → Add.
- `src/components/panel/Editor.tsx`: live overlay via
  `invoke(Invokes.GenerateMaskOverlay, { maskDef, ... })`.
- `src/components/panel/editor/ImageCanvas.tsx`: overlay display and
  `isMaskControlHovered`. Brush and Eraser are already in place, with Alt
  temporarily switching to the other tool.
- `src/store/useEditorStore.ts`: `activeMaskId`, `isMaskControlHovered`.
- Existing component actions: rename, duplicate, duplicate and invert, copy,
  paste, delete, show and hide, and drag to reorder.

## 2. Problems to fix

P1. Bug: in `handleDragEnd`, dropping a creation tile onto an existing
    component calls `handleAddSubMask(overData.parentId!, dragData.maskType!, targetIndex)`.
    This passes the index as `mode`. The new component gets a numeric `mode`
    that is not a valid `SubMaskMode`, and it is appended instead of inserted.
    **Not reachable (owner found, 2026-11-17):** the tool tiles show only
    while a photo has no masks (`MasksPanel.tsx`, layout from upstream
    `ad276373`, 2026-04-09, older than the wrong call); once a mask exists,
    tools are added through menus, which cannot be dragged. So no tile
    could ever be dropped onto a component and no saved edit has a numeric
    `mode`. The AI panel hides its tiles the same way.

P2. A mask can go blank without warning. Because compositing starts from
    black, a mask whose first visible component is Subtractive or Intersect
    renders empty. This happens after drag-reordering, deleting the first
    Additive component, or hiding it. The UI hides the mode button on row 1,
    but the stored mode is still applied.

P3. A component's mode can't be seen until you hover. The row's left icon is
    the mask type (or the row number on hover). The mode is only visible in a
    hover button on the right.

P4. Changing a mode means clicking through a cycle. Going from Add to
    Intersect needs two clicks and briefly renders a Subtract.

P5. Subtract and Intersect are hard to reach. They are submenus inside
    "Add new component", and that row only appears once the mask or one of its
    components is selected.

P6. Hovering only highlights the selected component. LrC highlights any
    component you hover over.

P7. Editing one component recomputes all of them. The cache key covers the
    whole mask, so a single slider change re-renders every component,
    including AI masks (base64 decode and transform). The cache is also
    cleared all at once when it grows past 50 entries.

## 3. Target behaviour (LrC reference)

- Mask rows show Add and Subtract buttons on hover. Each opens the same tool
  list. Alt/Option-clicking Add creates a Subtract.
- "Intersect mask with…" lives in the mask row's context menu.
- Each component shows its mode at all times. The first component is the
  base and shows no mode.
- The mode is set directly (Add, Subtract or Intersect), not cycled.
- Hovering any component highlights its own area on the canvas.
- Editing one component re-renders only that component.

## 4. Work packages

Do these in order. Each WP should be a separate, reviewable change.

### WP0: Fix drag-to-insert (P1)

Code fix done (`1.85.2`, item 43, `9563da6f`; details in `HANDOFF.md`).
It also reads a `mode` that is not a mode as Additive (Rust
`deserialize_sub_mask_mode`, `normalizeLoadedAdjustments`). That repair
turned out to be unneeded (P1) and stays as a harmless guard; remove it
in WP3 if wanted. The acceptance check below waits on WP3's draggable
tiles.

- In `handleDragEnd`, call
  `handleAddSubMask(parentId, maskType, SubMaskMode.Additive, targetIndex)`.
- Search for any other caller that passes positional arguments in the wrong
  order.
- Acceptance: dropping a tool tile onto component N inserts an Additive
  component at position N, and the mask renders.

### WP1: Base-component rule (P2)

Backend (`generate_mask_bitmap`):

- The first sub-mask that produces a bitmap (visible and generated) is the
  base. Copy it into `final_mask` after its invert and opacity, ignoring its
  `mode`. Later components combine as today.
- Keep invert → opacity → combine order and the mask-level invert/opacity
  unchanged.

Frontend:

- Row 1 shows no mode badge (tooltip: "Base").
- When a reorder, delete or paste makes a non-Additive component first,
  normalize its stored `mode` to Additive so the saved file matches what is
  shown.
- Note: an AI component that is not generated yet returns no bitmap, so the
  next component temporarily becomes the base. That is acceptable.

Behaviour change: existing edits whose first component is Subtractive or
Intersect currently render nothing and will now render that component as the
base. Record this in `RELEASE_NOTES.MD`.

Owner decision 2026-11-18: the base rule above (not starting from white
for a Subtractive first component), because it matches LrC and is
predictable.

### WP2: Visible mode and direct selection (P3, P4)

- Add a small `SubMaskModeBadge` in `MaskEditorShared.tsx`, overlaid on the
  component's type icon at all times: `+`, `−` (Minus) or ∩
  (SquaresIntersect). No badge on row 1.
- Clicking the badge opens a context menu (the existing `showContextMenu`)
  with Add / Subtract / Intersect, with the current mode checked. Add the same
  three items to `SubMaskRow`'s right-click menu.
- Remove the cycling mode button from the hover controls.
- Give Subtract rows a subtle tint using existing theme tokens; no new
  colours.
- Keep the row-number-on-hover behaviour only if it does not collide with the
  badge; otherwise drop it.

### WP3: LrC-style entry points (P5)

- On the container row hover controls (next to Eye and Trash in
  `MasksPanel.tsx`), add:
  - an **Add** button (Plus) that opens the tool list in Additive mode;
    Alt/Option-click opens it in Subtractive mode;
  - a **Subtract** button (Minus) that opens the tool list in Subtractive
    mode, disabled when the mask has no components.
- Reuse `buildMenu(types, mode)` from `handleAddMaskContextMenu`; don't
  duplicate the tool list.
- Add "Intersect mask with…" (submenu of tools, Intersect mode) to the
  container row's context menu.
- The "Add new component" row: show it whenever the container is expanded,
  not only when it is selected.
- **Draggable tool tiles once masks exist** (owner 2026-11-17, folded in
  here): today the tile grid disappears with the first mask, so dropping a
  tile on a mask or component (WP0, `NewMaskDropZone`) cannot happen. Keep
  the tiles reachable while masks exist, clickable (add to the selected
  mask, else a new one: the tooltips `addToCurrent`/`createNew` already
  say so) and draggable onto empty space (new mask), a mask row (append)
  or a component row (insert there). Fork deviation from upstream
  `ad276373`'s space-saving layout; record it in `UPSTREAM_FEATURE_GAP.md`.
  **Open points:** where the tiles sit and how much space they take (e.g.
  a compact one-row strip above the mask list, or a collapsible grid);
  whether the dragged tile's mode follows Alt/Option (Subtract) like the
  Add button; whether the AI panel gets the same (it hides its tiles the
  same way).
- i18n: add every new string to all 12 files in `src/i18n/locales/` (see
  `src/i18n/update_translations.py`). Remove `switchToSubtract`,
  `switchToIntersect` and `switchToAdd` once nothing uses them. Check with
  `node src/i18n/check-runtime.mjs` (not `npm run i18n:check`, which this
  environment does not run).

### WP4: Hover highlight for any component (P6)

- Add `hoveredSubMaskId: string | null` to `useEditorStore`.
- `SubMaskRow` sets it on mouse enter and clears it on leave. Reuse the
  existing hover timeout so quick passes don't trigger renders.
- In `Editor.tsx`, when `hoveredSubMaskId` is set and differs from
  `activeMaskId`, call `GenerateMaskOverlay` with a synthetic `maskDef`: the
  parent container with `invert: false`, `opacity: 100` and `subMasks` set to
  only the hovered component (forced `visible: true`, `mode: Additive`).
  Show it in place of the normal overlay; restore it on leave.
- Reuse the existing stripping helpers (`stripSentMaskData`,
  `stripSentSubMasks`) the same way the current overlay call does.
- Acceptance: hovering a Subtract component shows the area it removes, and
  moving the pointer away restores the normal overlay within one frame of the
  existing overlay pipeline.

### WP5: Per-component cache and faster combining (P7)

- Add a per-sub-mask bitmap cache keyed on the `SubMask` (destructured like
  `mask_cache_key`, so new fields can't be silently left out), width, height,
  scale and crop offset. Before adding the key, find out how colour and
  luminance masks are invalidated today when the warped image changes, and
  keep that behaviour.
- `generate_mask_bitmap` combines from cached component bitmaps. The
  per-mask cache can stay, keyed as now.
- Replace "clear when > 50" with an LRU bound (an existing dependency if one
  is available; otherwise a small bounded map). Size it by bytes or entry
  count and document the choice.
- Replace the `enumerate_pixels_mut` + `get_pixel` loops with
  slice-based loops over the raw buffers, using rayon
  (`par_iter_mut().zip(...)`); rayon is already imported.
- Acceptance: changing one radial component in a mask that also holds an AI
  subject component doesn't re-run that AI component's decode/transform
  (verify with a debug log or a counter in a test).

### WP6 (optional, after owner review)

- Subtract formula: `a · (1 − b)` instead of `saturating_sub(a, b)`. It
  blends overlapping feathered edges more softly. It changes how existing
  edits look, so compare before and after on reference images and get owner
  approval.
- Intersect groups as in LrC (a nested group combined with the mask). The
  current sequential `min` already gives `(A ∪ B) ∩ C`, so this is low
  priority.

## 5. Tests

Rust unit tests in the `tests` module of `mask_generation.rs`, using small
synthetic sizes and simple components (radial or "all"):

- A mask whose first visible component is Subtractive is not empty (WP1).
- Hiding the first component makes the next visible one the base (WP1).
- Subtracting a component from itself gives 0 everywhere.
- The order of Additive components doesn't change the result.
- Inverting a component twice gives the original.
- A component at opacity 0 leaves the result unchanged for Additive and
  Subtractive.
- The per-component cache key changes only for the edited component, and
  ignores `adjustments` (WP5).

There is no frontend test runner in `package.json`, so do manual checks with
`npm run tauri dev`:

1. Create a mask with Add Brush, then a Subtract Radial from the row's
   Subtract button; badges show `+`/none and `−`.
2. Alt-click Add creates a Subtract.
3. Change a component to Intersect from its badge menu in one click.
4. Drag the Subtract component to row 1: it becomes the base, has no badge,
   and the mask still renders.
5. Delete the base: the next component becomes the base and renders.
6. Drop a tool tile onto component 2: it is inserted at position 2 as Add.
7. Hover each component: its own area highlights; leaving restores the
   overlay.
8. Edit a radial in a mask with an AI subject: response stays fast.
9. Save, reload the image, and confirm every mode, invert and opacity is
   kept.
10. Open an older edit file with masks: it loads, and only first-component
    Subtract/Intersect masks change (as noted in the release notes).

## 6. Validation and docs

- Follow `AGENTS.md` Validation Gates, including the Rust Clippy gate
  `cargo clippy --all-targets --all-features -- -D warnings` from `src-tauri`
  and `cargo fmt -p ThisIsRAW -- --check`, plus `npm run format:check`,
  `npm run lint` and `node src/i18n/check-runtime.mjs` for the files touched. Don't add new
  ESLint or typecheck diagnostics on changed lines.
- If Clippy can't run in the sandbox (see `CLAUDE.md` notes on `rawler`),
  report it as a blocker and ask the owner to run it; don't claim the gate
  passed.
- Update `docs/HANDOFF.md`, `docs/FEATURES.md` and `RELEASE_NOTES.MD`
  (repository root) per `AGENTS.md`.

## 7. Out of scope

- Changes to the edit-file schema (no new fields are needed for WP0–WP5).
- New mask types, AI model changes, or mask adjustment panels.
- GPU compositing of masks (see `docs/GPU_COMPUTE_PLAN.md` if that becomes
  relevant).
