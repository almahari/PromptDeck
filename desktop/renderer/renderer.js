'use strict';
const $ = id => document.getElementById(id);
let state, selected, sessionsKey = '', modelsKey = '', messagesKey = '';
async function command(name, args) {
  const response = await window.promptDeck.command(name, args);
  if (!response.ok) { $('error').textContent = response.error; return; }
  $('error').textContent = ''; return response.result;
}
function render(next) {
  state = next;
  if (!state.sessions.some(s => s.id === selected)) selected = state.sessions[0]?.id;
  const current = state.sessions.find(s => s.id === selected); if (!current) return;
  const key = JSON.stringify(state.sessions.map(s => [s.id, s.title, s.busy])) + selected;
  if (key !== sessionsKey) {
    sessionsKey = key; $('sessions').replaceChildren(...state.sessions.map(s => {
      const button = document.createElement('button'); button.textContent = s.title; button.dataset.session = s.id;
      button.setAttribute('aria-current', String(s.id === selected));
      if (s.busy) { const label = document.createElement('span'); label.className = 'busy-mark'; label.textContent = 'Working'; button.append(label); }
      button.onclick = () => { selected = s.id; messagesKey = ''; render(state); $('message').focus(); }; return button;
    }));
  }
  $('session-title').textContent = current.title; $('session-id').textContent = current.id;
  $('connection').textContent = state.connection; $('dot').classList.toggle('connected', state.connected);
  const modelKey = JSON.stringify(state.models);
  if (modelKey !== modelsKey) {
    modelsKey = modelKey; const options = state.models.map(m => { const option = document.createElement('option'); option.value = m.id; option.textContent = m.name; return option; });
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = state.models.length ? 'Select a model' : 'Connect to discover models';
    $('model').replaceChildren(empty, ...options);
  }
  $('model').value = current.model;
  $('model').disabled = current.busy || state.testing;
  if ($('message').value !== current.draft) $('message').value = current.draft;
  $('message').disabled = current.busy; $('send').disabled = current.busy || state.testing || !state.connected || !current.model;
  $('cancel').disabled = !current.busy; $('loading').hidden = !current.busy;
  $('session-status').textContent = current.status;
  $('test').disabled = state.testing || state.sessions.some(s => s.busy); $('cancel-test').hidden = !state.testing;
  const messageKey = selected + JSON.stringify(current.messages);
  if (messageKey !== messagesKey) {
    messagesKey = messageKey;
    if (!current.messages.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Connect VS Code, choose a model, and start a conversation.'; $('conversation').replaceChildren(empty); }
    else $('conversation').replaceChildren(...current.messages.map(m => {
      const entry = document.createElement('article'); entry.className = 'message ' + m.role;
      const author = document.createElement('strong'); author.textContent = m.role === 'assistant' ? 'Copilot · VS Code' : m.role === 'user' ? 'You' : 'Request status';
      const text = document.createElement('span'); text.textContent = m.content; entry.append(author, text); return entry;
    }));
    $('conversation').scrollTop = $('conversation').scrollHeight;
  }
  const diagnostics = state.diagnostics.join('\n');
  if ($('diagnostics').textContent !== diagnostics) { $('diagnostics').textContent = diagnostics; $('diagnostics').scrollTop = $('diagnostics').scrollHeight; }
}
$('new-session').onclick = async () => { const id = await command('new'); if (id) { selected = id; messagesKey = ''; render(await command('state')); $('message').focus(); } };
$('connect').onclick = () => command('connect');
$('model').onchange = () => command('model', { id: selected, model: $('model').value });
$('message').oninput = () => { const current = state.sessions.find(s => s.id === selected); if (current) current.draft = $('message').value; command('draft', { id: selected, text: $('message').value }); };
$('message').onkeydown = event => { if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); if (!$('send').disabled) command('send', { id: selected }); } };
$('send').onclick = () => command('send', { id: selected }); $('cancel').onclick = () => command('cancel', { id: selected });
$('test').onclick = () => command('test', { model: state.sessions.find(s => s.id === selected)?.model });
$('cancel-test').onclick = () => command('cancelTest'); $('logs').onclick = () => command('logs');
window.promptDeck.onState(render); command('state').then(render);
