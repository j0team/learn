import { lazyStream } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { toOmpContext, toOmpOptions, toPiEvent } from "./omp-context.mjs";

// Anthropic bills OAuth requests whose system prompt reads like pi's own docs to
// extra usage. Same rewrite as pi-claude-subscription-connector's subscription guard.
function neutralizePiWording(text) {
	return text.replaceAll("pi itself", "the cli itself").replaceAll("pi .md files", "cli .md files").replaceAll("pi packages", "cli packages");
}

function subscriptionContext(context, model) {
	const native = toOmpContext(context, model);
	native.systemPrompt = native.systemPrompt.map(neutralizePiWording);
	for (const message of native.messages) {
		if (message.role === "developer" && typeof message.content === "string") message.content = neutralizePiWording(message.content);
	}
	return native;
}

async function* subscriptionStream(method, model, context, options) {
	if (!globalThis.Bun) throw new Error("Claude subscription routing requires pi running under Bun.");
	const { streamAnthropic } = await import("@oh-my-pi/pi-ai/providers/anthropic");
	const { streamSimple } = await import("@oh-my-pi/pi-ai");
	const { getBundledModel } = await import("@oh-my-pi/pi-catalog/models");
	const { buildModel } = await import("@oh-my-pi/pi-catalog/build");
	const metadata = Object.fromEntries(["id", "name", "baseUrl", "contextWindow", "maxTokens", "cost", "input", "headers"].filter((key) => model[key] !== undefined).map((key) => [key, model[key]]));
	const bundled = getBundledModel("anthropic", model.id);
	const nativeModel = bundled ? { ...bundled, ...metadata } : buildModel({ ...metadata, api: model.api, provider: model.provider, reasoning: model.reasoning });
	// pi installs undici as globalThis.fetch; omp's TLS profile needs Bun's native fetch.
	const nativeOptions = { fetch: (input, init) => Bun.fetch(input, init), ...toOmpOptions(options, method) };
	for (const hook of ["onPayload", "onResponse"]) {
		if (options[hook]) nativeOptions[hook] = (value) => options[hook](value, model, options.signal);
	}
	const messages = new WeakMap();
	const stream = (method === "streamSimple" ? streamSimple : streamAnthropic)(nativeModel, subscriptionContext(context, nativeModel), nativeOptions);
	for await (const event of stream) {
		const converted = toPiEvent(event, model, messages);
		if (converted.error?.errorMessage) converted.error.errorMessage = converted.error.errorMessage.split(options.apiKey).join("[redacted]");
		yield converted;
	}
}

export async function createSubscriptionProvider() {
	const native = anthropicProvider();
	function wrap(method, model, context, options = {}) {
		const bearer = new Headers(options.headers || {}).get("authorization")?.replace(/^Bearer\s+/i, "");
		const token = options.apiKey || bearer;
		const url = new URL(model.baseUrl || native.baseUrl);
		if (!token?.startsWith("sk-ant-oat") || url.origin !== "https://api.anthropic.com") return native[method](model, context, options);
		return lazyStream(model, async () => subscriptionStream(method, model, context, { ...options, apiKey: token }));
	}
	return {
		...native,
		stream: (model, context, options) => wrap("stream", model, context, options),
		streamSimple: (model, context, options) => wrap("streamSimple", model, context, options),
	};
}

export default async function claudeSubscription(pi) {
	pi.registerProvider(await createSubscriptionProvider());
}
