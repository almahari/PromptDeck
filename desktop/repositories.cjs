'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const key = value => createHash('sha256').update(process.platform === 'win32' ? value.toLowerCase() : value).digest('hex').slice(0, 24);
async function git(root, args) {
  try { return (await run('git', ['-C', root, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 8000000, encoding: 'utf8' })).stdout; }
  catch (error) { throw new Error(error.code === 'ENOENT' ? 'Git is unavailable. Install Git for Windows and restart PromptDeck.' : String(error.stderr || error.message).trim()); }
}
class Repositories {
  constructor(directory) { this.file = path.join(directory, 'projects.json'); this.projects = []; this.creating = new Set(); }
  async load() {
    let roots;
    try { roots = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (!Array.isArray(roots)) throw new Error('Invalid saved project list.');
    for (const root of roots) {
      try { await this.add(root, false); }
      catch (e) { this.projects.push({ id: key(root), name: path.basename(root), root, worktrees: [], error: e.message }); }
    }
  }
  async add(folder, save = true) {
    const root = await fs.realpath((await git(folder, ['rev-parse', '--show-toplevel'])).trim());
    const common = await fs.realpath((await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
    let p = this.projects.find(p => p.id === key(common));
    if (!p) { p = { id: key(common), name: path.basename(root), root, common, worktrees: [] }; this.projects.push(p); }
    await this.refresh(p.id);
    if (save) { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(this.projects.map(p => p.root), null, 2)); }
    return p;
  }
  project(id) { const p = this.projects.find(p => p.id === id); if (!p) throw new Error('Unknown project.'); return p; }
  async refresh(id) {
    const p = this.project(id);
    try {
      const output = await git(p.root, ['worktree', 'list', '--porcelain', '-z']);
      const records = []; let current;
      for (const field of output.split('\0')) {
        if (field.startsWith('worktree ')) { current = { root: field.slice(9) }; records.push(current); }
        else if (current && field.startsWith('branch ')) current.branch = field.slice(7).replace(/^refs\/heads\//, '');
        else if (current && field.startsWith('HEAD ')) current.head = field.slice(5);
        else if (current && field.startsWith('prunable')) current.prunable = true;
      }
      p.worktrees = records.map(w => ({ ...w, id: key(p.id + path.resolve(w.root)), projectId: p.id,
        branch: w.branch || 'Detached ' + w.head?.slice(0, 8), isDefault: key(path.resolve(w.root)) === key(p.root) }));
      delete p.error;
    } catch (error) { p.error = error.message; throw error; }
    return p;
  }
  async worktree(id) {
    for (const p of this.projects) {
      const w = p.worktrees.find(w => w.id === id);
      if (!w) continue;
      if ((await fs.lstat(w.root)).isSymbolicLink()) throw new Error('Worktree root cannot be a symlink or junction.');
      const real = await fs.realpath(w.root);
      const top = await fs.realpath((await git(real, ['rev-parse', '--show-toplevel'])).trim());
      const common = await fs.realpath((await git(real, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
      if (key(real) !== key(top) || key(common) !== key(p.common)) throw new Error('Worktree identity changed. Refresh the project.');
      return { ...w, root: real };
    }
    throw new Error('Unknown worktree. Refresh the project.');
  }
  async create(id, name) {
    const p = this.project(id);
    if (this.creating.has(id)) throw new Error('A worktree is already being created for this project.');
    if (typeof name !== 'string' || name !== name.trim() || !name || name.length > 80 || name.startsWith('-')) throw new Error('Enter a Git branch name of 1–80 characters.');
    this.creating.add(id);
    try {
      await git(p.root, ['check-ref-format', '--branch', name]);
      const base = path.join(p.root, '.promptdeck', 'worktrees');
      // Reject symlink/junction ancestors, including dangling links, before creating anything.
      for (const dir of [path.join(p.root, '.promptdeck'), base]) {
        try { if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Worktree container cannot be a symlink or junction.'); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
        await fs.mkdir(dir, { recursive: true });
      }
      const exclude = path.join(p.common, 'info', 'exclude');
      await fs.mkdir(path.dirname(exclude), { recursive: true });
      let contents = ''; try { contents = await fs.readFile(exclude, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!contents.split(/\r?\n/).includes('/.promptdeck/worktrees/')) await fs.appendFile(exclude, '\n/.promptdeck/worktrees/\n');
      const target = path.join(base, name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 45) + '-' + key(name).slice(0, 8));
      await git(p.root, ['worktree', 'add', '-b', name, target, 'HEAD']);
      await this.refresh(id);
      return p.worktrees.find(w => key(path.resolve(w.root)) === key(target));
    } finally { this.creating.delete(id); }
  }
}
module.exports = { Repositories, git };
