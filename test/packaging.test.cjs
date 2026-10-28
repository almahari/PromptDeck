'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('bridge packaging succeeds on a fresh checkout without an artifacts directory', async () => {
  const root = path.resolve(__dirname, '..');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'promptdeck-package-test-'));
  const extension = path.join(temporary, 'vscode-bridge');
  try {
    await fs.mkdir(extension);
    for (const name of ['package.json', '.vscodeignore', 'bridge.js', 'connection-info.js', 'extension.js', 'protocol.js', 'README.md'])
      await fs.copyFile(path.join(root, 'vscode-bridge', name), path.join(extension, name));
    await fs.symlink(path.join(root, 'vscode-bridge', 'node_modules'), path.join(extension, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    // Run exactly the extension's npm entry point, with its real VSIX packager.
    const wrapper = path.join(root, 'scripts', 'package-bridge.cjs');
    try {
      await fs.access(wrapper); await fs.mkdir(path.join(temporary, 'scripts'));
      await fs.copyFile(wrapper, path.join(temporary, 'scripts', 'package-bridge.cjs'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const npm = process.platform === 'win32' ? 'cmd.exe' : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run package'] : ['run', 'package'];
    const result = spawnSync(npm, args, { cwd: extension, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const manifest = JSON.parse(await fs.readFile(path.join(extension, 'package.json'), 'utf8'));
    const output = path.join(temporary, 'artifacts', `promptdeck-bridge-${manifest.version}.vsix`);
    assert.ok((await fs.stat(output)).size > 1000, 'Expected a packaged VSIX in the newly created output directory');
  } finally {
    if (path.dirname(path.resolve(temporary)) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith('promptdeck-package-test-')) throw new Error('Unsafe packaging test cleanup path.');
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
