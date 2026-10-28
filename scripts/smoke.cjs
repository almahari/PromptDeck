'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { git } = require('../desktop/repositories.cjs');
const { _electron: electron } = require('playwright');
const { connectPeer, fakeVsCode } = require('../test/helpers.cjs');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'promptdeck-smoke-'));
  const root = path.resolve(__dirname, '..');
  let app, peer;
  try {
    const packaged = process.argv.includes('--packaged');
    app = await electron.launch({
      ...(packaged ? { executablePath: process.env.PROMPTDECK_PACKAGE_PATH || path.join(root, 'artifacts', 'electron', 'PromptDeck-win32-x64', 'PromptDeck.exe'), args: [] } : { args: [root] }),
      env: { ...process.env, PROMPTDECK_DATA_DIR: directory }
    });
    const page = await app.firstWindow(); await page.waitForSelector('#sessions button');
    assert.equal(await page.locator('#sessions button').count(), 3);
    const endpointFile = path.join(directory, 'bridge-endpoint.json');
    peer = await connectPeer(endpointFile, fakeVsCode()); await peer.accepted;
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    assert.equal(await page.evaluate(() => typeof process), 'undefined');
    const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.contextIsolation, true); assert.equal(preferences.sandbox, true); assert.equal(preferences.nodeIntegration, false);
    await page.locator('#message').fill('session-one-draft');
    await page.locator('#sessions button').nth(1).click(); assert.equal(await page.locator('#message').inputValue(), '');
    await page.locator('#message').fill('session-two-draft');
    await page.locator('#sessions button').first().click(); assert.equal(await page.locator('#message').inputValue(), 'session-one-draft');
    await page.locator('#message').fill('<img src=x onerror="window.injected=true">');
    await page.locator('#send').click(); await page.waitForFunction(() => document.querySelectorAll('.message.assistant').length === 1);
    assert.equal(await page.locator('#conversation img').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.locator('#test').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent.includes('inference verified'));
    await page.locator('#properties').click();
    await page.locator('#properties-dialog[open]').waitFor();
    assert.ok((await page.locator('#properties-content').innerText()).includes('http://proxy.example:8080'));
    assert.ok((await page.locator('#properties-content').innerText()).includes('Not exposed by VS Code'));
    assert.ok((await page.locator('#properties-content').innerText()).includes('Passed'));
    assert.ok(!(await page.locator('#properties-content').innerText()).includes('user:password'));
    await page.locator('#refresh-properties').click();
    await page.waitForFunction(() => document.getElementById('properties-feedback').textContent.includes('refreshed'));
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts', packaged ? 'connection-properties-packaged.png' : 'connection-properties.png') });
    await page.locator('#close-properties').click();
    const repoRoots = [path.join(directory, 'First project'), path.join(directory, 'Second project')];
    for (const folder of repoRoots) {
      await fs.mkdir(folder); await git(folder, ['init', '-b', 'existing-feature']);
      await fs.writeFile(path.join(folder, 'README.md'), 'Test project'); await git(folder, ['add', '.']);
      await git(folder, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']);
    }
    // Exercise the actual native-picker command with deterministic selections.
    await app.evaluate(({ dialog }, roots) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: roots }); }, repoRoots);
    await page.locator('#add-project').click(); await page.waitForFunction(() => document.querySelectorAll('.project').length === 2);
    assert.equal(await page.locator('.worktree').count(), 2);
    assert.ok((await page.locator('.worktree').first().innerText()).includes('existing-feature · Current checkout'));
    await page.getByRole('button', { name: 'Create worktree in First project', exact: true }).click();
    await page.locator('#worktree-name').fill('feature/ui-test'); await page.locator('#create-worktree').click();
    await page.waitForFunction(() => !document.getElementById('worktree-dialog').open);
    assert.equal(await page.locator('.worktree').count(), 3);
    assert.equal(await page.locator('#session-title').innerText(), 'feature/ui-test');
    await app.evaluate(({ shell }) => { shell.openExternal = async url => { globalThis.lastOpenedUrl = url; }; });
    await page.locator('#open-vscode').click();
    await page.waitForTimeout(100);
    const opened = await app.evaluate(() => globalThis.lastOpenedUrl);
    assert.ok(opened.startsWith('vscode://file/')); assert.ok(decodeURI(opened).includes('.promptdeck/worktrees/feature-ui-test'));
    await page.locator('#message').fill('Implement the test feature'); await page.locator('#send').click();
    await page.locator('#edit-dialog[open]').waitFor();
    assert.equal(await page.locator('#edit-after').innerText(), 'Implement the test feature');
    await page.locator('#apply-edit').click();
    await page.waitForFunction(() => document.getElementById('session-status').textContent === 'Response received');
    const projects = JSON.parse(await fs.readFile(path.join(directory, 'projects.json'), 'utf8')); assert.equal(projects.length, 2);
    const first = (await git(repoRoots[0], ['worktree', 'list', '--porcelain', '-z'])).split('\0').filter(x => x.startsWith('worktree ')).map(x => x.slice(9));
    assert.equal(await fs.readFile(path.join(first[1], 'feature.txt'), 'utf8'), 'Implement the test feature');
    await assert.rejects(fs.access(path.join(repoRoots[0], 'feature.txt')));
    await page.screenshot({ path: path.join(root, 'artifacts', packaged ? 'electron-packaged-smoke.png' : 'electron-smoke.png') });
    console.log('PASS: ' + (packaged ? 'packaged Windows executable' : 'actual Electron window') + ', chat isolation, renderer sandbox, connection properties, multiple projects, real Git worktree creation, VS Code folder URI, and approved agent edit using fake VS Code models.');
  } finally {
    peer?.socket.destroy(); if (app) await app.close();
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('promptdeck-smoke-')) throw new Error('Unsafe smoke cleanup path.');
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
