# This Is Raw

**Built on RapidRAW. Built by ColrBent.**

This Is Raw is an independent photo-editing application based on the RapidRAW
1.6 codebase. It preserves RapidRAW's fast, non-destructive, GPU-accelerated
foundation while adding integrated library, culling, organization, masking,
export, and workflow enhancements.

RapidRAW was created by Timon Käch (CyberTimon). This Is Raw is built and
maintained separately by ColrBent and is not an official RapidRAW release.

## Project Direction

This Is Raw extends RapidRAW without needlessly diverging from its proven
architecture. Development aims to:

- Preserve established editing behavior wherever practical.
- Follow the existing code organization, UI patterns, and engineering
  conventions.
- Reuse and extend shared components and abstractions.
- Keep changes focused, maintainable, and compatible with future upstream
  improvements where possible.
- Improve professional editing, culling, organization, and productivity
  workflows.

See [FEATURES.md](FEATURES.md) for the concise feature inventory maintained for
this version.

## Versioning

This Is Raw uses independent semantic versioning beginning at `1.0.0`.
Patch releases contain fixes and small refinements (`1.0.1`), minor releases
add backward-compatible features (`1.1.0`), and major releases contain breaking
or compatibility-changing updates (`2.0.0`).

## Inherited RapidRAW Foundation

Because This Is Raw is built on RapidRAW 1.6, it retains core capabilities such
as:

- Non-destructive RAW image editing.
- GPU-accelerated image processing.
- Library browsing, filtering, tagging, ratings, and color labels.
- Batch workflows, presets, masking, metadata, and export tools.
- The upstream architecture for Linux, macOS, Windows, and Android.

For upstream information, visit the
[RapidRAW repository](https://github.com/CyberTimon/RapidRAW).

## Building from Source

Install the platform prerequisites for Tauri, Node.js, npm, and Rust. Then run:

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

The inherited full TypeScript check currently contains known diagnostics.
Changes should still avoid introducing errors in modified files.

## Contributing

Contributions should integrate naturally with the existing codebase. Before
adding a new type, component, hook, utility, command, style, or state field,
check whether an existing abstraction can be reused or extended.

Issues affecting general RAW-format support may originate in
[rawler](https://github.com/dnglab/dnglab/tree/main/rawler), the RAW processing
library inherited from RapidRAW.

## License and Upstream Attribution

This Is Raw is distributed under the same **GNU Affero General Public License,
version 3 (AGPL-3.0)** as RapidRAW.

The original RapidRAW code remains subject to its existing copyright and
attribution notices. ColrBent's modifications are also distributed under
AGPL-3.0. This project does not remove or supersede the rights, notices, or
obligations attached to the upstream work. Refer to [LICENSE](LICENSE) for the
complete license terms.

RapidRAW and its original contributors are acknowledged for the project,
architecture, and functionality on which This Is Raw is built.
