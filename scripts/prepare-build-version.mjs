import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = resolve(repositoryRoot, 'src-tauri', 'tauri.conf.json');

const readArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const detectLocalBranch = () => {
  try {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const normalizeBranch = (branch) =>
  branch
    .trim()
    .replace(/^refs\/heads\//, '')
    .toLowerCase()
    .replace(/[^0-9a-z-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

const requestedBranch =
  readArgument('--branch') ||
  process.env.BUILD_BRANCH ||
  process.env.GITHUB_HEAD_REF ||
  (process.env.GITHUB_REF_TYPE === 'branch' ? process.env.GITHUB_REF_NAME : '') ||
  detectLocalBranch();

if (!requestedBranch) {
  throw new Error(
    'Could not determine the active build branch. Set BUILD_BRANCH or pass --branch so non-main builds receive the required version suffix.',
  );
}

const branch = normalizeBranch(requestedBranch);
if (!branch) {
  throw new Error(`Branch name "${requestedBranch}" cannot be converted into a valid semantic-version suffix.`);
}

const configText = readFileSync(configPath, 'utf8');
const config = JSON.parse(configText);
const baseVersion = String(config.version).match(/^(\d+\.\d+\.\d+)/)?.[1];
if (!baseVersion) {
  throw new Error(`Configured version "${config.version}" does not begin with MAJOR.MINOR.PATCH.`);
}

const isPlusBranch = branch === 'dev-tir-plus' || branch.startsWith('dev-tir-plus-');
const existingPlusRevision = Number(config.version.match(/-plus\.(\d+)$/)?.[1] ?? 0);
const buildVersion = isPlusBranch
  ? `${baseVersion}-plus.${existingPlusRevision + 1}`
  : branch === 'main'
    ? baseVersion
    : `${baseVersion}-${branch}`;
if (config.version !== buildVersion) {
  const versionPattern = /("version"\s*:\s*")[^"]+(")/;
  if (!versionPattern.test(configText)) {
    throw new Error('Could not locate the version field in src-tauri/tauri.conf.json.');
  }
  writeFileSync(configPath, configText.replace(versionPattern, `$1${buildVersion}$2`));
}

console.log(`Build version: ${buildVersion} (branch: ${requestedBranch})`);
