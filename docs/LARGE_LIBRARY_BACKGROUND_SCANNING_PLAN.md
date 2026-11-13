# Large-Library Background Scanning and Navigation (done; regression checklist)

## Status (revised 2026-11-10)

**Done; no open work in this plan.** Implemented in `1.2.10-fix-app-optimization`:
transactional, generation-guarded folder and album commits; an embedded
SQLite snapshot catalog (bundled SQLite, a disposable acceleration index;
source files, `.tirdata` and XMP stay authoritative and every restored
snapshot is revalidated in the background); retained thumbnail references;
bounded sidecar/XMP workers for large direct and recursive folders;
progressive root-tree refinement; scoped AI-indexing events; foreground
thumbnails before background work.

- **Open follow-ups** on folder opening (catalog snapshot metadata, embedded
  XMP re-search, repeated `.tirdata` parsing and file-status calls) are
  tracked in `CODE_AUDIT_FINDINGS.md` item 8, not here.
- **Use this file as the regression checklist** for any change to
  navigation, scanning, thumbnails or the catalog: "Objective", "Edge Cases
  That Must Be Covered", "Validation Plan" and "Completion Criteria" below.
- The original investigation and proposed architecture were moved verbatim
  to `HANDOFF-ARCHIVE.md` ("Superseded LARGE_LIBRARY_BACKGROUND_SCANNING_PLAN.md
  investigation", 2026-11-10).

## Objective

Adding a root containing any number of subfolders and images must not hijack
the application. Root discovery, image enumeration, sidecar/XMP reads, EXIF
loading, thumbnail generation, and optional AI indexing must run as bounded,
lower-priority background work.

At all times:

- The application must remain responsive.
- Previously scanned folders must display their images and thumbnails without
  waiting for unrelated background work.
- Foreground navigation and visible thumbnails must take priority.
- Stale asynchronous results must never clear or replace the active view.
- Existing Library, Develop, metadata, XMP, virtual-copy, grouping, stack,
  filtering, sorting, and editing features must not be removed or degraded.
- The implementation must remain compatible with Ubuntu Linux, macOS ARM64,
  and Windows x64.

## Edge Cases That Must Be Covered

### Navigation and request races

- Rapid A to B to C navigation while A and B are still loading.
- Returning to A before B finishes.
- Repeatedly selecting the same folder.
- Switching between folder and album navigation.
- An explicit Refresh during background scanning.
- Removing a root while its work is queued or active.
- Renaming or deleting a folder while it is loading.
- Application shutdown while workers are active.

### Modes, filters, and sorting

- Direct-folder and recursive Library modes.
- Changing Library mode while a scan is active.
- Empty folders versus folders whose images are all filtered out.
- Filters based on metadata that is not loaded yet.
- EXIF-based sorting and advanced EXIF queries.
- Grouped images and collapsed physical stacks.
- Active rating, edit-state, RAW/file-type, color, and flag filters.

### Files and metadata

- Physical images and multiple virtual copies.
- XMP synchronization enabled and disabled.
- Existing `.tirdata`, missing `.tirdata`, and cloud-placeholder sidecars.
- Physical and virtual-copy sidecars with distinct metadata.
- Images added, removed, renamed, or modified after caching.
- Corrupt, locked, unreadable, or transient files.
- Network and cloud-backed folders with slow filesystem calls.
- AI tagging enabled, disabled, cancelled, and restarted.

### Thumbnail and resource behavior

- Explicit thumbnail-cache clearing while a folder is visible.
- Stale cached thumbnails after a source edit or rename.
- Foreground requests arriving while every worker is busy.
- HDD sequential access versus SSD behavior.
- Memory bounds after visiting many large folders.
- A root containing more than 30,000 image records.

### Cross-platform paths

- Windows drive roots, UNC-compatible path handling, separators, and
  case-insensitive identity.
- macOS path normalization and cloud-placeholder behavior.
- Linux case-sensitive path identity and mount behavior.

## Validation Plan

The repository currently has no focused automated coverage for these async
navigation and queue interactions. Add unit tests around the extracted
navigation/cache coordinator and Rust queue schedulers, plus integration and
manual stress coverage.

### Required acceptance scenario

1. Open a previously scanned folder and confirm images and thumbnails.
2. Add a root containing approximately 30,000 images across many subfolders.
3. While discovery runs, open a new folder containing thousands of images.
4. Immediately switch among multiple previously scanned folders.
5. Confirm cached images and thumbnails appear immediately on every return.
6. Scroll, filter, sort, open Develop, and edit while background work continues.
7. Confirm visible thumbnails preempt background work.
8. Confirm no stale job can clear or replace the committed folder.
9. Confirm no false empty-filter message appears.
10. Confirm sidecars, XMP, EXIF, AI tags, virtual copies, stacks, flags, ratings,
    and edit indicators eventually converge correctly.

### Automated coverage

- Out-of-order folder request completion.
- Stale success, error, and finalizer rejection.
- Cache hit followed by successful and failed revalidation.
- Cache eviction under image-record and folder-count limits.
- Foreground queue preemption and deduplication.
- Metadata events scoped by folder and generation.
- Indexing completion for a non-active folder.
- Explicit refresh without an empty intermediate state.
- Empty folder versus pending metadata/filter resolution.
- Windows, macOS, and Linux path-key normalization fixtures.

### Performance instrumentation

Development builds should record:

- Folder request generation and ownership.
- Cache hits, misses, revalidations, and evictions.
- Listing and time-to-first-visible-image duration.
- Foreground and background queue depths.
- Thumbnail time-to-first-visible-result.
- Metadata batch size and stale-result rejection counts.
- CPU, memory, disk throughput, and interaction latency.

Instrumentation must avoid per-image production logging that would itself hurt
performance.

### Platform validation

- Ubuntu Linux x64: native build, automated checks, and 30k-image stress test.
- macOS ARM64: native build and equivalent large-folder navigation test.
- Windows x64: native build, path-identity tests, and equivalent stress test.

If macOS ARM64 or Windows x64 cannot be built in the local environment, inspect
all shared and guarded code paths, record the limitation in `HANDOFF.md`, and
require native CI or machine validation before release.

## Completion Criteria

The work is complete only when background discovery may remain slow without
owning or destructively clearing the committed Library view. Foreground
navigation must always receive priority, previously completed work must remain
reusable, stale jobs must have no visible authority, and every existing feature
must continue to behave correctly on Ubuntu Linux, macOS ARM64, and Windows
x64.
