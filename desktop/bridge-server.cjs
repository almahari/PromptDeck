'use strict';
const net = require('node:net');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { frame, readFrames } = require('../vscode-bridge/protocol');
const { safeReport, safeText } = require('../vscode-bridge/connection-info');

class BridgeServer extends EventEmitter {
  constructor({ directory, log, pipePath } = {}) {
    super(); this.log = log; this.directory = directory;
    this.desktopId = crypto.randomUUID(); this.capability = crypto.randomBytes(32).toString('hex');
    this.pipePath = pipePath || (process.platform === 'win32'
      ? '\\\\.\\pipe\\promptdeck-vscode-' + this.desktopId
      : path.join(os.tmpdir(), 'pd-' + this.desktopId + '.sock'));
    this.endpointFile = path.join(directory, 'bridge-endpoint.json');
    this.pending = new Map(); this.sockets = new Set(); this.peer = null;
    this.models = []; this.instance = null; this.version = null;
    this.connectionInfo = null; this.connectedAt = null;
  }
  get connected() { return Boolean(this.peer && !this.peer.destroyed); }
  async start() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.server = net.createServer(socket => this.accept(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject); this.server.listen(this.pipePath, resolve);
    });
    this.server.on('error', error => this.log?.failure('Local bridge listener', error));
    const temporary = this.endpointFile + '.' + this.desktopId;
    await fs.writeFile(temporary, JSON.stringify({ protocol: 2, desktopId: this.desktopId, pipePath: this.pipePath, capability: this.capability }), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, this.endpointFile);
    this.log?.write('Electron bridge ready. Local endpoint registered; no GitHub credentials requested.');
  }
  accept(socket) {
    this.sockets.add(socket);
    let authenticated = false;
    const timer = setTimeout(() => socket.destroy(), 5000); timer.unref();
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(timer); this.sockets.delete(socket);
      if (this.peer !== socket) return;
      this.peer = null;
      for (const item of this.pending.values()) item.reject(Object.assign(new Error('VS Code disconnected. Requests are not replayed; reconnect the bridge.'), { code: 'disconnected' }));
      this.pending.clear();
      this.log?.write('VS Code bridge disconnected.'); this.emit('disconnected');
    });
    readFrames(socket, message => {
      if (!authenticated) {
        const supplied = typeof message?.capability === 'string' ? Buffer.from(message.capability) : Buffer.alloc(0);
        const expected = Buffer.from(this.capability);
        if (this.peer || message?.type !== 'hello' || message.protocol !== 2 || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)
            || typeof message.instance !== 'string' || !Array.isArray(message.models)) { socket.destroy(); return; }
        const models = this.parseModels(message.models);
        authenticated = true; clearTimeout(timer); this.peer = socket;
        this.instance = message.instance; this.version = String(message.version || 'unknown'); this.models = models;
        this.connectionInfo = safeReport(message.connectionInfo); this.connectedAt = new Date().toISOString();
        socket.write(frame({ event: 'accepted' }));
        this.log?.write(`VS Code connected: version=${this.version}; models=${models.length}. Existing VS Code model access; credentials stay in the editor.`);
        this.emit('connected'); return;
      }
      if (typeof message?.id !== 'string') { socket.destroy(); return; }
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id);
      if (message.error) item.reject(Object.assign(new Error(String(message.error.message || 'VS Code model request failed.')), { code: String(message.error.code || 'model_error') }));
      else item.resolve(message.result);
    }, () => socket.destroy());
  }
  parseModels(models) {
    if (!Array.isArray(models) || models.length > 1000) throw new Error('Invalid VS Code model catalog.');
    return models.filter(m => m && typeof m.id === 'string' && m.id.length <= 512)
      .map(m => ({ id: safeText(m.id), name: safeText(m.name || m.id).slice(0, 512),
        vendor: safeText(m.vendor || ''), family: safeText(m.family || ''), version: safeText(m.version || ''),
        maxInputTokens: Number.isFinite(m.maxInputTokens) ? m.maxInputTokens : null }));
  }
  request(method, args = {}, { signal, timeout = 120000 } = {}) {
    if (!this.connected) return Promise.reject(Object.assign(new Error('VS Code bridge is not connected. Run PromptDeck: Connect Desktop in the signed-in VS Code profile.'), { code: 'not_connected' }));
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('Request cancelled.'), { code: 'cancelled' }));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let timer;
      const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); };
      const finish = (callback, result) => { clean(); callback(result); };
      const cancel = (code, message) => {
        if (!this.pending.has(id)) return;
        try { this.peer?.write(frame({ id, method: 'cancel' })); } catch {}
        finish(reject, Object.assign(new Error(message), { code }));
      };
      const abort = () => cancel('cancelled', 'Request cancelled.');
      this.pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => cancel('timeout', 'VS Code request timed out. Check any model-access consent dialog in VS Code.'), timeout);
      try { this.peer.write(frame({ id, method, args })); } catch (error) { finish(reject, error); }
    });
  }
  async refreshModels(options) {
    this.models = this.parseModels(await this.request('models', {}, options));
    if (!this.models.length) throw Object.assign(new Error('VS Code returned no Copilot models. Check its existing account, model consent, and organization policy.'), { code: 'no_models' });
    return this.models;
  }
  async refreshConnectionInfo() {
    const result = safeReport(await this.request('connectionInfo', {}, { timeout: 10000 }));
    if (!result) throw new Error('VS Code did not return connection metadata. Update bridge 0.3.0.');
    this.connectionInfo = result; return result;
  }
  async close() {
    for (const socket of this.sockets) socket.destroy();
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
    try {
      const endpoint = JSON.parse(await fs.readFile(this.endpointFile, 'utf8'));
      if (endpoint.desktopId === this.desktopId) await fs.unlink(this.endpointFile);
    } catch {}
  }
}
module.exports = { BridgeServer };
