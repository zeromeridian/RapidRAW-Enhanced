// Checks the pad panel's maths (src/utils/blendPad.ts) against the vectors blend_pad.rs is
// tested with, so the live values match what the renderer applies. Needs Node 22.18+ (it runs
// the TypeScript directly). Run: node scripts/check-blend-pad.mjs
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { BLEND_PAD_SHAPES, anchorPoint, positionOf, resolveBlendPad } = await import(
  resolve(repositoryRoot, 'src', 'utils', 'blendPad.ts')
);
const vectors = JSON.parse(readFileSync(resolve(repositoryRoot, 'src', 'utils', 'blendPad.vectors.json'), 'utf8'));

const failures = vectors.cases.flatMap((testCase) => {
  const offsets = resolveBlendPad(testCase.pad, vectors.parameters);
  return vectors.parameters
    .map(({ id }) => ({ id, actual: offsets[id], expected: testCase.offsets[id] ?? 0 }))
    .filter(({ actual, expected }) => !(Math.abs(actual - expected) < 1e-9))
    .map(({ id, actual, expected }) => `${testCase.name}: ${id} is ${actual}, expected ${expected}`);
});

// Dragging an anchor maps the pointer back to a perimeter position: it must invert anchorPoint.
for (const shape of BLEND_PAD_SHAPES) {
  for (let step = 0; step < 40; step += 1) {
    const t = step / 40;
    const back = positionOf(shape, anchorPoint(shape, t));
    const distance = Math.min(Math.abs(back - t), 1 - Math.abs(back - t));
    if (!(distance < 1e-9)) failures.push(`${shape}: position ${t} comes back as ${back}`);
  }
}

// Presets: saving and loading gives the same values; bad input is cleaned, never trusted.
{
  const { createBlendPadPreset, loadBlendPadPreset, sanitizeBlendPad, sanitizeBlendPadPresets, isBlendPadPresetDirty } =
    await import(resolve(repositoryRoot, 'src', 'utils', 'blendPad.ts'));
  const check = (condition, message) => condition || failures.push(`presets: ${message}`);
  const parameters = vectors.parameters;
  for (const testCase of vectors.cases.filter((candidate) => candidate.pad.enabled)) {
    const saved = createBlendPadPreset('Look', testCase.pad, true);
    const [restored] = sanitizeBlendPadPresets(JSON.parse(JSON.stringify([saved])), parameters);
    const expected = JSON.stringify(resolveBlendPad(testCase.pad, parameters));
    const anchorsUsable = testCase.pad.anchors.some((anchor) => parameters.some((p) => p.id === anchor.param));
    if (!anchorsUsable) continue;
    check(
      restored && JSON.stringify(resolveBlendPad(loadBlendPadPreset(restored), parameters)) === expected,
      `${testCase.name} does not round-trip`,
    );
    // The panel holds cleaned pads (the puck inside the shape, known tools only).
    const held = sanitizeBlendPad(testCase.pad, parameters);
    check(restored && !isBlendPadPresetDirty(restored, held), `${testCase.name} looks modified after loading`);
  }
  const pad = vectors.cases[0].pad;
  const tools = createBlendPadPreset('Tools', { ...pad, puck: { x: 0.4, y: 0.4 } }, false);
  check(tools.pad.puck.x === 0 && tools.pad.puck.y === 0, 'a preset without the puck keeps a puck position');
  check(
    !isBlendPadPresetDirty(tools, { ...pad, puck: { x: -0.3, y: 0.1 } }),
    'a preset without the puck counts a moved puck as a change',
  );
  const older = { ...pad, anchors: pad.anchors.map(({ reverse: _reverse, ...anchor }) => anchor) };
  check(
    !isBlendPadPresetDirty(createBlendPadPreset('Older', pad, true), older),
    'a pad without reverse fields (saved before it existed) looks modified',
  );
  const many = { ...pad, anchors: Array.from({ length: 12 }, (_, i) => ({ ...pad.anchors[0], id: `a${i}` })) };
  const [limited] = sanitizeBlendPadPresets([{ name: 'Many', pad: many }], parameters);
  check(limited?.pad.anchors.length === 8, 'the anchor limit is not enforced');
  const [cleaned] = sanitizeBlendPadPresets(
    [
      {
        name: ' Odd ',
        pad: {
          shape: 'spiral',
          amount: 7,
          puck: { x: 9, y: 'x' },
          anchors: [
            { param: 'fade', t: 0.2, target: 10 },
            { param: 'contrast', t: 1.25, target: 900, curve: 'wobbly' },
          ],
        },
      },
    ],
    parameters,
  );
  check(cleaned?.name === 'Odd', 'names are not trimmed');
  check(cleaned?.pad.shape === 'circle' && cleaned.pad.amount === 1, 'bad shape or amount kept');
  check(cleaned?.pad.anchors.length === 1, 'an unknown tool was kept');
  const [anchor] = cleaned?.pad.anchors ?? [];
  check(anchor?.target === 100 && anchor.t === 0.25 && anchor.curve === 'linear', 'anchor values not cleaned');
  check(
    sanitizeBlendPadPresets([{ name: 'X', pad: { version: 2, anchors: pad.anchors } }], parameters).length === 0,
    'a newer version was accepted',
  );
  check(sanitizeBlendPadPresets('nonsense', parameters).length === 0, 'non-list input gave presets');
  const renamed = sanitizeBlendPadPresets([{ name: 'look', pad }], parameters, [
    createBlendPadPreset('Look', pad, true),
  ]);
  check(renamed[0]?.name === 'look 2', 'a clashing import name was not made unique');
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `Blend pad vectors: ${vectors.cases.length} cases match; positions round-trip on ${BLEND_PAD_SHAPES.length} shapes; presets round-trip and clean bad input.`,
);
