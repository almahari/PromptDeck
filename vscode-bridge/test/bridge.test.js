'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHost } = require('../bridge');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture() {
  let concurrent = 0, maximum = 0;
  const calls = [];
  class CancellationTokenSource {
    token = { isCancellationRequested: false };
    cancel() { this.token.isCancellationRequested = true; }
    dispose() {}
  }
  const models = ['model-a', 'model-b'].map(id => ({ id, name: id,
    async sendRequest(messages, options, token) {
      calls.push({ model: id, messages: [...messages] });
      const first = messages[0].content;
      return { text: (async function* () {
        concurrent++; maximum = Math.max(maximum, concurrent);
        try {
          await delay(30);
          if (token.isCancellationRequested) throw new Error('Cancelled');
          yield first;
        } finally { concurrent--; }
      })() };
    }
  }));
  const host = createHost({ CancellationTokenSource, lm: { selectChatModels: async () => models },
    LanguageModelChatMessage: { User: content => ({ role: 'user', content }), Assistant: content => ({ role: 'assistant', content }) } });
  let sequence = 0;
  const request = (method, args) => host.request({ id: String(++sequence), method, args });
  return { host, request, calls, maximum: () => maximum };
}
test('three conversations run concurrently and retain only their own history', async () => {
  const f = fixture(); await f.host.discover();
  for (let i = 0; i < 3; i++) await f.request('create', { sessionId: 's' + i, model: 'model-a' });
  const responses = await Promise.all([0, 1, 2].map(i => f.request('send', { sessionId: 's' + i, prompt: 'marker' + i })));
  assert.deepEqual(responses.map(r => r.result.content), ['marker0', 'marker1', 'marker2']);
  assert.equal(f.maximum(), 3);
  const recalled = await Promise.all([0, 1, 2].map(i => f.request('send', { sessionId: 's' + i, prompt: 'recall' })));
  assert.deepEqual(recalled.map(r => r.result.content), ['marker0', 'marker1', 'marker2']);
  for (const call of f.calls.slice(3)) assert.equal(call.messages.length, 3);
});
test('cancellation affects one request and does not commit partial history', async () => {
  const f = fixture(); await f.host.discover();
  for (const sessionId of ['one', 'two']) await f.request('create', { sessionId, model: 'model-a' });
  const pending = f.host.request({ id: 'cancel-me', method: 'send', args: { sessionId: 'one', prompt: 'cancelled-marker' } });
  const other = f.request('send', { sessionId: 'two', prompt: 'other-marker' });
  await delay(5); await f.host.request({ id: 'cancel-me', method: 'cancel' });
  assert.equal((await pending).error.code, 'cancelled');
  assert.equal((await other).result.content, 'other-marker');
  const retry = await f.request('send', { sessionId: 'one', prompt: 'new-marker' });
  assert.equal(retry.result.content, 'new-marker');
  assert.equal(f.calls.at(-1).messages.length, 1);
});
test('model selection stays per session and changes preserve context', async () => {
  const f = fixture(); await f.host.discover();
  await f.request('create', { sessionId: 'one', model: 'model-a' });
  await f.request('send', { sessionId: 'one', prompt: 'remember' });
  await f.request('model', { sessionId: 'one', model: 'model-b' });
  assert.equal((await f.request('send', { sessionId: 'one', prompt: 'recall' })).result.content, 'remember');
  assert.equal(f.calls.at(-1).model, 'model-b');
  assert.match((await f.request('model', { sessionId: 'one', model: 'missing' })).error.message, /unavailable/);
  await f.request('send', { sessionId: 'one', prompt: 'recall' });
  assert.equal(f.calls.at(-1).model, 'model-b');
});
test('disposing a busy session cancels and retires it without waiting for provider completion', async () => {
  const f = fixture(); await f.host.discover();
  await f.request('create', { sessionId: 'one', model: 'model-a' });
  const pending = f.request('send', { sessionId: 'one', prompt: 'retired-marker' });
  await delay(5);
  assert.deepEqual((await f.request('dispose', { sessionId: 'one' })).result, {});
  assert.equal((await pending).error.code, 'cancelled');
  assert.match((await f.request('send', { sessionId: 'one', prompt: 'recall' })).error.message, /not found/);
});
