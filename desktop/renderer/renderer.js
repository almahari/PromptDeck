'use strict';
const $ = id => document.getElementById(id);
let state, selected, modelsKey = '', messagesKey = '', projectsKey = '', creatingProject, approvalId;
const iconPaths = {
  plus: 'M12 5v14M5 12h14', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1',
  plug: 'M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v4', online: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M8 12l3 3 5-6', offline: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M6 6l12 12',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  restart: 'M4 4v6h6M4 10a8 8 0 1 1 1 8', stop: 'M6 6h12v12H6Z', send: 'M12 19V5M5 12l7-7 7 7',
  activity: 'M3 12h4l3-8 4 16 3-8h4', file: 'M14 3H5v18h14V8ZM14 3v5h5M8 12h8M8 16h8',
  chevron: 'M9 5l7 7-7 7', folder: 'M3 6h7l2 2h9v12H3Z', branch: 'M6 3v12a3 3 0 1 0 3 3M6 9h8a4 4 0 0 0 4-4V3'
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const line = document.createElementNS(svg.namespaceURI, 'path'); line.setAttribute('d', iconPaths[name] || iconPaths.plus); svg.append(line); return svg;
}
document.querySelectorAll('[data-icon]').forEach(element => element.append(icon(element.dataset.icon)));
let collapsedProjects = new Set();
try { const saved = JSON.parse(localStorage.getItem('collapsedProjects') || '[]'); if (Array.isArray(saved)) collapsedProjects = new Set(saved.filter(x => typeof x === 'string')); } catch {}
function rememberProjects() { try { localStorage.setItem('collapsedProjects', JSON.stringify([...collapsedProjects])); } catch {} }
async function command(name, args) {
  const response = await window.promptDeck.command(name, args);
  if (!response.ok) { $('error').textContent = response.error; return; }
  $('error').textContent = ''; return response.result;
}
function render(next) {
  state = next;
  if ($('properties-dialog').open) renderProperties();
  if (!state.sessions.some(s => s.id === selected && s.worktreeId)) selected = state.sessions.find(s => s.worktreeId)?.id || state.sessions[0]?.id;
  const current = state.sessions.find(s => s.id === selected); if (!current) return;
  const key = JSON.stringify(state.sessions.map(s => [s.id, s.title, s.busy])) + selected;
  const projectKey = JSON.stringify(state.projects) + key;
  if (projectKey !== projectsKey) {
    projectsKey = projectKey;
    const projects = (state.projects || []).map(p => {
      const group = document.createElement('section'); group.className = 'project';
      const heading = document.createElement('div'); heading.className = 'session-heading';
      const toggle = document.createElement('button'); toggle.className = 'project-toggle'; toggle.title = p.root;
      const arrow = icon('chevron'); arrow.classList.add('project-chevron');
      const title = document.createElement('span'); title.className = 'project-name'; title.textContent = p.name;
      const count = document.createElement('span'); count.className = 'project-count'; count.textContent = p.worktrees.length;
      const list = document.createElement('div'); list.className = 'worktree-list'; list.id = 'worktrees-' + p.id; list.hidden = collapsedProjects.has(p.id);
      toggle.setAttribute('aria-expanded', String(!list.hidden)); toggle.setAttribute('aria-controls', list.id); toggle.setAttribute('aria-label', p.name + ' worktrees');
      toggle.append(arrow, icon('folder'), title, count);
      toggle.onclick = () => { list.hidden = !list.hidden; toggle.setAttribute('aria-expanded', String(!list.hidden)); if (list.hidden) collapsedProjects.add(p.id); else collapsedProjects.delete(p.id); rememberProjects(); };
      const add = document.createElement('button'); add.className = 'icon-button'; add.append(icon('plus')); add.setAttribute('aria-label', 'Create worktree in ' + p.name); add.title = 'Create worktree in ' + p.name; add.disabled = !!p.error;
      add.onclick = () => { creatingProject = p.id; $('worktree-project').textContent = p.root; $('worktree-name').value = ''; $('worktree-error').textContent = ''; $('worktree-dialog').showModal(); $('worktree-name').focus(); };
      heading.append(toggle, add); group.append(heading);
      if (p.error) { const error = document.createElement('p'); error.className = 'hint'; error.textContent = p.error; group.append(error); }
      for (const w of p.worktrees) {
        const s = state.sessions.find(s => s.worktreeId === w.id);
        if (!s) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = w.branch + ' · 100-conversation limit reached'; list.append(hint); continue; }
        const button = document.createElement('button'); button.className = 'worktree'; button.dataset.worktree = w.id; button.dataset.session = s.id;
        const label = document.createElement('span'); label.className = 'worktree-name'; label.textContent = w.branch;
        button.append(icon('branch'), label); button.title = w.root + (w.isDefault ? ' · Current checkout' : '');
        button.setAttribute('aria-label', w.branch + (w.isDefault ? ' · Current checkout' : '') + (s.busy ? ' · Working' : ''));
        if (w.isDefault) { const badge = document.createElement('span'); badge.className = 'checkout-badge'; badge.textContent = 'Current'; button.append(badge); }
        if (s.busy) { const busy = document.createElement('span'); busy.className = 'busy-dot'; busy.setAttribute('aria-hidden', 'true'); button.append(busy); }
        button.setAttribute('aria-current', String(selected === s.id));
        button.onclick = () => { selected = s.id; messagesKey = ''; render(state); $('message').focus(); }; list.append(button);
      }
      group.append(list);
      return group;
    });
    if (!projects.length) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = 'Add a local Git repository to start a worktree agent.'; projects.push(hint); }
    const scrollTop = $('projects').scrollTop; $('projects').replaceChildren(...projects); $('projects').scrollTop = scrollTop;
  }
  $('session-title').textContent = current.worktreeId ? current.title : 'Select a worktree'; $('session-id').textContent = current.id;
  const project = state.projects?.find(p => p.id === current.projectId);
  const worktree = project?.worktrees.find(w => w.id === current.worktreeId);
  $('workspace-path').hidden = !current.worktreeId; $('workspace-path').textContent = 'Agent · ' + (worktree?.root || 'Worktree unavailable — refresh project');
  $('open-vscode').hidden = !worktree;
  $('message').placeholder = current.worktreeId ? 'Describe the feature to implement in this worktree…' : 'Ask Copilot…';
  $('connection').textContent = state.connection; $('dot').classList.toggle('connected', state.connected);
  $('dot').replaceChildren(icon(state.connected ? 'online' : 'offline'));
  $('connection-status').title = (state.connected ? 'Connected' : 'Not connected') + ' — ' + state.connection;
  $('connection-status').setAttribute('aria-label', state.connected ? 'Connected to VS Code' : 'Not connected to VS Code');
  const modelKey = JSON.stringify(state.models);
  if (modelKey !== modelsKey) {
    modelsKey = modelKey; const options = state.models.map(m => { const option = document.createElement('option'); option.value = m.id; option.textContent = m.name; return option; });
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = state.models.length ? 'Select a model' : 'Connect to discover models';
    $('model').replaceChildren(empty, ...options);
  }
  $('model').value = current.model;
  $('model').disabled = current.busy || state.testing;
  if ($('message').value !== current.draft) $('message').value = current.draft;
  $('message').disabled = current.busy || !current.worktreeId; $('send').disabled = current.busy || state.testing || !state.connected || !current.model || current.needsRestart || !current.worktreeId;
  $('cancel').disabled = !current.busy; $('loading').hidden = !current.busy;
  $('session-status').textContent = current.status;
  $('restart-conversation').disabled = current.busy || state.testing || !current.worktreeId;
  $('access-field').hidden = current.mode !== 'agent';
  $('access-mode').value = current.accessMode || 'review';
  $('access-description').textContent = current.accessMode === 'full'
    ? 'Full access is on: file edits apply automatically in this worktree for this conversation. Switch back to review at any time. Shell commands are not available.'
    : 'Each file edit needs review. Full access allows automatic file edits in this worktree for this conversation. Shell commands are not available.';
  $('access-mode').title = $('access-description').textContent;
  if (current.needsRestart) $('session-status').textContent = 'VS Code bridge restarted. Click Start new conversation to continue in this worktree. Your draft will be kept; previous context will not be sent.';
  const previous = current.previousConversations || [];
  $('previous-conversations').hidden = !previous.length;
  const archiveKey = selected + JSON.stringify(previous);
  if ($('previous-content').dataset.key !== archiveKey) {
    $('previous-content').dataset.key = archiveKey;
    $('previous-content').replaceChildren(...previous.map(turn => {
      const section = document.createElement('section'); const heading = document.createElement('p');
      heading.className = 'mono'; heading.textContent = `${turn.at} · ${turn.model} · ${turn.id}`; section.append(heading);
      for (const message of turn.messages) { const entry = document.createElement('p'); entry.className = 'message'; entry.textContent = `${message.role}: ${message.content}`; section.append(entry); }
      return section;
    }));
  }
  if (current.worktreeId && !state.agentAvailable) $('session-status').textContent = 'Worktree agent requires bridge 0.4.0. Install the updated VSIX and reconnect.';
  const activity = current.activities?.slice(-4) || [];
  $('agent-activity').hidden = !activity.length;
  $('agent-activity').textContent = activity.map(a => `${a.name}${a.path ? ' · ' + a.path : ''}: ${a.status}`).join(' | ');
  $('test').disabled = state.testing || state.sessions.some(s => s.busy); $('cancel-test').hidden = !state.testing;
  const messageKey = selected + JSON.stringify(current.messages);
  if (messageKey !== messagesKey) {
    messagesKey = messageKey;
    if (!current.messages.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = current.worktreeId ? 'Describe a feature for this worktree. The agent can inspect files and propose edits for your review.' : 'Add a project and select a worktree to start working.'; $('conversation').replaceChildren(empty); }
    else $('conversation').replaceChildren(...current.messages.map(m => {
      const entry = document.createElement('article'); entry.className = 'message ' + m.role;
      const author = document.createElement('strong'); author.textContent = m.role === 'assistant' ? 'Copilot · VS Code' : m.role === 'user' ? 'You' : 'Request status';
      const text = document.createElement('span'); text.textContent = m.content; entry.append(author, text); return entry;
    }));
    $('conversation').scrollTop = $('conversation').scrollHeight;
  }
  const diagnostics = state.diagnostics.join('\n');
  if ($('diagnostics').textContent !== diagnostics) { $('diagnostics').textContent = diagnostics; $('diagnostics').scrollTop = $('diagnostics').scrollHeight; }
  const approval = state.approvals?.[0];
  if (!approval) { if ($('edit-dialog').open) $('edit-dialog').close(); approvalId = null; }
  else if (approval.id !== approvalId) {
    approvalId = approval.id;
    $('edit-path').textContent = `${approval.title} · ${approval.root}\n${approval.path}`;
    $('edit-before').textContent = approval.before ?? '(New file)'; $('edit-after').textContent = approval.after;
    if (!$('edit-dialog').open) $('edit-dialog').showModal();
  }
}
$('add-project').onclick = async () => { $('add-project').disabled = true; try { await command('project.add'); } finally { $('add-project').disabled = false; } };
$('restart-conversation').onclick = async () => {
  const id = await command('restart', { id: selected });
  if (id) { selected = id; messagesKey = ''; render(await command('state')); $('message').focus(); }
};
$('refresh-projects').onclick = () => command('project.refresh');
$('open-vscode').onclick = () => command('worktree.open', { worktreeId: state.sessions.find(s => s.id === selected)?.worktreeId });
$('close-worktree').onclick = () => $('worktree-dialog').close();
$('worktree-form').onsubmit = async event => {
  event.preventDefault(); $('create-worktree').disabled = true; $('worktree-error').textContent = 'Creating worktree…';
  try {
    const response = await window.promptDeck.command('worktree.create', { projectId: creatingProject, name: $('worktree-name').value });
    if (!response.ok) { $('worktree-error').textContent = response.error; return; }
    selected = response.result; collapsedProjects.delete(creatingProject); rememberProjects(); projectsKey = ''; $('worktree-dialog').close(); render(await command('state'));
  } finally { $('create-worktree').disabled = false; }
};
$('apply-edit').onclick = () => command('approval', { id: approvalId, accepted: true });
$('access-mode').onchange = () => command('access', { id: selected, mode: $('access-mode').value });
$('allow-session').onclick = () => {
  const approval = state.approvals?.find(a => a.id === approvalId);
  if (approval) command('access', { id: approval.sessionId, mode: 'full' });
};
$('reject-edit').onclick = () => command('approval', { id: approvalId, accepted: false });
$('edit-dialog').addEventListener('cancel', event => { event.preventDefault(); command('approval', { id: approvalId, accepted: false }); });
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
