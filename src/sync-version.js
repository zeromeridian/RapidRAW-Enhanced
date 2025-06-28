const fs = require('fs');
const path = require('path');

const tauriConfPath = path.resolve(__dirname, '../src-tauri/tauri.conf.json');
const packageJsonPath = path.resolve(__dirname, '../package.json');

try {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  const appVersion = tauriConf.version;

  if (packageJson.version !== appVersion) {
    console.log(`Syncing version: ${packageJson.version} -> ${appVersion}`);
    packageJson.version = appVersion;
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log('package.json version updated successfully.');
  }
} catch (error) {
  console.error('Error syncing versions:', error);
  process.exit(1);
}