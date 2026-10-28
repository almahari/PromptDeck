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
  class CancellationTokenSource { token = { isCancellationRequested: false }; cancel() { this.token.isCancellationRequested = true; } dispose() {} }
  const models = ['model-a', 'model-b'].map(id => ({ id, name: id, async sendRequest(messages, _options, token) {
    calls.push({ model: id, messages: [...messages] });
    return { text: (async function* () {
      active++; maximum = Math.max(maximum, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (token.isCancellationRequested) throw new Error('Cancelled');
        yield messages.at(-1).content === 'Reply with exactly: Connection successful' ? 'Connection successful' : messages[0].content;
      } finally { active--; }
    })() };
  } }));
  return { CancellationTokenSource, lm: { selectChatModels: async () => models },
    LanguageModelChatMessage: { User: content => ({ role: 'user', content }), Assistant: content => ({ role: 'assistant', content }) },
    calls, maximum: () => maximum };
}
async function connectPeer(endpointFile, vscode, capabilityOverride) {
  const endpoint = JSON.parse(await fs.readFile(endpointFile, 'utf8'));
  const host = createHost(vscode); const models = await host.discover();
  const socket = net.createConnection(endpoint.pipePath);
  await once(socket, 'connect');
  const accepted = new Promise(resolve => {
    readFrames(socket, message => {
      if (message.event === 'accepted') { resolve(); return; }
      host.request(message).then(reply => { if (reply && !socket.destroyed) socket.write(frame(reply)); });
    }, () => socket.destroy());
  });
  socket.on('error', () => {}); socket.on('close', () => host.clear());
  socket.write(frame({ type: 'hello', protocol: 2, capability: capabilityOverride ?? endpoint.capability,
    instance: 'test-editor-instance', version: 'test-vscode', models }));
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
