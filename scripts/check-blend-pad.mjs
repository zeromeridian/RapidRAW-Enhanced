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

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(
  `Blend pad vectors: ${vectors.cases.length} cases match; positions round-trip on ${BLEND_PAD_SHAPES.length} shapes.`,
);
