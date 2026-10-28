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
  if ($('properties-dialog').open) renderProperties();
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

function renderProperties() {
  const p = state.properties || {};
  const rows = [];
  const add = (section, key, value, evidence = 'Desktop metadata', source = '') => rows.push({ section, key, value: String(value ?? 'Not available'), evidence, source });
  $('properties-status').textContent = (p.connected ? 'Connected to VS Code' : 'Disconnected — any editor snapshot below is historical')
    + (p.editor?.capturedAt ? ' · Snapshot: ' + new Date(p.editor.capturedAt).toLocaleString() : ' · Editor properties not received; connect bridge 0.3.0');
  $('refresh-properties').disabled = !p.connected;
  add('Desktop → VS Code transport', 'Application', 'PromptDeck ' + (p.runtime?.appVersion || ''));
  add('Desktop → VS Code transport', 'Desktop runtime', `Electron ${p.runtime?.electron || '?'} / Node ${p.runtime?.node || '?'} / ${p.runtime?.platform || '?'} ${p.runtime?.arch || ''}`);
  add('Desktop → VS Code transport', 'Local IPC', p.pipePath, 'Local pipe address; not a GitHub URL');
  add('Desktop → VS Code transport', 'Protocol / desktop process', `${p.protocol} / PID ${p.desktopPid}`);
  add('Desktop → VS Code transport', 'VS Code bridge instance', p.bridgeInstance);
  add('Desktop → VS Code transport', 'Last bridge handshake', p.connectedAt ? new Date(p.connectedAt).toLocaleString() : 'Not connected');
  add('Desktop → VS Code transport', 'Remote inference HTTP in Electron', 'None — delegated to VS Code; desktop proxy settings are not the model route');
  add('Desktop → VS Code transport', 'Local connection key / GitHub credentials', 'Never displayed', 'Intentionally excluded');
  rows.push(...(p.editor?.rows || []));
  const current = state.sessions.find(s => s.id === selected); const model = state.models.find(m => m.id === current?.model);
  for (const [key, value] of Object.entries({ 'Selected model ID': model?.id, 'Display name': model?.name, Vendor: model?.vendor, Family: model?.family, Version: model?.version, 'Maximum input tokens': model?.maxInputTokens }))
    add('Selected session / model', key, value || 'Not exposed / not selected', 'VS Code model metadata; not a server URL');
  add('Selected session / model', 'Local conversation ID', current?.id);
  add('Verification evidence', 'Last connection test', p.lastTest?.status || 'Not run', 'Inference result only; does not reveal network route');
  if (p.lastTest) {
    add('Verification evidence', 'Test model / completion', `${p.lastTest.model || 'Not selected'} / ${p.lastTest.completedAt || 'Running'}`);
    add('Verification evidence', 'Test bridge instance', p.lastTest.bridgeInstance);
    if (p.lastTest.error) add('Verification evidence', 'Test failure', `${p.lastTest.stage}: ${p.lastTest.error}`);
  }
  if (p.lastResponse) add('Verification evidence', 'Last successful chat response', `${p.lastResponse.at} / model ${p.lastResponse.model} / instance ${p.lastResponse.bridgeInstance}`, 'Response received; not proof of a particular proxy or account');
  const groups = new Map(); for (const row of rows) { if (!groups.has(row.section)) groups.set(row.section, []); groups.get(row.section).push(row); }
  const content = [];
  const order = ['VS Code proxy / TLS configuration', 'GitHub account / URLs', 'Connection identity', 'Selected session / model', 'Verification evidence', 'VS Code bridge host environment', 'Desktop → VS Code transport'];
  const sorted = [...groups].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  for (const [section, entries] of sorted) {
    const heading = document.createElement('h3'); heading.textContent = section;
    const table = document.createElement('table'); const header = document.createElement('tr');
    for (const text of ['Property', 'Value', 'Evidence / source']) { const th = document.createElement('th'); th.textContent = text; th.scope = 'col'; header.append(th); }
    const thead = document.createElement('thead'); thead.append(header); table.append(thead);
    const body = document.createElement('tbody');
    for (const row of entries) {
      const tr = document.createElement('tr');
      for (const text of [row.key, row.value]) { const cell = document.createElement('td'); cell.textContent = text; tr.append(cell); }
      const evidence = document.createElement('td'); evidence.textContent = row.evidence;
      if (row.source) { const source = document.createElement('span'); source.className = 'property-source'; source.textContent = row.source; evidence.append(source); }
      tr.append(evidence); body.append(tr);
    }
    table.append(body); content.push(heading, table);
  }
  $('properties-content').replaceChildren(...content);
}
$('properties').onclick = () => { renderProperties(); $('properties-dialog').showModal(); };
$('close-properties').onclick = () => $('properties-dialog').close();
$('refresh-properties').onclick = async () => {
  $('properties-feedback').textContent = 'Refreshing…'; $('refresh-properties').disabled = true;
  const response = await window.promptDeck.command('properties');
  $('properties-feedback').textContent = response.ok ? 'Editor snapshot refreshed. No connection settings changed.' : response.error;
  renderProperties();
};
