'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
function redact(value) {
  let text = String(value);
  for (const [name, secret] of Object.entries(process.env)) {
    if (/token|secret|password|cookie|api.?key/i.test(name) && secret?.length >= 4) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+)\b/g, '[REDACTED]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED]')
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '$1: [REDACTED]')
    .replace(/\b(access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|capability)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]')
    .replace(/(https?:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@');
}
class Diagnostics extends EventEmitter {
  constructor(directory) {
    super(); this.lines = [];
    this.logPath = path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid + '.log');
  }
  write(message) {
    let line = new Date().toLocaleTimeString() + ' ' + redact(message);
    try { fs.mkdirSync(path.dirname(this.logPath), { recursive: true }); fs.appendFileSync(this.logPath, line + '\n'); }
    catch { line += ' [Local log unavailable; diagnostics remain visible.]'; }
    this.lines.push(line); if (this.lines.length > 300) this.lines.shift();
    this.emit('line', line); return line;
  }
  failure(stage, error) { return this.write(`${stage}: FAIL [${error.code || error.name || 'unknown'}] ${error.message || error}`); }
}
module.exports = { Diagnostics, redact };
