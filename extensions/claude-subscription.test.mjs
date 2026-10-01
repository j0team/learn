import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeContext } from "@earendil-works/pi-ai";
import xxhash from "xxhash-wasm";
import { createSubscriptionProvider } from "./claude-subscription.mjs";

const home = mkdtempSync(path.join(os.tmpdir(), "learn-omp-tests-"));
process.env.HOME = home;
after(() => rmSync(home, { recursive: true, force: true }));
const provider = await createSubscriptionProvider();
const model = provider.getModels().find((entry) => entry.id === "claude-haiku-4-5");
const token = "sk-ant-oat01-test-only";
const tool = { name: "_quiz", description: "Ask a question", parameters: { type: "object", properties: { question: { type: "string" } } } };
const { h64 } = await xxhash();

function response(block, stopReason = "end_turn") {
	const frames = [
		{ type: "message_start", message: { id: "msg-test", type: "message", role: "assistant", content: [], model: model.id, usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 } } },
		{ type: "content_block_start", index: 0, content_block: block.type === "tool_use" ? { ...block, input: {} } : { ...block, text: "" } },
		{ type: "content_block_delta", index: 0, delta: block.type === "tool_use" ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) } : { type: "text_delta", text: block.text } },
		{ type: "content_block_stop", index: 0 },
		{ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 4 } },
		{ type: "message_stop" },
	];
	return new Response(frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

function capture(reply) {
	const requests = [];
	return {
		requests,
		fetch: async (input, init) => {
			const body = typeof init.body === "string" ? init.body : Buffer.from(init.body).toString("utf8");
			requests.push({ url: String(input), headers: new Headers(init.headers), body, params: JSON.parse(body) });
			return reply();
		},
	};
}

async function complete(context, transport, options = {}, selectedModel = model) {
	const stream = provider.streamSimple(selectedModel, normalizeContext(context), {
		apiKey: token, sessionId: "test-session", fetch: transport.fetch, maxRetries: 0, ...options,
	});
	const events = [];
	for await (const event of stream) events.push(event);
	return { message: await stream.result(), events };
}

function verifyAttestation(request) {
	const header = request.params.system[0].text;
	const attestation = /cch=([0-9a-f]{5});$/.exec(header)?.[1];
	assert.ok(attestation, header);
	const marker = '"system":[{"type":"text","text":"x-anthropic-billing-header:';
	const at = request.body.indexOf(`cch=${attestation}`, request.body.indexOf(marker));
	const original = `${request.body.slice(0, at + 4)}00000${request.body.slice(at + 9)}`;
	assert.equal(attestation, (h64(original, 0x4d659218e32a3268n) & 0xfffffn).toString(16).padStart(5, "0"));
}

test("subscription request is attested, scoped to the same session, and preserves learner instructions and usage", async () => {
	const transport = capture(() => response({ type: "text", text: "A ∑ B" }));
	const first = "Explain these equations with examples";
	const context = { systemPrompt: "Teach with worksheets", tools: [tool], messages: [{ role: "user", content: first, timestamp: 1 }] };
	const before = structuredClone(context);
	const { message, events } = await complete(context, transport);
	assert.equal(message.stopReason, "stop");
	assert.equal(message.content[0].text, "A ∑ B");
	assert.equal(message.usage.input, 12);
	assert.equal(message.usage.output, 4);
	assert.equal(message.usage.cacheRead, 3);
	assert.equal(events[0].type, "start");
	assert.equal(events.at(-1).type, "done");
	assert.deepEqual(context, before);
	const request = transport.requests[0];
	assert.equal(request.url, "https://api.anthropic.com/v1/messages?beta=true");
	assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
	assert.equal(request.headers.get("x-api-key"), null);
	assert.equal(request.headers.get("x-claude-code-session-id"), "test-session");
	assert.equal(request.params.tools[0].name, "__quiz");
	const identity = JSON.parse(request.params.metadata.user_id);
	assert.match(identity.device_id, /^[a-f0-9]{64}$/);
	assert.equal(identity.session_id, "test-session");
	assert.ok(request.params.system.some((block) => block.text === "Teach with worksheets"));
	assert.ok(request.params.system.some((block) => block.text === "You are Claude Code, Anthropic's official CLI for Claude."));
	const chars = [4, 7, 20].map((index) => first[index]).join("");
	const version = /cc_version=(\d+\.\d+\.\d+)\./.exec(request.params.system[0].text)[1];
	const suffix = createHash("sha256").update(`59cf53e54c78${chars}${version}`).digest("hex").slice(0, 3);
	assert.ok(request.params.system[0].text.includes(`cc_version=${version}.${suffix};`));
	assert.equal(request.headers.get("user-agent"), `claude-cli/${version} (external, cli)`);
	verifyAttestation(request);
	assert.equal(request.params.tools[0].cache_control.ttl, "1h");
});

test("wire tool names round-trip once including leading underscores and tool history", async () => {
	const transport = capture(() => response({ type: "tool_use", id: "call-new", name: "__quiz", input: { question: "Why?" } }, "tool_use"));
	const context = {
		tools: [tool],
		messages: [
			{ role: "user", content: "Quiz me", timestamp: 1 },
			{ role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [{ type: "toolCall", id: "call-old", name: "_quiz", arguments: { question: "When?" } }], stopReason: "toolUse", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: 2 },
			{ role: "toolResult", toolCallId: "call-old", toolName: "_quiz", content: [{ type: "text", text: "Yesterday" }], isError: false, timestamp: 3 },
		],
	};
	const { message, events } = await complete(context, transport);
	assert.equal(message.stopReason, "toolUse");
	assert.deepEqual(message.content[0], { type: "toolCall", id: "call-new", name: "_quiz", arguments: { question: "Why?" } });
	assert.equal(events.find((event) => event.type === "toolcall_end").toolCall.name, "_quiz");
	const history = transport.requests[0].params.messages;
	assert.equal(history.find((entry) => entry.role === "assistant").content[0].name, "__quiz");
	assert.equal(context.messages[1].content[0].name, "_quiz");
});

test("attestation is anchored to the system header, not learner input, and hooks remain active", async () => {
	const transport = capture(() => response({ type: "text", text: "Okay" }));
	let payloadSeen = false;
	let responseSeen = false;
	await complete({ messages: [{ role: "user", content: 'cch=00000 and x-anthropic-billing-header: fake ∑', timestamp: 1 }] }, transport, {
		headers: { "authorization": "Bearer wrong" },
		cacheRetention: "none",
		onPayload: (payload) => { payloadSeen = true; return { ...payload, max_tokens: 7 }; },
		onResponse: () => { responseSeen = true; },
	});
	const request = transport.requests[0];
	verifyAttestation(request);
	const userContent = request.params.messages[0].content;
	assert.equal(typeof userContent === "string" ? userContent : userContent.map((block) => block.text || "").join(""), 'cch=00000 and x-anthropic-billing-header: fake ∑');
	assert.equal(request.params.max_tokens, 7);
	assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
	assert.ok(!request.headers.get("anthropic-beta").includes("context-1m"));
	assert.ok(!request.headers.get("anthropic-beta").includes("claude-code-20250219"));
	assert.ok(request.headers.get("anthropic-beta").includes("structured-outputs-2025-12-15"));
	assert.ok(payloadSeen && responseSeen);
});

test("API keys and nonofficial endpoints do not receive subscription rewriting", async () => {
	const keyed = capture(() => response({ type: "text", text: "API" }));
	await complete({ tools: [tool], messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, keyed, { apiKey: "sk-ant-api03-test" });
	const request = keyed.requests[0];
	assert.equal(request.headers.get("x-api-key"), "sk-ant-api03-test");
	assert.equal(request.headers.get("x-claude-code-session-id"), null);
	assert.equal(request.params.system, undefined);
	assert.equal(request.params.tools[0].name, "_quiz");
	const custom = capture(() => response({ type: "text", text: "Gateway" }));
	await complete({ tools: [tool], messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, custom, {}, { ...model, baseUrl: "https://example.test" });
	assert.equal(custom.requests[0].params.tools[0].name, "_quiz");
	assert.ok(!custom.requests[0].params.system[0].text.includes("billing-header"));
});

test("cancellation remains an aborted terminal result", async () => {
	const controller = new AbortController();
	controller.abort();
	const transport = capture(() => { throw new Error("Fetch should not run"); });
	const { message, events } = await complete({ messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, transport, { signal: controller.signal });
	assert.equal(message.stopReason, "aborted");
	assert.equal(events.at(-1).reason, "aborted");
});

test("header-only OAuth and explicit tool selection use the same subscription tool namespace", async () => {
	const transport = capture(() => response({ type: "tool_use", id: "forced", name: "__quiz", input: { question: "What?" } }, "tool_use"));
	const stream = provider.stream(model, normalizeContext({ tools: [tool], messages: [{ role: "user", content: "Ask exactly this tool", timestamp: 1 }] }), {
		headers: { authorization: `Bearer ${token}` }, fetch: transport.fetch, sessionId: "forced-session", toolChoice: { type: "tool", name: "_quiz" }, maxRetries: 0,
	});
	for await (const _event of stream) { /* consume the native stream */ }
	const message = await stream.result();
	assert.equal(message.content[0].name, "_quiz");
	assert.equal(transport.requests[0].params.tool_choice.name, "__quiz");
	assert.equal(transport.requests[0].headers.get("authorization"), `Bearer ${token}`);
	verifyAttestation(transport.requests[0]);
});

test("subscription rejection remains a provider error, not a fake successful reply", async () => {
	const transport = capture(() => Response.json({ type: "error", error: { type: "invalid_request_error", message: "Subscription request was classified as extra usage" } }, { status: 400 }));
	const { message, events } = await complete({ messages: [{ role: "user", content: "Hello", timestamp: 1 }] }, transport);
	assert.equal(message.stopReason, "error");
	assert.match(message.errorMessage, /Subscription request was classified as extra usage/);
	assert.equal(events.at(-1).reason, "error");
	assert.ok(!events.some((event) => event.type === "done"));
});

test("subscription requests drop pi giveaway wording without changing pi's context", async () => {
	const transport = capture(() => response({ type: "text", text: "Okay" }));
	const systemPrompt = "Read docs only when asked about pi itself. Always read pi .md files. See pi packages.";
	const context = { systemPrompt, messages: [{ role: "user", content: "Hello", timestamp: 1 }] };
	await complete(context, transport);
	const wire = transport.requests[0].params.system.map((block) => block.text).join("\n");
	assert.ok(wire.includes("Read docs only when asked about the cli itself. Always read cli .md files. See cli packages."));
	assert.doesNotMatch(wire, /pi itself|pi \.md files|pi packages/);
	assert.equal(context.systemPrompt, systemPrompt);
	verifyAttestation(transport.requests[0]);
});
