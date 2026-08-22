# ThisIsRAW Plus — Phase 1 Design Map

## Scope and Status

This is a repository-specific design for Phase 1 only: document foundation,
normalization, persistence, history, commands, feature gating, and tests. It
does not introduce a Layer UI, composite rendering, library action, thumbnail,
or export behavior change.

Audit completed on `dev/tir_plus`. The initial pure document module
and default-off developer-only gate are implemented; no UI, persistence,
rendering, thumbnail, or export behavior has changed.

## Confirmed Current Architecture

| Concern | Current owner | Consequence for Plus |
| --- | --- | --- |
| Active edit state | `src/store/useEditorStore.ts` holds `adjustments: Adjustments` | Replace the adjustment-only editor document/history model once, rather than adding a second Layer store. |
| Adjustment writes and history | `src/hooks/useEditorActions.ts` | Route every edit through document commands; retain existing adjustment controls by targeting the document's active adjustment target. |
| Editor load and cache refresh | `src/hooks/useImageLoader.ts`, `src/hooks/useAppNavigation.ts` | Normalize metadata into one `EditorDocument` before setting state or resetting history. |
| Autosave and current preview | `src/hooks/useImageProcessing.ts` | Phase 1 must keep passing the derived single-photo adjustments to the existing renderer, so output is unchanged. |
| Sidecar transport | `src-tauri/src/image_processing.rs` (`ImageMetadata`) and `src-tauri/src/file_management.rs` | Add an optional Plus document payload without changing the legacy `adjustments` payload for ordinary images. |
| Virtual copies | `parse_virtual_path` and `create_virtual_copy` in `src-tauri/src/file_management.rs` | This is the correct persistent identity for a future layered composition: each `?vc=` has its own `.tirdata` sidecar and does not overwrite the physical image's sidecar. |
| Preview, thumbnail, export | `src-tauri/src/lib.rs`, `src-tauri/src/file_management.rs`, `src-tauri/src/export_processing.rs` | All presently consume adjustment JSON directly. They remain untouched in Phase 1; Phase 2 must introduce one shared document render entry point before layered output is enabled. |
| Blend vocabulary | `MaskBlendMode` in `src/utils/adjustments.ts` | Extract or generalize this one existing vocabulary into a shared `LayerBlendMode`; do not create a second diverging blend enum. |
| Settings | `AppSettings` in `src/components/ui/AppProperties.tsx` and `src-tauri/src/app_settings.rs` | There is no existing general feature-flag registry. Add one typed Plus registry, default-disabled and serialized by the existing settings transport. |

## Required Document Boundary

Create one frontend module, `src/utils/editorDocument.ts`, owning:

- `EditorDocument = SinglePhotoDocument | LayeredDocument`;
- document and layer schema versions;
- pure conversion of legacy `Adjustments` into `SinglePhotoDocument`;
- strict normalization and validation of persisted documents;
- pure document commands, including `updateActiveAdjustments` and future layer
  commands;
- a derived `getActiveAdjustments(document)` selector for existing rendering
  and adjustment panels.

`adjustments` must not remain a second mutable source of truth. The editor
store's canonical fields become `document`, `history: EditorDocument[]`, and
`historyIndex`. Existing controls obtain the active adjustments through the
document selector and write through document commands. This is a deliberately
central migration: retaining both `document` and independently writable
`adjustments` would cause divergent history, autosave, and export state.

For Phase 1, a `SinglePhotoDocument` serializes to the current sidecar shape:
the existing `metadata.adjustments` value remains the source of compatibility.
Layered documents are not creatable yet. The optional Plus document field is
therefore read/validated infrastructure only until the first explicit virtual
composition command is enabled in a later phase.

## Persistence Contract

1. Existing `.tirdata` files with only `adjustments` normalize to a single
   document without migration or rewrite.
2. A future `layered` document is saved only to a virtual-copy sidecar. Its
   `anchorPath` must resolve to the physical source path, never a `?vc=` URL.
3. The frontend never serializes a normalized object by itself; it sends a
   typed document payload to one backend persistence command.
4. The backend validates document version and shape before replacing metadata,
   writes through an atomic temporary-file-and-rename helper, and regenerates
   only the affected virtual-copy thumbnail.
5. Unknown document fields are preserved losslessly when a valid layered
   document is read and subsequently saved. Malformed or unsupported documents
   are returned as recoverable load errors and do not cause a sidecar rewrite.
6. XMP synchronization remains legacy-adjustment-only in Phase 1. Because
   layered compositions are virtual copies, the existing virtual-copy XMP guard
   already prevents a layered document from being flattened into an XMP edit.

### Audit Finding: Unknown-Field Risk

`ImageMetadata` is deserialized as a Rust struct and then reserialized by
several existing write paths. Unknown top-level fields are not retained by that
struct. Phase 1 must therefore preserve the raw Plus document value (including
unknown nested fields) independently of typed normalization, and must not send
a layered sidecar through legacy merge/reset/paste commands. This is mandatory
for forward compatibility and protects a future document from silent loss.

