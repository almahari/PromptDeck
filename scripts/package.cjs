'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
(async () => {
  const { packager } = await import('@electron/packager');
  const root = path.resolve(__dirname, '..');
  const option = process.argv.find(arg => arg.startsWith('--out='));
  const out = path.resolve(root, option ? option.slice('--out='.length) : 'artifacts/electron');
  if (!out.startsWith(path.join(root, 'artifacts') + path.sep)) throw new Error('Package output must be inside this repository\'s artifacts directory.');
  const vsix = path.join(root, 'artifacts', `promptdeck-bridge-${require('../vscode-bridge/package.json').version}.vsix`);
  try { await fs.access(vsix); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Companion bridge VSIX is missing. Build it first with: npm run package:bridge');
    throw error;
  }
  const outputs = await packager({ dir: root, name: 'PromptDeck', platform: 'win32', arch: 'x64',
    out, overwrite: true, asar: true, prune: true,
    extraResource: [vsix],
    ignore: [/^\/artifacts(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/\.research(?:\/|$)/,
      /^\/test(?:\/|$)/, /^\/scripts(?:\/|$)/, /^\/PromptDeck(?:\/|$)/, /^\/vscode-bridge\/node_modules(?:\/|$)/,
      /^\/vscode-bridge\/test(?:\/|$)/, /^\/vscode-bridge\/package-lock.json$/] });
  console.log('Packaged Windows app: ' + outputs.join(', '));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
