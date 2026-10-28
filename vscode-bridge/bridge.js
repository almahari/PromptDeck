'use strict';

// No authentication APIs, credential access, direct GitHub HTTP, or SDK/CLI fallback.
function createHost(vscode) {
  const sessions = new Map();
  const active = new Map();
  let models = [];
  async function discover() {
    models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    return models.map(m => ({ id: m.id, name: m.name || m.id }));
  }
  function model(id) {
    const found = models.find(m => m.id === id);
    if (!found) throw new Error('Requested model unavailable in the VS Code Copilot catalog. Select another model explicitly.');
    return found;
  }
  function session(id) {
    const found = sessions.get(id);
    if (!found) throw new Error('Conversation not found in this VS Code bridge. Create a new session.');
    return found;
  }
  async function request(message) {
    const { id, method, args = {} } = message;
    if (typeof id !== 'string' || id.length > 128) throw new Error('Invalid request ID.');
    if (method === 'cancel') { active.get(id)?.cancel(); return null; }
    const cancellation = new vscode.CancellationTokenSource();
    active.set(id, cancellation);
    try {
      let result;
      switch (method) {
        case 'models': result = await discover(); break;
        case 'create':
          if (typeof args.sessionId !== 'string' || args.sessionId.length > 128 || sessions.has(args.sessionId)) throw new Error('Invalid or duplicate session ID.');
          if (sessions.size >= 100) throw new Error('Prototype session limit reached. Restart the bridge to clear its in-memory conversations.');
          model(args.model);
          sessions.set(args.sessionId, { model: args.model, messages: [], characters: 0, busy: false });
          result = { sessionId: args.sessionId }; break;
        case 'model': {
          const s = session(args.sessionId);
          if (s.busy) throw new Error('Wait for the current session request to finish before changing its model.');
          model(args.model); s.model = args.model; result = {}; break;
        }
        case 'dispose': {
          const s = sessions.get(args.sessionId);
          // A provider consent dialog may outlive cancellation of sendRequest.
          // Retire the local conversation immediately; a late response cannot be committed.
          s?.cancellation?.cancel();
          sessions.delete(args.sessionId); result = {}; break;
        }
        case 'send': {
          const s = session(args.sessionId);
          if (s.busy) throw new Error('This session already has an active request.');
          if (typeof args.prompt !== 'string' || !args.prompt.trim() || args.prompt.length > 100000) throw new Error('Enter a message of at most 100,000 characters.');
          if (s.characters + args.prompt.length > 400000) throw new Error('Prototype conversation limit reached. Create a new session.');
          s.busy = true;
          s.cancellation = cancellation;
          try {
            const prompt = vscode.LanguageModelChatMessage.User(args.prompt);
            const response = await model(s.model).sendRequest([...s.messages, prompt], {}, cancellation.token);
            let content = '';
            for await (const part of response.text) {
              if (cancellation.token.isCancellationRequested) throw new Error('Request cancelled.');
              content += part;
              if (content.length > 400000) throw new Error('Response exceeded the prototype text limit.');
            }
            if (cancellation.token.isCancellationRequested) throw new Error('Request cancelled.');
            if (!content.trim()) throw new Error('VS Code returned no assistant text.');
            // Commit this turn only after a complete response. No cross-session history.
            s.messages.push(prompt, vscode.LanguageModelChatMessage.Assistant(content));
            s.characters += args.prompt.length + content.length;
            result = { content };
          } finally { s.busy = false; s.cancellation = undefined; }
          break;
        }
        default: throw new Error('Unknown bridge operation.');
      }
      return { id, result };
    } catch (error) {
      return { id, error: { code: cancellation.token.isCancellationRequested ? 'cancelled' : String(error.code || 'model_error'), message: String(error.message || 'VS Code model request failed.') } };
    } finally { active.delete(id); cancellation.dispose(); }
  }
  function cancelAll() { for (const c of active.values()) c.cancel(); }
  function clear() { cancelAll(); sessions.clear(); }
  return { discover, request, cancelAll, clear };
}
module.exports = { createHost };
