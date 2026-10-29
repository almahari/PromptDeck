'use strict';
const { app, BrowserWindow, ipcMain, shell, session, protocol, net, dialog, nativeTheme } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { BridgeServer } = require('./bridge-server.cjs');
const { Diagnostics, redact } = require('./diagnostics.cjs');
const { Controller } = require('./controller.cjs');
const { Repositories } = require('./repositories.cjs');
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
    const repositories = new Repositories(directory);
    try { await repositories.load(); } catch (e) { log.failure('Load projects', e); }
    controller = new Controller(bridge, log, { appVersion: app.getVersion(), electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch }, repositories);
    const assets = new Map(['index.html', 'renderer.js', 'styles.css'].map(name => ['/' + name, path.join(__dirname, 'renderer', name)]));
    protocol.handle('promptdeck', request => {
      const url = new URL(request.url); const file = url.host === 'app' && assets.get(url.pathname);
      return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Not found', { status: 404 });
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    nativeTheme.themeSource = 'dark';
    window = new BrowserWindow({ width: 1180, height: 850, minWidth: 850, minHeight: 650,
      title: 'PromptDeck — VS Code Copilot', backgroundColor: '#1a212c', autoHideMenuBar: true,
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
          case 'restart': result = controller.restartConversation(args.id); break;
          case 'project.add': {
            const picked = await dialog.showOpenDialog(window, { title: 'Select Git repositories', properties: ['openDirectory', 'multiSelections'] });
            if (!picked.canceled) {
              const failures = [];
              for (const folder of picked.filePaths) try { result = await controller.addProject(folder); } catch (e) { failures.push(e.message); }
              if (failures.length) throw new Error(failures.join('\n'));
            }
            break;
          }
          case 'project.refresh': await controller.refreshProjects(); break;
          case 'worktree.create': result = await controller.createWorktree(args.projectId, args.name); break;
          case 'worktree.open': {
            const worktree = await repositories.worktree(args.worktreeId);
            await shell.openExternal('vscode://file' + pathToFileURL(worktree.root).pathname + '/'); break;
          }
          case 'approval': controller.approve(args.id, args.accepted); break;
          case 'access': controller.setAccess(args.id, args.mode); break;
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
    log.write(`Electron ${process.versions.electron} ready. Worktree agents require VS Code bridge 0.4.0. Log: ${log.logPath}`);
    app.on('activate', () => window?.show());
  }).catch(error => { console.error(redact(error.message)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!bridge || stopping) return;
    event.preventDefault(); stopping = true; controller?.shutdown();
    bridge.close().finally(() => app.quit());
  });
}
