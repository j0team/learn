import test from 'node:test';
import assert from 'node:assert/strict';
import { toOmpContext, toPiEvent, toOmpOptions } from './omp-context.mjs';

const tool = (name, description = name) => ({ name, description, parameters: { type: 'object', properties: {} } });
const model = { id: 'requested', provider: 'anthropic', api: 'anthropic-messages', compat: {} };

test('folds section replacement/removal, appended instructions, and tool transitions', () => {
  const context = { messages: [
    { role: 'system', content: 'base', sections: { rules: 'old', remove: 'gone' }, toolsAdded: [tool('read')], timestamp: 1 },
    { role: 'user', content: 'hello', timestamp: 2 },
    { role: 'system', content: 'extra', sections: { rules: 'new', remove: null }, toolsRemoved: [{ name: 'read' }], toolsAdded: [tool('write')], timestamp: 3 },
  ] };
  const before = structuredClone(context);
  const result = toOmpContext(context, model);
  assert.deepEqual(result.systemPrompt, ['base\n\nextra\n\nnew']);
  assert.deepEqual(result.tools, [tool('write')]);
  assert.deepEqual(result.messages, [context.messages[1]]);
  result.tools[0].description = 'mutated';
  assert.deepEqual(context, before);
});

test('native midconversation instructions retain section deletion and tool removals', () => {
  const context = { messages: [
    { role: 'system', content: 'base', toolsAdded: [tool('read')], timestamp: 1 },
    { role: 'user', content: 'hello', timestamp: 2 },
    { role: 'system', content: 'later', sections: { rule: null }, toolsRemoved: [{ name: 'read' }], timestamp: 3 },
  ] };
  const result = toOmpContext(context, { ...model, compat: { supportsMidConversationSystem: true, supportsMidConversationToolChanges: true } });
  assert.equal(result.messages[1].role, 'developer');
  assert.equal(result.messages[1].content, 'later\n\nRemoved system prompt section "rule".');
  assert.deepEqual(result.messages[1].providerPayload.toolChanges, [{ type: 'tool_removal', name: 'read' }]);
  assert.deepEqual(result.tools, []);
});

test('tool redefinition folds to the active definition rather than replaying stale schema', () => {
  const result = toOmpContext({ messages: [
    { role: 'system', content: 'base', toolsAdded: [tool('read', 'old')], timestamp: 1 },
    { role: 'user', content: 'hello', timestamp: 2 },
    { role: 'system', content: 'later', toolsAdded: [tool('read', 'new')], timestamp: 3 },
  ] }, { ...model, compat: { supportsMidConversationSystem: true, supportsMidConversationToolChanges: true } });
  assert.deepEqual(result.tools, [tool('read', 'new')]);
  assert.deepEqual(result.systemPrompt, ['base\n\nlater']);
});

test('history retains signatures, opaque native state, image data, and tool errors immutably', () => {
  const messages = [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'signed', thinkingSignature: 'sig' }, { type: 'thinking', thinking: '', redacted: true, thinkingSignature: 'opaque' }, { type: 'toolCall', id: 'call', name: 'read', arguments: {} }], providerPayload: { type: 'anthropicCompaction', content: 'summary', signature: 'secret-state', provider: 'anthropic' }, requestControls: { messageIndex: 0 }, responseModel: 'upstream', timestamp: 1 },
    { role: 'toolResult', toolCallId: 'call', toolName: 'read', content: [{ type: 'text', text: 'failed' }], isError: true, timestamp: 2 },
    { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AA==' }], timestamp: 3 },
  ];
  const before = structuredClone(messages);
  const converted = toOmpContext({ messages }, model).messages;
  assert.deepEqual(converted[0].content[0], messages[0].content[0]);
  assert.deepEqual(converted[0].content[1], { type: 'redactedThinking', data: 'opaque' });
  assert.deepEqual(converted.slice(1), messages.slice(1));
  const restored = toPiEvent({ type: 'done', message: converted[0] }, model).message;
  assert.deepEqual(restored, { ...messages[0], model: model.id, provider: model.provider, api: model.api });
  converted[2].content[0].data = 'changed';
  assert.deepEqual(messages, before);
});

test('simple reasoning off is disabled explicitly without changing tool choice', () => {
  assert.deepEqual(toOmpOptions({ reasoning: 'off', toolChoice: 'none' }, 'streamSimple'), { disableReasoning: true, toolChoice: 'none' });
  assert.deepEqual(toOmpOptions({ reasoning: 'xhigh', toolChoice: 'auto' }, 'streamSimple'), { reasoning: 'xhigh', toolChoice: 'auto' });
});

test('public event strips private credit credentials without mutating native retry state', () => {
  const message = { model: 'served', content: [], fallbackCreditHandle: { token: 'private-token', authorization: 'private-key', params: {} }, providerPayload: { type: 'anthropicCompaction', signature: 'opaque', content: 'summary' }, requestControls: { messageIndex: 1 } };
  for (const key of ['partial', 'message', 'error']) {
    const event = toPiEvent({ [key]: message }, model);
    assert.equal('fallbackCreditHandle' in event[key], false);
    assert.equal(event[key].responseModel, 'served');
    assert.deepEqual(event[key].providerPayload, message.providerPayload);
    assert.deepEqual(event[key].requestControls, message.requestControls);
  }
  assert.equal(message.fallbackCreditHandle.token, 'private-token');
});
