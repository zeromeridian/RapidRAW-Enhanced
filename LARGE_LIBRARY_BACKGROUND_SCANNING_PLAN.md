# Large-Library Background Scanning and Navigation Plan

## Implementation Status

Implemented and superseded in `1.2.10-fix-app-optimization`. The delivered
architecture uses transactional generation-guarded folder and album commits,
an embedded SQLite snapshot catalog, retained persistent thumbnail
references, bounded
sidecar/XMP workers for large direct and recursive folders, progressive root
tree refinement, scoped AI-indexing events, and foreground-thumbnail yielding.
The catalog is a disposable acceleration index; source files, `.tirdata`, and
XMP remain authoritative and every restored snapshot is revalidated in the
background. It uses bundled SQLite and therefore requires no database server.
The validation and stress scenarios below remain the permanent regression
checklist for future changes.

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

## Verified Branch State

At the time of this investigation, `fix/app-optimization` was clean and exactly
one commit ahead of the latest local and cached `develop` branch:

- `develop`: `e3416c59`
- `fix/app-optimization`: `c225baef`
- Divergence: zero commits behind, one commit ahead

The optimization commit contains the folder-load generation guard that was
added after merging the latest `develop` code.

## Reproduction

1. Add a root containing approximately 30,000 images distributed among many
   subfolders.
2. Open a new subfolder and allow its images to begin loading.
3. Return to a previously scanned folder; its images initially appear.
4. Open another new folder containing several thousand images.
5. Navigate to other new or previously scanned folders while work continues.
6. The Library begins displaying "No images found that match your filter."
7. After one or two minutes, images begin appearing again.

## Confirmed Primary Failure Mechanism

The current generation guard prevents an older folder request from clearing a
newer request after thumbnail cancellation. It does not prevent the current
folder request from destructively clearing usable state before its replacement
is ready.

For an ordinary folder selection, `handleSelectSubfolder()` currently:

1. Cancels queued thumbnail generation.
2. Clears the frontend thumbnail request tracking.
3. Clears the global thumbnail URL map and decoded-image cache.
4. Sets the destination as the current folder.
5. Replaces `imageList` with an empty array.
6. Awaits Rust image enumeration and metadata reconciliation.
7. Publishes the new list only after that request completes.

When a large background workload is consuming filesystem, CPU, metadata-worker,
or GPU capacity, even a previously visited folder's new listing can be delayed.
During the delay, the active folder has an empty image list. The empty-state UI
therefore displays the filter-related "No images found" message. Returning to a
previously scanned folder repeats the destructive loading sequence instead of
reusing its completed result.

## Additional Findings

### Thumbnail lifetime and priority

- The frontend thumbnail URL map is global and is erased during normal folder
  navigation, even though its disk-cached thumbnails remain valid.
- The backend uses one thumbnail queue. Visible thumbnails and older background
  requests do not have explicit foreground/background priorities.
- Clearing the queue cannot stop thumbnails already being generated.
- Completed thumbnail references are not retained as a bounded cross-folder
  navigation cache.

### Recursive image and metadata scanning

- Recursive enumeration runs off the UI event loop, but substantial filesystem
  work still competes with foreground folder navigation.
- Metadata uses one global queue and four fixed workers.
- `clear_pending_metadata()` clears queued work and shared deduplication state,
  but it cannot stop workers that already own an item.
- Metadata jobs and events have no scan generation or folder owner.
- Old metadata events may not corrupt the visible list because paths are
  matched, but they still consume backend resources and frontend batching.

### AI indexing

- AI indexing uses one global task handle.
- Indexing events do not contain a job ID or owning folder.
- `indexing-finished` refreshes whichever folder is active when the event
  arrives, even if another folder produced that event.
- That refresh starts another full listing and can collide with navigation or
  another scan.

### Folder-tree discovery

- Initial tree work can recursively inspect large directory structures when
  image counts, image-count sorting, or Hide Empty Folders is enabled.
- Tree discovery is off the UI event loop, but it has no foreground/background
  resource coordination with folder listing and thumbnail work.

### EXIF and empty-state behavior

- Background EXIF enrichment is batched and generation-checked.
- EXIF-dependent sorting still waits for all requested EXIF before publishing
  the destination folder.
- The Library empty state is derived primarily from the filtered display-list
  length. It does not distinguish a confirmed empty folder from a destination
  that is still loading.

## Proposed Architecture

### 1. Transactional folder navigation

Treat folder selection as an asynchronous transaction with a unique generation
and destination identity.

When a folder is selected:

- Record it as `pendingFolderPath` without changing the committed folder.
- Do not clear the current image list, thumbnail URLs, or decoded-image cache.
- Keep the committed folder visible and usable while the destination loads.
- Load the destination asynchronously.
- Commit `currentFolderPath`, images, ratings, selection, and scroll state
  together only after a usable destination result exists.
- Before every state mutation following an await, verify that the request still
  owns the current generation.
- If the request is stale, discard its result without touching UI state.
- If it fails, retain the committed folder and report the error.
- Ensure an obsolete request cannot alter loading indicators, errors,
  selections, images, ratings, thumbnails, or the editor.

This generalizes the existing retain-on-new-root behavior to every folder and
album transition.

### 2. Bounded per-folder listing cache

Add a small in-memory LRU cache keyed by:

- Normalized folder path.
- Direct-folder versus recursive Library mode.
- Settings that materially affect returned records, including XMP sync and any
  metadata behavior that changes list identity.

Each entry should contain:

- Image records.
- Ratings and already loaded metadata.
- A lightweight freshness marker.
- Last-access time.

Required behavior:

