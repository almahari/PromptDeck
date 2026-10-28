'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { once } = require('node:events');
const { Controller } = require('../desktop/controller.cjs');
const { redact } = require('../desktop/diagnostics.cjs');
const { fixture, connectPeer, fakeVsCode } = require('./helpers.cjs');

test('real Node named-pipe protocol supports three simultaneous isolated conversations', async t => {
  const f = await fixture(t); const app = new Controller(f.bridge, f.log);
  assert.equal(new Set(app.sessions.map(s => s.id)).size, 3);
  app.sessions.forEach((s, i) => app.setDraft(s.id, 'marker-' + i));
  await Promise.all(app.sessions.map(s => app.send(s.id)));
  assert.equal(f.vscode.maximum(), 3);
  assert.deepEqual(app.sessions.map(s => s.messages.at(-1).content), ['marker-0', 'marker-1', 'marker-2']);
  app.sessions.forEach(s => app.setDraft(s.id, 'recall'));
  await Promise.all(app.sessions.map(s => app.send(s.id)));
  assert.deepEqual(app.sessions.map(s => s.messages.at(-1).content), ['marker-0', 'marker-1', 'marker-2']);
  assert.equal(f.vscode.calls[3].messages.length, 3);
  assert.equal(await app.test('model-a'), true);
  assert.match(app.connection, /inference verified/);
  const log = await fs.readFile(f.log.logPath, 'utf8');
  assert.doesNotMatch(log, /marker-[012]|"capability"/);
});
test('cancellation and timeout affect only the requested session', async t => {
  const f = await fixture(t); const app = new Controller(f.bridge, f.log);
  const [one, two] = app.sessions;
  app.setDraft(one.id, 'cancelled-content'); app.setDraft(two.id, 'other-content');
  const first = app.send(one.id); const second = app.send(two.id);
  await new Promise(resolve => setTimeout(resolve, 10)); app.cancel(one.id);
  await Promise.all([first, second]);
  assert.equal(one.messages.at(-1).role, 'error'); assert.equal(two.messages.at(-1).content, 'other-content');
  await f.bridge.request('create', { sessionId: 'timeout-session', model: 'model-a' });
  await assert.rejects(f.bridge.request('send', { sessionId: 'timeout-session', prompt: 'timeout' }, { timeout: 5 }), { code: 'timeout' });
  await f.bridge.request('dispose', { sessionId: 'timeout-session' });
});
test('bridge disconnect fails pending work and does not replay it', async t => {
  const f = await fixture(t);
  await f.bridge.request('create', { sessionId: 'lost', model: 'model-a' });
  const pending = f.bridge.request('send', { sessionId: 'lost', prompt: 'private-content' });
  f.peer.socket.destroy(); await assert.rejects(pending, { code: 'disconnected' });
  assert.equal(f.bridge.connected, false);
});
test('another local peer cannot replace the authenticated editor or use a wrong capability', async t => {
  const f = await fixture(t);
  const wrong = await connectPeer(f.bridge.endpointFile, fakeVsCode(), '0'.repeat(64));
  await once(wrong.socket, 'close');
  assert.equal(f.bridge.connected, true);
  const valid = await connectPeer(f.bridge.endpointFile, fakeVsCode());
  await once(valid.socket, 'close');
  assert.equal(f.bridge.peer.destroyed, false);
  const lost = once(f.bridge, 'disconnected'); f.peer.socket.destroy(); await lost;
  const invalid = await connectPeer(f.bridge.endpointFile, fakeVsCode(), '0'.repeat(64));
  await once(invalid.socket, 'close'); assert.equal(f.bridge.connected, false);
  const restored = await connectPeer(f.bridge.endpointFile, fakeVsCode()); await restored.accepted;
  assert.equal(f.bridge.connected, true);
});
test('changed editor instance rejects previous conversation context rather than replacing it', async t => {
  const f = await fixture(t); const app = new Controller(f.bridge, f.log); const s = app.sessions[0];
  app.setDraft(s.id, 'remember'); await app.send(s.id);
  f.bridge.instance = 'different-editor-instance'; app.setDraft(s.id, 'recall');
  await assert.rejects(app.send(s.id), /Create a new session/);
  assert.equal(f.vscode.calls.length, 1);
});
test('diagnostics redact credential patterns and authentication headers', () => {
  const result = redact('Authorization: Bearer example-secret\naccess_token=gho_exampleValue123 capability=abcdef');
  assert.doesNotMatch(result, /example-secret|exampleValue123|abcdef/);
});
test('connection properties cross real IPC with a sanitized allowlist and test evidence', async t => {
  const f = await fixture(t); const app = new Controller(f.bridge, f.log);
  await app.refreshProperties();
  const snapshot = app.state();
  assert.equal(snapshot.properties.editor.rows[0].value, 'http://proxy.example:8080');
  assert.equal(snapshot.properties.pipePath, f.bridge.pipePath);
  assert.equal(snapshot.properties.protocol, 2);
  assert.doesNotMatch(JSON.stringify(snapshot), /excluded-test-secret|user:password|hidden-query/);
  assert.ok(!JSON.stringify(snapshot).includes(f.bridge.capability));
  assert.equal(await app.test('model-a'), true);
  assert.equal(app.state().properties.lastTest.status, 'Passed');
  assert.equal(app.state().properties.lastTest.model, 'model-a');
  assert.doesNotMatch(await fs.readFile(f.log.logPath, 'utf8'), /proxy\.example|excluded-test-secret|user:password/);
});
