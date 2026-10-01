import { randomUUID } from "node:crypto";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

export const subscriptionProviders = [anthropicProvider(), openaiCodexProvider()];
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const eventFields = {
	auth_url: ["url", "instructions"],
	info: ["message"],
	progress: ["message"],
	device_code: ["userCode", "verificationUri", "intervalSeconds", "expiresInSeconds"],
};

function error(message, status) {
	return Object.assign(new Error(message), { status });
}

function abortError() {
	return new DOMException("Login cancelled", "AbortError");
}

function pick(source, fields) {
	return Object.fromEntries(fields.filter((key) => typeof source[key] === "string" || typeof source[key] === "number").map((key) => [key, source[key]]));
}

function publicEvent(event) {
	const fields = eventFields[event.type];
	if (!fields) return undefined;
	const result = { type: event.type, ...pick(event, fields) };
	if (event.type === "info" && Array.isArray(event.links)) result.links = event.links.map((link) => pick(link, ["url", "label"]));
	return result;
}

function publicPrompt(prompt) {
	if (!["select", "text", "secret", "manual_code"].includes(prompt.type)) throw error("Unsupported login prompt", 400);
	const result = { id: randomUUID(), type: prompt.type, ...pick(prompt, ["message", "placeholder"]) };
	if (prompt.type === "select") result.options = prompt.options.map((option) => pick(option, ["id", "label", "description"]));
	return result;
}

export function createSubscriptionLogin({ providers = subscriptionProviders } = {}) {
	// One login at a time; a finished one stays readable until the next starts.
	let current;
	const get = (id) => {
		if (current?.state.id !== id) throw error("Unknown subscription login", 404);
		return current;
	};
	const busy = () => current && ["waiting", "ready"].includes(current.state.status);
	const snapshot = (flow) => structuredClone(flow.state);

	function finish(flow, status, message) {
		if (flow.state.status !== "waiting" && status !== "cancelled") return;
		clearTimeout(flow.timeout);
		flow.pending?.reject(abortError());
		delete flow.state.prompt;
		delete flow.state.event;
		flow.state.status = status;
		if (message) flow.state.error = message;
		if (status !== "ready") delete flow.credential;
	}

	function prompt(flow, nativePrompt) {
		if (flow.state.status !== "waiting" || nativePrompt.signal?.aborted) return Promise.reject(abortError());
		flow.pending?.reject(abortError());
		const visible = publicPrompt(nativePrompt);
		return new Promise((resolve, reject) => {
			const cleanup = () => {
				nativePrompt.signal?.removeEventListener("abort", onAbort);
				if (flow.pending === pending) {
					flow.pending = undefined;
					delete flow.state.prompt;
				}
			};
			const pending = {
				resolve(value) { cleanup(); resolve(value); },
				reject(reason) { cleanup(); reject(reason); },
			};
			const onAbort = () => pending.reject(abortError());
			flow.pending = pending;
			flow.state.prompt = visible;
			nativePrompt.signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	return {
		start(providerId) {
			const provider = providers.find((entry) => entry.id === providerId);
			if (!provider?.auth?.oauth?.login) throw error("Unknown subscription provider", 400);
			if (busy()) throw error("A subscription login is already active", 409);
			const flow = { state: { id: randomUUID(), provider: provider.id, status: "waiting" }, controller: new AbortController() };
			current = flow;
			flow.timeout = setTimeout(() => {
				finish(flow, "error", "Subscription login timed out");
				flow.controller.abort();
			}, LOGIN_TIMEOUT_MS);
			flow.timeout.unref();
			Promise.resolve().then(() => {
				if (flow.state.status !== "waiting") throw abortError();
				return provider.auth.oauth.login({
					signal: flow.controller.signal,
					prompt: (request) => prompt(flow, request),
					notify: (event) => {
						if (flow.state.status === "waiting") flow.state.event = publicEvent(event);
					},
				});
			}).then((credential) => {
				if (flow.state.status !== "waiting") return;
				flow.credential = credential;
				finish(flow, "ready");
			}, () => finish(flow, "error", "Subscription login failed. Please try again."));
			return snapshot(flow);
		},
		status(id) { return snapshot(get(id)); },
		answer(id, { promptId, value } = {}) {
			const flow = get(id);
			const request = flow.state.prompt;
			if (flow.state.status !== "waiting" || !request || request.id !== promptId) throw error("Login prompt is no longer active", 409);
			if (typeof value !== "string" || !value.trim()) throw error("A nonblank answer is required", 400);
			if (request.type === "select" && !request.options.some((option) => option.id === value)) throw error("Choose a listed option", 400);
			flow.pending.resolve(value);
			return snapshot(flow);
		},
		cancel(id) {
			const flow = get(id);
			finish(flow, "cancelled");
			flow.controller.abort();
			return snapshot(flow);
		},
		takeCredential(id, save) {
			const flow = get(id);
			if (flow.state.status !== "ready") throw error("Subscription login is not ready", 409);
			const result = { provider: flow.state.provider, credential: flow.credential };
			if (save) save(result);
			current = undefined;
			return result;
		},
	};
}
