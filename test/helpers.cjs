'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createHost } = require('../vscode-bridge/bridge');
const { frame, readFrames } = require('../vscode-bridge/protocol');
const { Diagnostics } = require('../desktop/diagnostics.cjs');
const { BridgeServer } = require('../desktop/bridge-server.cjs');
function fakeVsCode() {
  let active = 0, maximum = 0;
  const calls = [];
  class CancellationTokenSource {
    listeners = new Set();
    token = { isCancellationRequested: false, onCancellationRequested: callback => { this.listeners.add(callback); return { dispose: () => this.listeners.delete(callback) }; } };
    cancel() { this.token.isCancellationRequested = true; for (const callback of this.listeners) callback(); } dispose() { this.listeners.clear(); }
  }
  class LanguageModelTextPart { constructor(value) { this.value = value; } }
  class LanguageModelToolCallPart { constructor(callId, name, input) { Object.assign(this, { callId, name, input }); } }
  class LanguageModelToolResultPart { constructor(callId, content) { Object.assign(this, { callId, content }); } }
  const models = ['model-a', 'model-b'].map(id => ({ id, name: id, async sendRequest(messages, _options, token) {
    calls.push({ model: id, messages: [...messages] });
    if (_options.tools) return { stream: (async function* () {
      await new Promise(resolve => setTimeout(resolve, 30));
      if (token.isCancellationRequested) throw new Error('Cancelled');
      const last = messages.at(-1).content;
      if (Array.isArray(last) && last[0] instanceof LanguageModelToolResultPart) yield new LanguageModelTextPart('Feature implemented in selected worktree.');
      else yield new LanguageModelToolCallPart('write-1', 'write_file', { path: 'feature.txt', content: last, expectedHash: null });
    })() };
    return { text: (async function* () {
      active++; maximum = Math.max(maximum, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (token.isCancellationRequested) throw new Error('Cancelled');
        yield messages.at(-1).content === 'Reply with exactly: Connection successful' ? 'Connection successful' : messages[0].content;
      } finally { active--; }
    })() };
  } }));
  return { CancellationTokenSource, LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart, lm: { selectChatModels: async () => models },
    LanguageModelChatMessage: { User: content => ({ role: 'user', content }), Assistant: content => ({ role: 'assistant', content }) },
    calls, maximum: () => maximum };
}
async function connectPeer(endpointFile, vscode, capabilityOverride) {
  const endpoint = JSON.parse(await fs.readFile(endpointFile, 'utf8'));
  const connectionInfo = () => Promise.resolve({ capturedAt: new Date().toISOString(), accessToken: 'excluded-test-secret',
    rows: [{ section: 'VS Code proxy / TLS configuration', key: 'http.proxy', value: 'http://user:password@proxy.example:8080/path?token=hidden-query', evidence: 'Configuration snapshot', source: 'http.proxy (global; source hint)' },
      { section: 'GitHub account / URLs', key: 'Actual model service request URL', value: 'Not exposed by VS Code', evidence: 'Unavailable', source: 'Language Model API' }] });
  let socket; const pendingTools = new Map();
  const host = createHost(vscode, { connectionInfo, invokeTool(request, token) {
    const toolId = require('node:crypto').randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error, result) => { pendingTools.delete(toolId); listener.dispose(); error ? reject(error) : resolve(result); };
      const listener = token.onCancellationRequested(() => finish(new Error('Request cancelled.')));
      pendingTools.set(toolId, finish); socket.write(frame({ event: 'tool', toolId, ...request }));
    });
  } }); const models = await host.discover();
  socket = net.createConnection(endpoint.pipePath);
  await once(socket, 'connect');
  const accepted = new Promise(resolve => {
    readFrames(socket, message => {
      if (message.event === 'accepted') { resolve(); return; }
      if (message.method === 'toolResult') { pendingTools.get(message.id)?.(message.error ? new Error(message.error) : null, message.result); return; }
      host.request(message).then(reply => { if (reply && !socket.destroyed) socket.write(frame(reply)); });
    }, () => socket.destroy());
  });
  socket.on('error', () => {}); socket.on('close', () => host.clear());
  socket.write(frame({ type: 'hello', protocol: 2, capability: capabilityOverride ?? endpoint.capability,
    instance: 'test-editor-instance', version: 'test-vscode', models, connectionInfo: await connectionInfo(), capabilities: { agentTools: true } }));
  return { socket, accepted, host };
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'promptdeck-test-'));
  const log = new Diagnostics(path.join(directory, 'logs'));
  const bridge = new BridgeServer({ directory, log }); await bridge.start();
  const vscode = fakeVsCode(); const peer = await connectPeer(bridge.endpointFile, vscode); await peer.accepted;
  t.after(async () => {
    peer.socket.destroy(); await bridge.close();
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('promptdeck-test-')) throw new Error('Unsafe test cleanup path.');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { directory, log, bridge, vscode, peer };
}
module.exports = { fixture, fakeVsCode, connectPeer };