- Restore a previously scanned folder immediately from memory.
- Revalidate it in the background without clearing the restored result.
- Atomically reconcile added, removed, renamed, and modified files after
  revalidation completes.
- Let explicit Refresh force revalidation while preserving the old result.
- Bound the cache by entry count and total image-record count so it cannot grow
  indefinitely in very large libraries.
- Cache inexpensive image records, not decoded full-resolution images.
- Give albums equivalent transactional behavior, keyed by album ID and
  membership revision.

### 3. Preserve valid thumbnail state across navigation

- Do not clear the complete thumbnail URL map on a folder click.
- Do not erase completed frontend generation tracking on every navigation.
- Remove obsolete pending requests without deleting completed thumbnail
  references.
- Invalidate individual entries only for explicit thumbnail-cache clearing,
  deletion, rename, stale-cache detection, or regeneration.
- Add bounded pruning based on recent folder/image usage if memory measurement
  shows it is needed.
- Make returning to a cached folder reuse its existing thumbnail URLs
  immediately.

### 4. Foreground and background thumbnail queues

Replace the single undifferentiated queue with these priorities:

1. Images visible in the current viewport.
2. Remaining images in the committed active folder.
3. Cached-folder revalidation work.
4. Newly discovered images elsewhere in an added root.

Requirements:

- Workers always select visible foreground requests first.
- Reprioritization must not create duplicate work.
- Already-running background work may finish, but new foreground work must
  begin as soon as a worker becomes available.
- Reserve at least one worker for foreground work, or suspend background
  dispatch while a foreground backlog exists.
- Keep concurrency and queue length bounded.
- Preserve visible-first ordering and existing HDD-aware sequential access.
- Express priority in the application scheduler rather than through
  platform-specific OS APIs.

### 5. Metadata job ownership and priority

Extend queued metadata records and emitted events with:

- A scan/job generation.
- An owning folder or folder-cache key.
- A foreground/background priority.

Then:

- Reject stale events before adding them to frontend buffers.
- Apply valid metadata to both the active list and matching cached-folder
  entry.
- Do not clear shared pending bookkeeping while older workers are running.
- Deduplicate work without conflating separate owners or virtual copies.
- Let visible-folder metadata jump ahead of background root metadata.
- Preserve XMP import, ratings, tags, flags, physical stacks, edit indicators,
  and virtual-copy suffixes.

### 6. Progressive root and folder-tree discovery

Separate adding a root into two operations:

- A fast foreground operation that adds the root and immediate children so the
  user can navigate immediately.
- Lower-priority background discovery for deeper folders, recursive counts,
  emptiness, sidecars, and other optional information.

Folder-tree behavior should be progressive:

- Load deeper children when a node is expanded.
- Calculate recursive image counts in the background.
- If Hide Empty Folders requires recursive discovery, show folders
  provisionally and remove only folders later confirmed empty.
- Update image-count sorting when counts arrive without blocking navigation.
- Scope each tree update to the root and generation that produced it.

### 7. Correct AI-indexing ownership

Add a job ID and folder path to:

- `indexing-started`
- `indexing-progress`
- `indexing-finished`
- `indexing-error`

The frontend must:

- Display progress only for the latest applicable job.
- Never refresh an unrelated active folder when an old job finishes.
- Prefer applying emitted metadata updates incrementally.
- Refresh only when necessary and only if the completed job still owns the
  committed folder.
- Make any required refresh transactional and cache-aware.

AI tagging must remain lower priority than active-folder listing, Develop image
loading, and visible thumbnail generation.

### 8. Accurate loading and empty states

Represent at least these Library states explicitly:

- Ready with images.
- Loading a destination while retaining the previous folder.
- Loading a destination when no previous folder exists.
- Confirmed empty folder.
- Confirmed no filter/search match.
- Error while retaining the previous folder.

During a transition:

- Keep the previous grid interactive.
- Show a subtle, non-blocking destination-loading indicator.
- Do not show the filter-empty message until a completed listing has genuinely
  produced no filtered results.
- Show a proper loader when there is no previously committed view.
- Retain prior content and show an error if destination loading fails.

### 9. Preserve EXIF-dependent behavior

For ordinary name, modified-date, rating, and other non-EXIF sorting:

- Publish basic image records immediately.
- Enrich EXIF in bounded idle batches.
- Update visible records and cached entries together.

For EXIF-dependent sorting and advanced EXIF search:

- Use cached EXIF immediately where available.
- Represent unresolved metadata as pending rather than as a confirmed mismatch.
- Do not publish a false empty result while required EXIF is still loading.
- Batch reorder operations so thousands of metadata events do not continuously
  reshuffle the grid.

No EXIF sorting, search, grouping, rating, XMP, stack, flag, edit-status, or
virtual-copy behavior may be removed.

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

## Implementation Sequence

1. Extract a testable folder-navigation transaction/coordinator from
   `useAppNavigation`.
2. Add explicit committed and pending folder state.
3. Stop eager image/thumbnail clearing and atomically commit folder results.
4. Add the bounded folder-result cache and background revalidation.
5. Preserve thumbnail URLs across navigation and add targeted invalidation.
6. Add frontend and backend thumbnail priorities.
7. Add metadata job identity, event scoping, cancellation, and priority.
8. Scope AI-indexing events and remove unrelated automatic refreshes.
9. Make root-tree discovery progressive and lower priority.
10. Add explicit loading/empty/error UI states.
11. Preserve and stabilize EXIF-dependent filters and sorting during enrichment.
12. Instrument and stress-test the complete workflow before release.

The transactional navigation work should land first because it fixes the
visible data-loss symptom independently. Queue priorities and progressive
discovery then address the resource contention that makes destination loading
slow.

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
