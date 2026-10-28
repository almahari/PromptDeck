'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawnSync } = require('node:child_process');

(async () => {
  const root = path.resolve(__dirname, '..');
  const extension = path.join(root, 'vscode-bridge');
  const manifest = JSON.parse(await fs.readFile(path.join(extension, 'package.json'), 'utf8'));
  let cli;
  try { cli = require.resolve('@vscode/vsce/vsce', { paths: [extension] }); }
  catch { throw new Error('VSIX packager is not installed. Run: npm --prefix vscode-bridge ci'); }
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const output = path.join(artifacts, `promptdeck-bridge-${manifest.version}.vsix`);
  const result = spawnSync(process.execPath, [cli, 'package', '--no-dependencies', '--skip-license', '--out', output],
    { cwd: extension, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
