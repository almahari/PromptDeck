'use strict';

// Only documented configuration and account/model metadata. Never request a session/token.
function safeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Not set (system/PAC or provider settings may still apply)';
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'socks:', 'socks4:', 'socks5:'].includes(url.protocol) || !url.hostname) throw new Error();
    // Deliberately omit userinfo, path, query and fragment, even if they look innocuous.
    return url.protocol + '//' + url.host;
  } catch { return 'Configured; address withheld because it could not be safely parsed'; }
}
function safeText(value) {
  return String(value ?? '').slice(0, 4096)
    .replace(/\b(?:https?|socks[45]?):\/\/[^\s<>"']+/gi, safeOrigin)
    .replace(/[^,\s;:]+:[^,\s;@]+@/g, '[REDACTED]@')
    .replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+)\b/g, '[REDACTED]')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, '[REDACTED]')
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '$1: [REDACTED]')
    .replace(/\b(access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|capability)["']?\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=[REDACTED]')
    .replace(/[\r\n\t]/g, ' ');
}
function safeReport(report) {
  if (!report || !Array.isArray(report.rows)) return null;
  return {
    capturedAt: Number.isFinite(Date.parse(report.capturedAt)) ? new Date(report.capturedAt).toISOString() : null,
    rows: report.rows.slice(0, 100).map(row => Object.fromEntries(
      ['section', 'key', 'value', 'evidence', 'source'].map(key => [key, safeText(row?.[key])])) )
  };
}
function display(value) {
  if (value === undefined) return 'Not exposed by this VS Code version';
  if (Array.isArray(value)) return value.length ? value.map(safeText).join(', ') : 'None configured';
  return typeof value === 'boolean' ? String(value) : safeText(value || 'Not set');
}
function configuration(vscode, section, key, format = display) {
  try {
    const config = vscode.workspace.getConfiguration(section);
    const value = config.get(key);
    const inspection = config.inspect?.(key);
    const level = ['workspaceFolderValue', 'workspaceValue', 'globalValue', 'defaultValue'].find(name => inspection?.[name] !== undefined);
    return { value: format(value), evidence: value === undefined ? 'Unavailable' : 'Configuration snapshot',
      source: `${section}.${key}` + (level ? ` (${level.replace('Value', '')}; source hint)` : '') };
  } catch { return { value: 'Configuration could not be read', evidence: 'Unavailable', source: `${section}.${key}` }; }
}
async function collectConnectionInfo(vscode, context, { env = process.env, pid = process.pid } = {}) {
  const rows = [];
  const add = (section, key, value, evidence = 'Reported metadata', source = 'VS Code public API') => rows.push({ section, key, value: safeText(value), evidence, source });
  add('Connection identity', 'Routing', 'Electron → local named pipe → VS Code Language Model API (vendor: copilot) → provider-managed service');
  add('Connection identity', 'VS Code application', vscode.env.appName);
  add('Connection identity', 'VS Code version', vscode.version);
  add('Connection identity', 'Editor window session ID (not a GitHub login)', vscode.env.sessionId);
  add('Connection identity', 'Bridge extension host PID', pid, 'Reported process metadata', 'VS Code UI extension host');
  add('Connection identity', 'Workspace remote context', vscode.env.remoteName || 'No remote context reported', 'Reported metadata', 'vscode.env.remoteName; does not identify model routing');
  add('Connection identity', 'Bridge extension', `${context.extension.id} ${context.extension.packageJSON.version}`);
  const copilot = vscode.extensions.getExtension('GitHub.copilot-chat');
  add('Connection identity', 'Copilot Chat extension version', copilot?.packageJSON?.version || 'Not separately exposed by this VS Code build');
  for (const provider of ['github', 'github-enterprise']) {
    try {
      const accounts = await vscode.authentication.getAccounts(provider);
      add('GitHub account / URLs', `Available accounts (${provider})`, accounts.map(account => safeText(account.label)).join(', ') || 'None reported',
        'Account metadata only', 'authentication.getAccounts — not the selected Copilot account');
    } catch { add('GitHub account / URLs', `Available accounts (${provider})`, 'Provider unavailable', 'Unavailable'); }
  }
  add('GitHub account / URLs', 'Active Copilot account', 'Not exposed by the Language Model API; available accounts above do not prove which account Copilot selected', 'Unavailable');
  add('GitHub account / URLs', 'GitHub.com provider base URL', 'https://github.com', 'Provider identity; not an observed request URL', 'Built-in github authentication provider');
  for (const key of ['uri', 'uris']) {
    const result = configuration(vscode, 'github-enterprise', key, value => Array.isArray(value) ? value.map(safeOrigin).join(', ') || 'Not set' : safeOrigin(value));
    add('GitHub account / URLs', 'Configured enterprise URL' + (key === 'uris' ? 's' : ''), result.value, result.evidence, result.source);
  }
  add('GitHub account / URLs', 'Actual model service request URL', 'Not exposed by the Language Model API; no private endpoint is inferred', 'Unavailable');
  add('GitHub account / URLs', 'Actual resolved proxy / PAC route', 'Not exposed by the Language Model API; settings below do not prove the route used', 'Unavailable');
  for (const key of ['proxy', 'proxySupport', 'noProxy', 'proxyStrictSSL', 'systemCertificates', 'systemCertificatesNode', 'useLocalProxyConfiguration', 'fetchAdditionalSupport', 'webSocketAdditionalSupport']) {
    const result = configuration(vscode, 'http', key, key === 'proxy' ? safeOrigin : display);
    add('VS Code proxy / TLS configuration', 'http.' + key, result.value, result.evidence, result.source);
  }
  add('VS Code proxy / TLS configuration', 'Proxy authorization / credential stores', 'Not read or transferred', 'Intentionally excluded');
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'])
    add('VS Code bridge host environment', key, safeOrigin(env[key]), 'Environment snapshot; may not control the provider', 'Allowlisted extension-host environment variable');
  for (const key of ['NO_PROXY', 'no_proxy'])
    add('VS Code bridge host environment', key, env[key] ? safeText(env[key]) : 'Not set', 'Environment snapshot; may not control the provider', 'Allowlisted extension-host environment variable');
  add('VS Code bridge host environment', 'NODE_EXTRA_CA_CERTS', env.NODE_EXTRA_CA_CERTS ? 'Configured (certificate file contents not read)' : 'Not set', 'Environment snapshot');
  add('VS Code bridge host environment', 'NODE_TLS_REJECT_UNAUTHORIZED', env.NODE_TLS_REJECT_UNAUTHORIZED === undefined ? 'Not set' : safeText(env.NODE_TLS_REJECT_UNAUTHORIZED), 'Environment snapshot; unchanged by PromptDeck');
  return safeReport({ capturedAt: new Date().toISOString(), rows });
}
module.exports = { collectConnectionInfo, safeReport, safeText, safeOrigin };
