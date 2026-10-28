'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectConnectionInfo, safeReport, safeOrigin } = require('../connection-info');

test('connection properties include proxy/account metadata without accessing tokens or auth headers', async () => {
  const reads = [];
  const values = { http: { proxy: 'http://proxy-user:proxy-password@proxy.example:8080/private?api_key=query-secret#fragment-secret', proxySupport: 'override', noProxy: ['localhost', 'user:password@bypass.example'], proxyStrictSSL: false, systemCertificates: true },
    'github-enterprise': { uris: ['https://enterprise-user:enterprise-password@ghe.example/login?token=enterprise-query'] } };
  const account = { label: 'corporate-user' };
  Object.defineProperty(account, 'accessToken', { get() { throw new Error('Token access forbidden'); } });
  const vscode = {
    version: 'test-vscode', env: { appName: 'VS Code', sessionId: 'editor-window-id', remoteName: 'ssh-remote' },
    extensions: { getExtension: () => ({ packageJSON: { version: 'test-copilot' } }) },
    authentication: { getAccounts: async provider => provider === 'github' ? [account] : [], getSession() { throw new Error('Session access forbidden'); } },
    workspace: { getConfiguration: section => ({ get(key) {
      reads.push(section + '.' + key);
      if (/authorization|password|token/i.test(key)) throw new Error('Credential configuration read forbidden');
      return values[section]?.[key];
    }, inspect: key => ({ globalValue: values[section]?.[key] }) }) }
  };
  const env = { HTTPS_PROXY: 'http://environment-user:environment-password@env-proxy.example:8443/secret?token=env-query', NO_PROXY: 'localhost,.corp.example', NODE_EXTRA_CA_CERTS: 'private-certificate-file' };
  Object.defineProperty(env, 'GITHUB_TOKEN', { get() { throw new Error('Secret environment read forbidden'); } });
  const report = await collectConnectionInfo(vscode, { extension: { id: 'almahari.promptdeck-bridge', packageJSON: { version: '0.3.0' } } }, { env, pid: 123 });
  const json = JSON.stringify(report);
  for (const secret of ['proxy-user', 'proxy-password', 'query-secret', 'fragment-secret', 'environment-user', 'environment-password', 'env-query', 'enterprise-user', 'enterprise-password', 'enterprise-query', 'private-certificate-file', 'user:password']) assert.ok(!json.includes(secret), secret + ' must not escape');
  assert.ok(json.includes('http://proxy.example:8080')); assert.ok(json.includes('http://env-proxy.example:8443'));
  assert.ok(json.includes('https://ghe.example')); assert.ok(json.includes('corporate-user'));
  assert.equal(report.rows.find(r => r.key === 'http.proxyStrictSSL').value, 'false');
  assert.equal(report.rows.find(r => r.key === 'Actual model service request URL').evidence, 'Unavailable');
  assert.match(report.rows.find(r => r.key === 'Active Copilot account').value, /Not exposed/);
  assert.equal(reads.includes('http.proxyAuthorization'), false);
});

test('malformed URLs and unknown report fields are withheld rather than serialized', () => {
  assert.match(safeOrigin('not-a-url-with-secret'), /withheld/);
  const report = safeReport({ capturedAt: 'invalid', accessToken: 'secret-top-level', rows: [{ section: 'test', key: 'proxy', value: 'https://user:pass@proxy.example/token-secret?q=query-secret', evidence: 'Configured', source: 'http.proxy', password: 'secret-row' }] });
  assert.equal(report.capturedAt, null);
  assert.deepEqual(Object.keys(report.rows[0]), ['section', 'key', 'value', 'evidence', 'source']);
  assert.equal(report.rows[0].value, 'https://proxy.example');
  assert.doesNotMatch(JSON.stringify(report), /secret-top-level|secret-row|token-secret|query-secret|user:pass/);
});
