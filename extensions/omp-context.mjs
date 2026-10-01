import { getCurrentSystemPrompt, getCurrentTools, getDeclaredTools, getSystemMessageText, renderSystemMessageUpdate, hasToolRedefinitions } from '@earendil-works/pi-ai';

function nativeMessage(message) {
  const result = structuredClone(message);
  if (Array.isArray(result.content)) result.content = result.content.map(block => block.type === 'thinking' && block.redacted
    ? { type: 'redactedThinking', data: block.thinkingSignature } : block);
  if (result.responseModel !== undefined) {
    result.upstreamModel = result.responseModel;
    delete result.responseModel;
  }
  return result;
}

export function toOmpContext(context, model) {
  const transcript = context.messages;
  const nativeSystem = model.compat.supportsMidConversationSystem && !hasToolRedefinitions(transcript);
  const tools = structuredClone(getCurrentTools(transcript));
  if (!nativeSystem) return {
    systemPrompt: [getCurrentSystemPrompt(transcript)], tools,
    messages: transcript.filter(message => message.role !== 'system').map(nativeMessage),
  };
  const initial = transcript[0]?.role === 'system' ? transcript[0] : undefined;
  const messages = [];
  for (const message of initial ? transcript.slice(1) : transcript) {
    if (message.role !== 'system') { messages.push(nativeMessage(message)); continue; }
    const toolChanges = [
      ...(message.toolsRemoved ?? []).map(tool => ({ type: 'tool_removal', name: tool.name })),
      ...(message.toolsAdded ?? []).map(tool => ({ type: 'tool_addition', name: tool.name })),
    ];
    messages.push({ role: 'developer', content: renderSystemMessageUpdate(message), timestamp: message.timestamp,
      providerPayload: { type: 'anthropicMessage', ...(model.compat.supportsMidConversationToolChanges ? { toolChanges } : {}) } });
  }
  const activeNames = new Set(tools.map(tool => tool.name));
  const inactiveTools = structuredClone(getDeclaredTools(transcript).filter(tool => !activeNames.has(tool.name)));
  return { systemPrompt: initial ? [getSystemMessageText(initial)] : [], tools, inactiveTools, messages };
}

function reconcile(target, source) {
  if (!source || typeof source !== 'object') return source;
  if (!target || typeof target !== 'object' || Array.isArray(target) !== Array.isArray(source)) return source;
  for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) delete target[key];
  for (const key of Object.keys(source)) {
    Object.defineProperty(target, key, { value: reconcile(Object.hasOwn(target, key) ? target[key] : undefined, source[key]), writable: true, enumerable: true, configurable: true });
  }
  if (Array.isArray(source)) target.length = source.length;
  return target;
}

export function toPiEvent(event, model, messages = new WeakMap()) {
  const result = structuredClone(event);
  for (const key of ['partial', 'message', 'error']) {
    const message = result[key];
    if (!message || typeof message !== 'object') continue;
    delete message.fallbackCreditHandle;
    if (message.model !== model.id && message.upstreamModel === undefined) message.responseModel = message.model;
    message.model = model.id;
    message.provider = model.provider;
    message.api = model.api;
    if (message.upstreamModel !== undefined) {
      message.responseModel = message.upstreamModel;
      delete message.upstreamModel;
    }
    message.content = message.content.map(block => block.type === 'redactedThinking'
      ? { type: 'thinking', thinking: '', redacted: true, thinkingSignature: block.data } : block);
    result[key] = reconcile(messages.get(event[key]), message);
    messages.set(event[key], result[key]);
  }
  if (result.type === 'toolcall_end') result.toolCall = result.partial.content[result.contentIndex];
  return result;
}

export function toOmpOptions(options = {}, method) {
  const result = { ...options };
  if (method === 'streamSimple') {
    if (result.reasoning === 'off') { delete result.reasoning; result.disableReasoning = true; }
    // Both libraries use the same minimal/low/medium/high/xhigh/max effort vocabulary.
    // Both simple APIs accept auto/none tool selection unchanged.
  } else if (result.toolChoice && typeof result.toolChoice === 'object' && result.toolChoice.type === 'tool') {
    result.toolChoice = { type: 'tool', name: result.toolChoice.name };
  }
  return result;
}
