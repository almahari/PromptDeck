'use strict';
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { redact } = require('./diagnostics.cjs');
class Controller extends EventEmitter {
  constructor(bridge, log, runtime = {}, repositories = null) {
    super(); this.bridge = bridge; this.log = log; this.sessions = []; this.testing = false;
    this.connection = 'Open the VS Code profile where Copilot already works, then connect the bridge.';
    this.active = new Map(); this.testAbort = null;
    this.runtime = runtime; this.lastTest = null; this.lastResponse = null;
    this.repositories = repositories; this.approvals = new Map(); this.starting = new Set();
    bridge.toolHandler = (request, signal) => this.tool(request, signal);
    for (let i = 0; i < 3; i++) this.newSession();
    bridge.on('connected', () => { this.reconcileModels(); this.connection = `VS Code ${bridge.version} connected — test model access`; this.changed(); });
    bridge.on('disconnected', () => { for (const abort of this.active.values()) abort.abort(); this.connection = 'VS Code disconnected — reconnect in the editor'; this.changed(); });
    log.on('line', () => this.changed());
    this.syncWorktrees();
  }
  state() {
    return { connected: this.bridge.connected, connection: this.connection, models: this.bridge.models,
      projects: this.repositories?.projects || [], agentAvailable: this.bridge.capabilities?.agentTools === true,
      approvals: [...this.approvals.values()].map(({ finish, ...a }) => a),
      sessions: this.sessions.map(({ remoteInstance, remoteModel, ...s }) => ({ ...s,
        needsRestart: Boolean(remoteInstance && this.bridge.connected && remoteInstance !== this.bridge.instance) })), testing: this.testing,
      diagnostics: this.log.lines, logPath: this.log.logPath,
      properties: { connected: this.bridge.connected, bridgeInstance: this.bridge.instance, connectedAt: this.bridge.connectedAt,
        pipePath: this.bridge.pipePath, protocol: 2, desktopPid: process.pid, runtime: this.runtime,
        editor: this.bridge.connectionInfo, lastTest: this.lastTest, lastResponse: this.lastResponse } };
  }
  changed() { this.emit('state', this.state()); }
  find(id) { const s = this.sessions.find(s => s.id === id); if (!s) throw new Error('Unknown conversation.'); return s; }
  restartConversation(id) {
    const s = this.find(id);
    if (s.busy || this.starting.has(id) || this.testing) throw new Error('Finish or cancel the active request before starting a new conversation.');
    const oldInstance = s.remoteInstance;
    s.previousConversations = [...(s.previousConversations || []), { id, model: s.model, at: new Date().toISOString(), messages: s.messages }].slice(-10);
    s.id = randomUUID(); s.remoteInstance = null; s.remoteModel = null;
    s.messages = []; s.activities = []; s.accessMode = 'review'; s.status = 'New conversation — previous context is not sent. Your draft is preserved.';
    this.log.write(`New conversation started: id=${s.id}; replaces=${id}; previous context is read-only.`);
    if (oldInstance && oldInstance === this.bridge.instance && this.bridge.connected)
      this.bridge.request('dispose', { sessionId: id }, { timeout: 5000 }).catch(error => this.log.failure('Retire previous conversation', error));
    this.changed(); return s.id;
  }
  newSession(context = {}) {
    if (this.sessions.length >= 100) throw new Error('Prototype limit: 100 sessions. Restart the app to clear conversations.');
    const s = { id: randomUUID(), title: 'Session ' + (this.sessions.length + 1), model: this.bridge.models[0]?.id || '', draft: '', messages: [], busy: false, status: 'Ready', remoteInstance: null, remoteModel: null, mode: 'chat', activities: [], accessMode: 'review', ...context };
    this.sessions.push(s); this.changed(); return s.id;
  }
  syncWorktrees() {
    for (const p of this.repositories?.projects || []) for (const w of p.worktrees) {
      let s = this.sessions.find(s => s.worktreeId === w.id);
      if (!s && this.sessions.length < 100) { this.newSession({ title: w.branch, mode: 'agent', worktreeId: w.id, projectId: p.id }); }
      else if (s) s.title = w.branch;
    }
    this.changed();
  }
  async addProject(folder) { const p = await this.repositories.add(folder); this.syncWorktrees(); return p.id; }
  async createWorktree(projectId, name) {
    if (this.sessions.length >= 100) throw new Error('Prototype limit: 100 conversations. No worktree was created.');
    const w = await this.repositories.create(projectId, name); this.syncWorktrees();
    const session = this.sessions.find(s => s.worktreeId === w.id);
    if (!session) throw new Error('Worktree created, but conversation limit reached. Restart PromptDeck to refresh.');
    return session.id;
  }
  async refreshProjects() {
    const errors = [];
    for (const p of this.repositories.projects) try { await this.repositories.refresh(p.id); } catch (e) { errors.push(e.message); }
    this.syncWorktrees(); if (errors.length) throw new Error(errors.join('\n'));
  }
  approve(id, accepted) { this.approvals.get(id)?.finish(accepted === true); }
  setAccess(id, mode) {
    const s = this.find(id);
    if (s.mode !== 'agent' || !['review', 'full'].includes(mode)) throw new Error('Choose an access mode for a worktree agent session.');
    s.accessMode = mode;
    this.log.write(`Session file access changed: id=${s.id}; mode=${mode}; worktree=${s.worktreeId}.`);
    if (mode === 'full') for (const approval of [...this.approvals.values()]) if (approval.sessionId === id) approval.finish(true);
    this.changed();
  }
  async tool(request, signal) {
    const s = this.find(request.sessionId);
    if (!s.busy || s.mode !== 'agent' || !this.active.has(s.id) || signal?.aborted) throw new Error('No active workspace agent request.');
    const w = await this.repositories.worktree(s.worktreeId);
    const activity = { name: request.name, path: typeof request.input?.path === 'string' ? request.input.path.slice(0, 500) : '', status: 'Running' };
    s.activities.push(activity); s.activities = s.activities.slice(-50); this.changed();
    try {
      const result = await require('./workspace-tools.cjs').executeTool(w.root, request.name, request.input, { signal,
        approve: (edit, signal) => s.accessMode === 'full' && !signal?.aborted ? Promise.resolve(true) : new Promise(resolve => {
          const id = randomUUID();
          const finish = accepted => { signal?.removeEventListener('abort', cancel); this.approvals.delete(id); this.changed(); resolve(accepted); };
          const cancel = () => finish(false);
          this.approvals.set(id, { id, sessionId: s.id, title: s.title, ...edit, finish });
          signal?.addEventListener('abort', cancel, { once: true });
          if (signal?.aborted) cancel(); else this.changed();
        }) });
      activity.status = result.applied === false ? 'Rejected' : 'Completed'; return result;
    } catch (e) { activity.status = 'Failed'; throw e; }
    finally { this.changed(); }
  }
  reconcileModels() {
    for (const s of this.sessions) {
      if (!s.model) s.model = this.bridge.models[0]?.id || '';
      else if (!this.bridge.models.some(m => m.id === s.model)) { s.model = ''; s.status = 'Previous model unavailable. Select a model explicitly.'; }
    }
  }
  setDraft(id, draft) {
    if (typeof draft !== 'string' || draft.length > 100000) throw new Error('Message limit: 100,000 characters.');
    const s = this.find(id); if (s.busy) return; s.draft = draft;
  }
  setModel(id, model) {
    const s = this.find(id); if (s.busy || this.testing) throw new Error('Wait for the active request to finish.');
    if (!this.bridge.models.some(m => m.id === model)) throw new Error('Requested model unavailable; no replacement was selected.');
    s.model = model; this.changed();
  }
  cancel(id) { this.active.get(id)?.abort(); }
  async refreshProperties() { await this.bridge.refreshConnectionInfo(); this.changed(); }
  async send(id) {
    const s = this.find(id);
    if (s.busy || this.starting.has(id) || this.testing) throw new Error('Wait for this session or the connection test to finish.');
    if (!this.bridge.connected) throw new Error('Connect the VS Code bridge first.');
    if (!this.bridge.models.some(m => m.id === s.model)) throw new Error('Select an available model.');
    let workspace;
    if (s.mode === 'agent') {
      if (!this.bridge.capabilities?.agentTools) throw new Error('Install PromptDeck bridge 0.4.0 and reconnect to enable worktree agents.');
      this.starting.add(id);
      try { workspace = (await this.repositories.worktree(s.worktreeId)).root; }
      finally { this.starting.delete(id); }
    }
    const prompt = s.draft;
    if (!prompt.trim()) throw new Error('Enter a message first.');
    if (s.remoteInstance && s.remoteInstance !== this.bridge.instance) throw new Error('VS Code bridge restarted. Click Start new conversation; previous context will remain read-only.');
    const abort = new AbortController(); this.active.set(id, abort);
    const options = { signal: abort.signal, timeout: s.mode === 'agent' ? 600000 : 120000 };
    s.busy = true; s.status = 'Waiting for Copilot…'; s.draft = ''; s.messages.push({ role: 'user', content: prompt }); this.changed();
    try {
      if (!s.remoteInstance) {
        await this.bridge.request('create', { sessionId: s.id, model: s.model, mode: s.mode, workspace }, options);
        s.remoteInstance = this.bridge.instance; s.remoteModel = s.model;
        this.log.write(`Conversation created: id=${s.id}; model=${s.model}.`);
      } else if (s.remoteModel !== s.model) {
        await this.bridge.request('model', { sessionId: s.id, model: s.model }, options); s.remoteModel = s.model;
      }
      this.log.write(`Request started: id=${s.id}; content omitted.`);
      const response = await this.bridge.request('send', { sessionId: s.id, prompt }, options);
      if (typeof response?.content !== 'string' || !response.content.trim()) throw new Error('VS Code returned no assistant text.');
      s.messages.push({ role: 'assistant', content: response.content }); s.status = 'Response received';
      this.lastResponse = { at: new Date().toISOString(), model: s.model, sessionId: s.id, bridgeInstance: this.bridge.instance };
      this.log.write(`Response completed: id=${s.id}; ${response.content.length} characters; content omitted.`);
    } catch (error) {
      this.log.failure('Request ' + s.id, error);
      s.status = ['cancelled', 'timeout'].includes(error.code) ? error.message : 'Request failed — see diagnostics';
      s.messages.push({ role: 'error', content: redact(`[${error.code || 'request_error'}] ${error.message}`) });
    } finally { abort.abort(); s.busy = false; this.active.delete(id); this.changed(); }
  }
  async test(selectedModel) {
    if (this.testing || this.starting.size || this.sessions.some(s => s.busy)) throw new Error('Finish or cancel active chats before testing the connection.');
    this.testing = true; this.testAbort = new AbortController(); this.changed();
    const options = { signal: this.testAbort.signal, timeout: 120000 };
    const stages = ['Local bridge', 'VS Code model access', 'Model discovery', 'Temporary conversation', 'Inference request', 'Exact response'];
    let step = 0, temporary = null;
    this.lastTest = { status: 'Running', startedAt: new Date().toISOString(), model: selectedModel || '', bridgeInstance: this.bridge.instance };
    this.log.write('Connection test BEGIN. Existing VS Code account only; no GitHub or CLI login.');
    try {
      if (!this.bridge.connected) throw Object.assign(new Error('Run PromptDeck: Connect Desktop in the signed-in VS Code profile.'), { code: 'not_connected' });
      this.log.write('1. Local bridge: PASS (authenticated local named-pipe connection).');
      step = 1; await this.bridge.refreshModels(options); this.reconcileModels();
      this.log.write('2. VS Code model access: catalog available; inference permission remains unverified.');
      step = 2; this.log.write(`3. Model discovery: PASS (${this.bridge.models.length} models).`);
      const model = selectedModel || this.bridge.models[0].id;
      this.lastTest.model = model;
      if (!this.bridge.models.some(m => m.id === model)) throw new Error('Selected model unavailable; select another explicitly.');
      step = 3; temporary = 'test-' + randomUUID();
      await this.bridge.request('create', { sessionId: temporary, model }, options);
      this.log.write(`4. Temporary conversation: PASS; model=${model}.`);
      step = 4; const response = await this.bridge.request('send', { sessionId: temporary, prompt: 'Reply with exactly: Connection successful' }, options);
      this.log.write('5. Inference request: PASS (existing VS Code model access verified for this request).');
      step = 5; this.log.write('6. Test response: ' + response?.content);
      if (response?.content?.trim() !== 'Connection successful') throw new Error('Response received but exact-response check failed.');
      this.log.write('6. Exact response: PASS. Connection successful.');
      this.lastTest = { ...this.lastTest, status: 'Passed', completedAt: new Date().toISOString() };
      this.connection = 'Connected through VS Code — inference verified'; return true;
    } catch (error) {
      this.lastTest = { ...this.lastTest, status: 'Failed', completedAt: new Date().toISOString(), stage: stages[step], error: redact(error.message) };
      this.log.failure(`${step + 1}. ${stages[step]}`, error);
      for (let i = step + 1; i < stages.length; i++) this.log.write(`${i + 1}. ${stages[i]}: SKIPPED.`);
      this.connection = this.bridge.connected ? 'VS Code connected — test failed; see diagnostics' : 'VS Code bridge not connected'; return false;
    } finally {
      if (temporary && this.bridge.connected) {
        try { await this.bridge.request('dispose', { sessionId: temporary }, { timeout: 5000 }); this.log.write('7. Temporary conversation cleanup: PASS.'); }
        catch (error) { this.log.failure('7. Temporary conversation cleanup', error); }
      } else this.log.write('7. Temporary conversation cleanup: SKIPPED.');
      this.testing = false; this.testAbort = null; this.changed();
    }
  }
  shutdown() { this.testAbort?.abort(); for (const abort of this.active.values()) abort.abort(); }
}
module.exports = { Controller };
