# ColrBent

ColrBent is an independent fork of
[RapidRAW](https://github.com/CyberTimon/RapidRAW), based on the RapidRAW 1.6
codebase. It preserves RapidRAW's fast, non-destructive, GPU-accelerated photo
editing foundation while adding workflow and library-management enhancements
for the ColrBent project.

RapidRAW was created by Timon Käch (CyberTimon). ColrBent is maintained
separately and is not an official RapidRAW release.

## Project Direction

ColrBent extends RapidRAW without needlessly diverging from it. Development
follows these principles:

- Preserve the original editing behavior and architecture wherever practical.
- Follow upstream naming conventions, code organization, UI patterns, and
  engineering standards as closely as possible.
- Reuse and extend existing components and abstractions instead of creating
  duplicate implementations or parallel sources of truth.
- Keep changes focused, maintainable, and compatible with future upstream
  improvements when possible.
- Add enhancements that improve professional editing, culling, organization,
  and productivity workflows.

The goal is not to replace RapidRAW's core design. ColrBent builds on that
design while developing a distinct set of carefully integrated enhancements.

## ColrBent Enhancements

Enhancements currently added by this fork include:

- Bottom-toolbar access to the Productivity actions from the image context menu.
- One-click physical-copy and virtual-copy actions.
- A Lightroom Classic-style toolbar customization menu for showing or hiding
  individual controls.
- Persistent manual image stacks that are independent of RAW/JPEG grouping.
- Stack creation, expansion, collapse, cover selection, and removal.
- Clickable stack-count badges in grid and list views.
- Drag-and-drop ordering for expanded stack members.
- Subtle visual cues for stack covers and stack-member order.

ColrBent releases use the version format
`<rapidraw-version>-colrbent.<release>`, for example
`1.6.1-colrbent.6`.

## Inherited RapidRAW Foundation

Because ColrBent is based on RapidRAW 1.6, it retains RapidRAW's core
capabilities, including:

- Non-destructive RAW image editing.
- GPU-accelerated image processing.
- Library browsing, filtering, tagging, ratings, and color labels.
- Batch workflows, presets, masking, metadata, and export tools.
- Support for Linux, macOS, and Windows provided by the upstream architecture.

Platform support may differ between ColrBent releases. The current ColrBent
build target is Ubuntu Linux on amd64 (`x86_64`).

For information about the upstream project, visit the
[RapidRAW repository](https://github.com/CyberTimon/RapidRAW).

## Building from Source

Install the platform prerequisites for Tauri, along with:

- Node.js
- npm
- Rust

Then clone this repository and run:

```bash
npm install
npm start
```

To create a production build:

```bash
npm run tauri -- build
```

Useful validation commands:

```bash
npm run build
npm run typecheck
npm run lint
npm run i18n:runtime-check
```

RapidRAW's full TypeScript check currently contains known upstream errors.
Changes should still avoid introducing new errors in modified files.

## Contributing

Contributions should integrate naturally with the existing RapidRAW codebase.
Before adding a new type, component, hook, utility, command, style, or state
field, check whether an existing abstraction can be reused or extended.
Unnecessary duplication is not accepted.

Keep changes narrowly scoped, preserve existing behavior, and validate them in
proportion to their risk. Refer to `AGENTS.md` and `HANDOFF.md` for the current
project state and repository-specific development requirements.

Issues affecting general RAW-format support may originate in
[rawler](https://github.com/dnglab/dnglab/tree/main/rawler), the RAW processing
library used by RapidRAW.

## License and Upstream Attribution

ColrBent is distributed under the same license as RapidRAW:
the **GNU Affero General Public License, version 3 (AGPL-3.0)**.

The original RapidRAW code remains subject to its existing copyright and
attribution notices. ColrBent modifications are also distributed under
AGPL-3.0. The fork does not remove or supersede the rights, notices, or
obligations attached to the upstream work.

Under AGPL-3.0, modified versions and corresponding source code must be made
available as required by the license, including when the software is provided
for users to interact with over a network. Refer to [LICENSE](LICENSE) for the
complete and authoritative license terms.

RapidRAW and its original contributors are acknowledged for the project,
architecture, and functionality on which ColrBent is built.
