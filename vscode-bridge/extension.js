'use strict';
const vscode = require('vscode');
const net = require('node:net');
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHost } = require('./bridge');
const { frame, readFrames } = require('./protocol');
const { collectConnectionInfo } = require('./connection-info');

function activate(context) {
  const connectionInfo = () => collectConnectionInfo(vscode, context);
  const pendingTools = new Map();
  const host = createHost(vscode, { connectionInfo, invokeTool(request, token) {
    if (!socket || socket.destroyed || token.isCancellationRequested) return Promise.reject(new Error('Agent disconnected or cancelled.'));
    const toolId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => { pendingTools.delete(toolId); listener.dispose(); error ? reject(error) : resolve(result); };
      const listener = token.onCancellationRequested(() => finish(new Error('Request cancelled.')));
      pendingTools.set(toolId, { finish });
      try { socket.write(frame({ event: 'tool', toolId, ...request })); } catch (e) { finish(e); }
    });
  } });
  let instance = crypto.randomUUID();
  let socket;
  let connecting = false;
  const output = vscode.window.createOutputChannel('PromptDeck Bridge');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
  status.command = 'promptdeck.connect';
  status.text = 'PromptDeck: disconnected'; status.show();
  async function connect() {
    if (process.platform !== 'win32') throw new Error('This desktop prototype requires VS Code running locally on Windows.');
    if (socket && !socket.destroyed) { vscode.window.showInformationMessage('PromptDeck is already connected.'); return; }
    if (connecting) return;
    connecting = true;
    try {
      // Called only from the explicit user command or user-opened extension URI.
      // VS Code owns the provider account and its standard consent dialog.
      const accounts = (await Promise.all(['github', 'github-enterprise'].map(provider =>
        vscode.authentication.getAccounts(provider).catch(() => [])))).flat();
      if (!accounts.length) throw new Error('No existing GitHub account is signed in to this VS Code instance. Open the VS Code profile where Copilot already works. The bridge will not create a new GitHub login.');
      const models = await host.discover();
      if (!models.length) throw new Error('VS Code exposes no Copilot models. Check your existing Copilot sign-in and model permissions inside VS Code. No CLI or new GitHub login will be attempted.');
      const properties = await connectionInfo();
      const directory = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const endpoint = JSON.parse(await fs.readFile(path.join(directory, 'PromptDeck', 'bridge-endpoint.json'), 'utf8'));
      if (endpoint.protocol !== 2 || !/^\\\\\.\\pipe\\promptdeck-vscode-[a-f0-9-]+$/i.test(endpoint.pipePath)
          || !/^[a-f0-9]{64}$/.test(endpoint.capability)) throw new Error('Incompatible local desktop endpoint. Open the Electron version of PromptDeck first.');
      const connection = net.createConnection(endpoint.pipePath);
      socket = connection;
      let accepted = false;
      connection.on('connect', () => {
        connection.write(frame({ type: 'hello', protocol: 2, capability: endpoint.capability, instance, version: vscode.version, models, connectionInfo: properties, capabilities: { agentTools: true } }));
      });
      readFrames(connection, message => {
          if (!accepted) {
            if (message?.event !== 'accepted') { connection.destroy(); return; }
            accepted = true; status.text = 'PromptDeck: connected';
            output.appendLine(`Electron desktop connected. VS Code version ${vscode.version}; ${models.length} Copilot models. Credentials stay in VS Code.`);
            return;
          }
          if (message?.method === 'toolResult') {
            pendingTools.get(message.id)?.finish(message.error ? new Error(String(message.error)) : null, message.result); return;
          }
          host.request(message).then(reply => {
            if (reply && !connection.destroyed) connection.write(frame(reply));
          }).catch(() => connection.destroy(new Error('Invalid bridge request.')));
      }, () => connection.destroy(new Error('Invalid local bridge message.')));
      connection.on('error', error => {
        output.appendLine(`Local bridge connection failed (${error.code || 'ipc_error'}). Open PromptDeck, then run PromptDeck: Connect Desktop again.`);
        vscode.window.showErrorMessage('PromptDeck local connection failed. Open the desktop app first, then run PromptDeck: Connect Desktop. See PromptDeck Bridge output for the error code.');
      });
      connection.on('close', () => { host.clear(); for (const item of pendingTools.values()) item.finish(new Error('Desktop disconnected.')); instance = crypto.randomUUID(); status.text = 'PromptDeck: disconnected'; if (socket === connection) socket = undefined; });
    } catch (error) {
      // Do not serialize SDK objects, headers, or authentication details.
      vscode.window.showErrorMessage('PromptDeck: ' + String(error.message || 'Could not access VS Code Copilot models.'));
    } finally { connecting = false; }
  }
  context.subscriptions.push(output, status,
    vscode.commands.registerCommand('promptdeck.connect', connect),
    vscode.commands.registerCommand('promptdeck.disconnect', () => { host.clear(); socket?.destroy(); }),
    vscode.window.registerUriHandler({ handleUri(uri) { if (uri.path === '/connect') return connect(); } }),
    { dispose() { host.clear(); socket?.destroy(); } });
}
module.exports = { activate };