### Audit Finding: Atomicity Gap

Current sidecar writers use direct `fs::write`. A Plus document write must use
an atomic write helper before any layered document can be persisted. The first
commit may limit that helper to the new Plus write path; it must not claim that
untouched legacy commands are atomic.

## Exact Phase 1 Change Set

| File | Phase 1 responsibility |
| --- | --- |
| `src/utils/editorDocument.ts` (new) | Canonical document types, normalization, selectors, immutable commands, validation result types, and pure tests. |
| `src/utils/adjustments.ts` | Export/reuse the existing blend-mode vocabulary; retain legacy adjustment normalization as an implementation detail used by document normalization. |
| `src/store/useEditorStore.ts` | Replace adjustment-array history with document-array history and expose command-based document updates. |
| `src/hooks/useEditorActions.ts` | Make adjustment changes update the active document target; save a document payload rather than an independently held adjustments object. |
| `src/hooks/useImageLoader.ts` | Load metadata once, normalize it to a document, and reset unified document history. |
| `src/hooks/useAppNavigation.ts` | Apply the same document normalization for cached-navigation metadata refreshes. |
| `src/hooks/useImageProcessing.ts` | Derive legacy adjustments from a single document only; retain the current preview invocation and prevent layered documents from reaching it before Phase 2. |
| `src/components/ui/AppProperties.tsx` | Add typed persisted Plus feature settings and any new command names. |
| `src-tauri/src/app_settings.rs` | Add the matching default-disabled Plus flag structure. |
| `src-tauri/src/image_processing.rs` | Extend metadata transport with an optional raw Plus-document field that does not alter legacy sidecars. |
| `src-tauri/src/file_management.rs` | Add validated Plus-document load/save commands, atomic write helper, virtual-composition identity validation, and a hard guard around legacy bulk adjustment commands. |
| `src-tauri/src/lib.rs` | Register only the new document commands; do not change the existing renderer in Phase 1. |

No Layer panel, translation key, keyboard shortcut, library context action,
renderer shader, thumbnail code, export code, XMP schema, or AI/mask behavior
belongs in the first commit.

## Feature-Gating Design

`layerMode` is developer-only. It is enabled only through a local, untracked
developer configuration on the maintainer's ThisIsRAW Plus development
environment; it must not appear in standard-build Settings or other user UI.
The typed `plusFeatures` registry defaults to `layerMode: false` in every
build. The gate must be checked at command dispatch as well as UI entry points.
A disabled gate means:

- no Layer UI, shortcut, Library action, or virtual-composition creation;
- existing single-photo state and renderer behavior are unchanged;
- persisted layered documents can be identified safely but are never rewritten
  by a legacy edit action.

The developer override must not be committed, synchronized through ordinary app
settings, or inferred from an operating-system user name. The Phase 1 design
will choose the repository's established local configuration mechanism after
inspecting its development/build tooling; if none exists, it will use a
documented ignored local file rather than an end-user setting.

## Test Matrix Before Phase 1 Is Complete

- Legacy metadata normalizes to `SinglePhotoDocument` without a rewritten
  sidecar.
- Valid layered document normalization accepts required fields and preserves
  unknown fields.
- Invalid version, invalid layer payload, duplicate IDs, invalid opacity, and
  missing anchor fail recoverably without a write.
- Pure commands are immutable and history undo/redo restores full documents,
  including future layer state.
- Feature gate defaults to disabled after absent/old settings load.
- Legacy single-photo preview and autosave receive exactly the normalized
  `Adjustments` payload they receive today.
- A disabled Plus feature cannot create, flatten, reset, paste over, or XMP-sync
  a layered virtual-composition document.
- Rust persistence tests cover atomic failure behavior and virtual-copy path
  isolation; frontend tests follow the repository's established runner once a
  test harness is selected (the package currently exposes no test script).

Run frontend typecheck, lint, format check, i18n checks, and build after
frontend changes. For Rust changes run `cargo fmt --check` and, from
`src-tauri`, `cargo clippy --all-targets --all-features -- -D warnings`; record
macOS ARM64 local results and Windows/Linux follow-up validation honestly.

## Implementation Sequence

1. **Completed:** add pure document types, normalizer, commands, a default-off
   developer-only Vite gate, and five focused Vitest cases with no store or
   renderer change.
2. Add backend document validation and atomic persistence tests.
3. Migrate the editor store, loader, history, autosave, and cached navigation
   together to the canonical document state while preserving the legacy render
   payload.
4. Validate no change to a legacy single-photo edit; only then begin Phase 2
   shared GPU compositing.

## Explicit Non-Goals Until Phase 2+

- Rendering more than one image;
- writing a new visual output format;
- rendering a layered thumbnail or export;
- applying Crop, Geometry, masks, or AI removal to a composite;
- copy/paste or presets for layered documents;
- UI for creating or opening a layer composition.
