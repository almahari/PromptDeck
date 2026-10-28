'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { git } = require('./repositories.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');
const blocked = value => value.split(/[\\/]/).some(p => /^(\.git|\.promptdeck|node_modules|\.env(?:\..*)?)$/i.test(p) || /\.(pem|key|pfx|p12)$/i.test(p));
function inside(root, target) { const rel = path.relative(root, target); return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel); }
async function filePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[:\x00-\x1f]/.test(relative) || blocked(relative)) throw new Error('Provide a relative workspace path; metadata and credential files are excluded.');
  const target = path.resolve(root, relative);
  if (!inside(root, target) || target === root) throw new Error('Path leaves the selected worktree.');
  let cursor = root;
  for (const segment of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, segment);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Symlinks and junctions are excluded from agent file access.');
      if (!inside(root, await fs.realpath(cursor))) throw new Error('Path leaves the selected worktree.');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return target;
}
async function read(target) {
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 100000) throw new Error('Only text files of at most 100 KB are supported.');
  const bytes = await fs.readFile(target);
  if (bytes.includes(0)) throw new Error('Binary files are unsupported.');
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return { content, hash: hash(content) };
}
async function executeTool(root, name, input, { signal, approve } = {}) {
  const check = () => { if (signal?.aborted) throw new Error('Request cancelled.'); };
  check();
  if (!input || typeof input !== 'object') throw new Error('Invalid tool input.');
  if (name === 'list_files' || name === 'search_files') {
    const files = [...new Set((await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(f => f && !blocked(f)))];
    if (name === 'list_files') return { files: files.slice(0, 1000), truncated: files.length > 1000 };
    if (typeof input.query !== 'string' || !input.query || input.query.length > 200) throw new Error('Search needs a literal query of 1–200 characters.');
    const matches = [];
    for (const file of files.slice(0, 500)) {
      check();
      let text; try { text = (await read(await filePath(root, file))).content; } catch { continue; }
      for (const [i, line] of text.split('\n').entries()) if (line.includes(input.query)) {
        matches.push({ path: file, line: i + 1, text: line.slice(0, 500) });
        if (matches.length === 100) return { matches, truncated: true };
      }
    }
    return { matches, truncated: files.length > 500 };
  }
  if (name === 'read_file') return read(await filePath(root, input.path));
  if (name === 'write_file') {
    if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > 100000) throw new Error('Write limit: 100 KB of text.');
    const target = await filePath(root, input.path);
    let before = null; try { before = await read(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (input.expectedHash !== (before?.hash ?? null)) throw new Error('File changed or expectedHash missing. Read the current file first; use null for a new file.');
    if (!approve || !await approve({ path: input.path, root, before: before?.content ?? null, after: input.content }, signal)) return { applied: false, reason: 'User rejected this edit.' };
    check();
    await filePath(root, input.path);
    let now = null; try { now = await read(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (now?.hash !== before?.hash) throw new Error('File changed during review. Read it again before editing.');
    await fs.mkdir(path.dirname(target), { recursive: true });
    check(); await filePath(root, input.path); check();
    if (!before) await fs.writeFile(target, input.content, { flag: 'wx' });
    else await fs.writeFile(target, input.content);
    return { applied: true, hash: hash(input.content) };
  }
  throw new Error('Unknown workspace tool.');
}
module.exports = { executeTool, filePath, hash };
