'use strict';
const MAX_FRAME = 2000000;
function frame(message) {
  const line = JSON.stringify(message);
  if (Buffer.byteLength(line, 'utf8') > MAX_FRAME) throw new Error('Local bridge message exceeds the prototype size limit.');
  return line + '\n';
}
function readFrames(socket, onMessage, onInvalid) {
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', data => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_FRAME) { onInvalid(); return; }
      try { onMessage(JSON.parse(line)); } catch { onInvalid(); return; }
    }
    if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME) onInvalid();
  });
}
module.exports = { frame, readFrames };
