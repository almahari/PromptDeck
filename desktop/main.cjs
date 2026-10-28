'use strict';
const { app, BrowserWindow, ipcMain, shell, session, protocol, net } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { BridgeServer } = require('./bridge-server.cjs');
const { Diagnostics, redact } = require('./diagnostics.cjs');
const { Controller } = require('./controller.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'promptdeck', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, bridge, controller, stopping = false;
if (process.env.PROMPTDECK_DATA_DIR) app.setPath('userData', path.join(process.env.PROMPTDECK_DATA_DIR, 'electron-profile'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    const directory = process.env.PROMPTDECK_DATA_DIR || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PromptDeck');
    const log = new Diagnostics(path.join(directory, 'logs'));
    bridge = new BridgeServer({ directory, log }); await bridge.start();
    controller = new Controller(bridge, log, { appVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch });
    const assets = new Map(['index.html', 'renderer.js', 'styles.css'].map(name => ['/' + name, path.join(__dirname, 'renderer', name)]));
    protocol.handle('promptdeck', request => {
      const url = new URL(request.url); const file = url.host === 'app' && assets.get(url.pathname);
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = new BrowserWindow({ width: 1180, height: 850, minWidth: 850, minHeight: 650,
      title: 'PromptDeck — VS Code Copilot', backgroundColor: '#f5f6f8', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== 'promptdeck://app/index.html') event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    const trusted = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === 'promptdeck://app/index.html';
    ipcMain.handle('promptdeck:command', async (event, command, args = {}) => {
      if (!trusted(event)) throw new Error('Untrusted application frame.');
      try {
        if (!args || typeof args !== 'object' || typeof command !== 'string') throw new Error('Invalid command.');
        let result;
        switch (command) {
          case 'state': result = controller.state(); break;
          case 'new': result = controller.newSession(); break;
          case 'draft': controller.setDraft(args.id, args.text); break;
          case 'model': controller.setModel(args.id, args.model); break;
          case 'send': await controller.send(args.id); break;
          case 'cancel': controller.cancel(args.id); break;
          case 'test': result = await controller.test(args.model); break;
          case 'cancelTest': controller.testAbort?.abort(); break;
          case 'properties': await controller.refreshProperties(); break;
          case 'connect':
            log.write('Connection requested: use PromptDeck: Connect Desktop in the existing signed-in VS Code profile. No GitHub login is started.');
            await shell.openExternal('vscode://almahari.promptdeck-bridge/connect'); break;
          case 'logs': await shell.openPath(path.dirname(log.logPath)); break;
          default: throw new Error('Unknown application command.');
        }
        return { ok: true, result };
      } catch (error) { log.failure('Desktop action', error); return { ok: false, error: redact(error.message) }; }
    });
    controller.on('state', state => { if (!window.isDestroyed()) window.webContents.send('promptdeck:state', state); });
    await window.loadURL('promptdeck://app/index.html');
    log.write(`Electron ${process.versions.electron} ready. VS Code bridge 0.3.0 provides connection properties. Log: ${log.logPath}`);
    app.on('activate', () => window?.show());
  }).catch(error => { console.error(redact(error.message)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!bridge || stopping) return;
    event.preventDefault(); stopping = true; controller?.shutdown();
    bridge.close().finally(() => app.quit());
  });
}
