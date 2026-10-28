'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
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
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'artifacts', packaged ? 'electron-packaged-smoke.png' : 'electron-smoke.png') });
    console.log('PASS: ' + (packaged ? 'packaged Windows executable' : 'actual Electron window') + ', three sessions, isolated drafts, renderer sandbox, literal model output, and connection-test UI using fake VS Code models.');
  } finally {
    peer?.socket.destroy(); if (app) await app.close();
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('promptdeck-smoke-')) throw new Error('Unsafe smoke cleanup path.');
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
