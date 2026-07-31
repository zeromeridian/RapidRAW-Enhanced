import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);

if (args[0] === 'build') {
  const prepareResult = spawnSync(process.execPath, [resolve(repositoryRoot, 'scripts', 'prepare-build-version.mjs')], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (prepareResult.status !== 0) process.exit(prepareResult.status ?? 1);
}

const tauriResult = spawnSync(
  process.execPath,
  [resolve(repositoryRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), ...args],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
  },
);

process.exit(tauriResult.status ?? 1);
