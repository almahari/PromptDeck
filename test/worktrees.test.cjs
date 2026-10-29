'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Repositories, git } = require('../desktop/repositories.cjs');
const { executeTool, hash } = require('../desktop/workspace-tools.cjs');
const { Controller } = require('../desktop/controller.cjs');
const { fixture } = require('./helpers.cjs');
async function repository(root) {
  await fs.mkdir(root, { recursive: true });
  await git(root, ['init', '-b', 'current-feature']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  await fs.writeFile(path.join(root, 'example.txt'), 'original\n');
  await git(root, ['add', 'example.txt']);
  await git(root, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial']);
}
async function setup(t) {
  const f = await fixture(t); const root = path.join(f.directory, 'repository with spaces');
  await repository(root); const repos = new Repositories(f.directory); const p = await repos.add(root);
  return { ...f, root, repos, p };
}
test('multiple projects, current branch default, worktree creation and persistent discovery', async t => {
  const { root, directory, repos, p } = await setup(t);
  assert.equal(p.worktrees[0].branch, 'current-feature'); assert.equal(p.worktrees[0].isDefault, true);
  await fs.writeFile(path.join(root, 'example.txt'), 'uncommitted');
  const w = await repos.create(p.id, 'feature/new');
  assert.equal(await fs.readFile(path.join(w.root, 'example.txt'), 'utf8'), 'original\n');
  assert.equal(await fs.readFile(path.join(root, 'example.txt'), 'utf8'), 'uncommitted');
  assert.equal((await git(root, ['status', '--porcelain'])).includes('.promptdeck'), false);
  assert.equal((await git(root, ['branch', '--show-current'])).trim(), 'current-feature');
  await assert.rejects(repos.create(p.id, '../escape')); await assert.rejects(repos.create(p.id, 'feature/new'));
  const other = path.join(directory, 'other'); await repository(other); await repos.add(other);
  await repos.add(w.root); assert.equal(repos.projects.length, 2);
  const reloaded = new Repositories(directory); await reloaded.load();
  assert.equal(reloaded.projects.length, 2); assert.equal(reloaded.projects[0].worktrees.length, 2);
});
test('agent edits require approval, protect stale files and reject paths outside the worktree', async t => {
  const { root, directory } = await setup(t);
  const write = { path: 'example.txt', expectedHash: hash('original\n'), content: 'edited' };
  const rejected = await executeTool(root, 'write_file', write, { approve: async () => false });
  assert.equal(rejected.applied, false); assert.equal(await fs.readFile(path.join(root, 'example.txt'), 'utf8'), 'original\n');
  await assert.rejects(executeTool(root, 'write_file', write, { approve: async () => { await fs.writeFile(path.join(root, 'example.txt'), 'manual change'); return true; } }), /changed during review/);
  for (const relative of ['../outside', '.git/config', '.env', path.join(directory, 'outside')]) await assert.rejects(executeTool(root, 'read_file', { path: relative }));
  await fs.symlink(directory, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(executeTool(root, 'write_file', { path: 'escape/outside.txt', content: 'x', expectedHash: null }, { approve: async () => true }), /Symlinks/);
  const abort = new AbortController();
  await assert.rejects(executeTool(root, 'write_file', { path: 'new.txt', content: 'x', expectedHash: null }, { signal: abort.signal, approve: async () => { abort.abort(); return true; } }), /cancelled/);
  await assert.rejects(fs.access(path.join(root, 'new.txt')));
});
test('workspace read, listing, literal search, and approved replacement use current content hashes', async t => {
  const { root } = await setup(t);
  const files = await executeTool(root, 'list_files', {}); assert.ok(files.files.includes('example.txt'));
  const file = await executeTool(root, 'read_file', { path: 'example.txt' }); assert.equal(file.content, 'original\n');
  const search = await executeTool(root, 'search_files', { query: 'original' }); assert.equal(search.matches[0].path, 'example.txt');
  const result = await executeTool(root, 'write_file', { path: 'example.txt', expectedHash: file.hash, content: 'new content' }, { approve: async edit => { assert.equal(edit.before, 'original\n'); return true; } });
  assert.equal(result.applied, true); assert.equal((await executeTool(root, 'read_file', { path: 'example.txt' })).content, 'new content');
});
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 10)); } throw new Error('Timed out waiting for test state'); }
test('three concurrent worktree agents over real IPC apply only approved edits to their own roots', async t => {
  const { repos, p, bridge, log, root } = await setup(t);
  const a = await repos.create(p.id, 'feature/a'); const b = await repos.create(p.id, 'feature/b');
  const c = new Controller(bridge, log, {}, repos);
  const sessions = c.sessions.filter(s => s.worktreeId);
  assert.equal(sessions.length, 3);
  const requests = sessions.map((s, i) => { c.setDraft(s.id, 'Feature ' + i); return c.send(s.id); });
  await until(() => c.approvals.size === 3);
  for (const edit of c.state().approvals) c.approve(edit.id, true);
  await Promise.all(requests);
  for (const [i, s] of sessions.entries()) {
    const w = await repos.worktree(s.worktreeId);
    assert.equal(await fs.readFile(path.join(w.root, 'feature.txt'), 'utf8'), 'Feature ' + i);
    assert.match(s.messages.at(-1).content, /Feature implemented/);
    assert.equal(s.busy, false);
  }
  assert.notEqual(a.root, b.root); assert.notEqual(root, a.root);
});
test('cancelling a worktree agent dismisses pending approval and does not write', async t => {
  const { repos, bridge, log, root } = await setup(t);
  const c = new Controller(bridge, log, {}, repos); const s = c.sessions.find(s => s.worktreeId);
  c.setDraft(s.id, 'Feature'); const request = c.send(s.id);
  await until(() => c.approvals.size === 1); c.cancel(s.id); await request;
  assert.equal(c.approvals.size, 0); assert.equal(s.busy, false);
  await assert.rejects(fs.access(path.join(root, 'feature.txt')));
});
test('a worktree rejects simultaneous sends while its filesystem identity is being validated', async t => {
  const { repos, bridge, log } = await setup(t);
  const c = new Controller(bridge, log, {}, repos); const s = c.sessions.find(s => s.worktreeId);
  c.setDraft(s.id, 'Feature'); const request = c.send(s.id);
  await assert.rejects(c.send(s.id), /Wait/);
  await until(() => c.approvals.size === 1); c.cancel(s.id); await request;
  assert.equal(s.messages.filter(m => m.role === 'user').length, 1);
});
test('disconnecting dismisses agent review without applying an edit', async t => {
  const { repos, bridge, log, root, peer } = await setup(t);
  const c = new Controller(bridge, log, {}, repos); const s = c.sessions.find(s => s.worktreeId);
  c.setDraft(s.id, 'Feature'); const request = c.send(s.id);
  await until(() => c.approvals.size === 1); peer.socket.destroy(); await request;
  assert.equal(c.approvals.size, 0); await assert.rejects(fs.access(path.join(root, 'feature.txt')));
});
module.exports = { repository };
test('restart recovery retains the worktree, draft and old transcript but starts an empty remote context', async t => {
  const { repos, bridge, log } = await setup(t);
  const c = new Controller(bridge, log, {}, repos); const s = c.sessions.find(s => s.worktreeId);
  c.setDraft(s.id, 'first feature'); const first = c.send(s.id);
  await until(() => c.approvals.size === 1);
  for (const edit of c.state().approvals) c.approve(edit.id, false);
  await first;
  const oldId = s.id; const worktreeId = s.worktreeId; const history = structuredClone(s.messages);
  // Simulate a changed extension-host identity after a VS Code restart.
  bridge.instance = 'restarted-editor';
  c.setDraft(oldId, 'new feature after restart');
  assert.equal(c.state().sessions.find(x => x.id === oldId).needsRestart, true);
  await assert.rejects(c.send(oldId), /bridge restarted/);
  const id = c.restartConversation(oldId);
  assert.notEqual(id, oldId); assert.equal(s.worktreeId, worktreeId);
  assert.equal(s.draft, 'new feature after restart'); assert.equal(s.model, 'model-a');
  assert.deepEqual(s.messages, []); assert.deepEqual(s.previousConversations[0].messages, history);
  assert.equal(s.previousConversations[0].id, oldId); assert.equal(s.remoteInstance, null);
  // Restore the fixture identity so the real IPC host can serve a fresh create/send.
  bridge.instance = 'test-editor-instance';
  const next = c.send(id); await until(() => c.approvals.size === 1);
  for (const edit of c.state().approvals) c.approve(edit.id, false);
  await next; assert.equal(s.messages[0].content, 'new feature after restart');
});
test('cannot restart a worktree conversation while an edit review is pending', async t => {
  const { repos, bridge, log } = await setup(t);
  const c = new Controller(bridge, log, {}, repos); const s = c.sessions.find(s => s.worktreeId);
  c.setDraft(s.id, 'feature'); const request = c.send(s.id);
  await until(() => c.approvals.size === 1);
  assert.throws(() => c.restartConversation(s.id), /Finish or cancel/);
  c.cancel(s.id); await request;
});
