import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import path from "node:path";
import { randomUUID } from "node:crypto";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const APIS = new Set(["openai-completions", "openai-responses", "anthropic-messages"]);

export const isProviderId = (id) => typeof id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(id);

function readProviderConfig(agentDir) {
	let text;
	try { text = readFileSync(path.join(agentDir, "models.json"), "utf8"); }
	catch (error) { if (error.code === "ENOENT") return { providers: {} }; throw error; }
	// Pi supports JSON comments. Strip them without touching strings or line breaks.
	text = text.replace(/^\uFEFF/, "").replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (part) => part.startsWith('"') ? part : part.replace(/[^\r\n]/g, " "));
	let config;
	try { config = JSON.parse(text); } catch { throw new Error("Cannot parse models.json; repair it before editing providers."); }
	if (!object(config) || (config.providers !== undefined && !object(config.providers))) throw new Error("Invalid models.json: providers must be an object.");
	config.providers ??= {};
	for (const provider of Object.values(config.providers)) {
		if (!object(provider) || (provider.models !== undefined && !Array.isArray(provider.models))) throw new Error("Invalid models.json provider configuration.");
		for (const model of provider.models || []) {
			if (!object(model) || typeof model.id !== "string" || !model.id) throw new Error("Invalid models.json model ID.");
			validateModel(model);
		}
	}
	return config;
}

export function writePrivateJson(file, value) {
	mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.learn-${randomUUID()}`;
	try {
		writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
		renameSync(temporary, file);
	} finally { rmSync(temporary, { force: true }); }
}

function validateModel(model) {
	for (const field of ["name", "api", "baseUrl"]) if (model[field] !== undefined && (typeof model[field] !== "string" || !model[field].trim())) throw new Error("Invalid model " + field + ".");
	if (model.reasoning !== undefined && typeof model.reasoning !== "boolean") throw new Error("Model reasoning must be boolean.");
	if (model.input !== undefined && (!Array.isArray(model.input) || model.input.some((v) => !["text", "image"].includes(v)))) throw new Error("Model input must contain text or image.");
	for (const field of ["contextWindow", "maxTokens"]) if (model[field] !== undefined && (typeof model[field] !== "number" || !Number.isFinite(model[field]))) throw new Error("Invalid model " + field + ".");
	if (model.cost !== undefined) {
		if (!object(model.cost)) throw new Error("Model cost must be an object.");
		for (const cost of [model.cost, ...(model.cost.tiers || [])]) for (const field of ["input", "output", "cacheRead", "cacheWrite"]) if (typeof cost[field] !== "number" || !Number.isFinite(cost[field])) throw new Error("Model cost requires numeric input, output, cacheRead and cacheWrite.");
	}
	for (const field of ["compat", "inputLimits", "promptCache", "thinkingLevelMap", "samplingParams"]) if (model[field] !== undefined && !object(model[field])) throw new Error("Model " + field + " must be an object.");
	for (const value of Object.values(model.promptCache || {})) if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error("Prompt cache lifetimes must be positive numbers.");
	for (const value of Object.values(model.thinkingLevelMap || {})) if (value !== null && typeof value !== "string") throw new Error("Thinking level mappings must be strings or null.");
	const limits = model.inputLimits;
	if (limits) {
		if (limits.images !== undefined && !object(limits.images)) throw new Error("Image limits must be an object.");
		if (limits.images?.resize !== undefined && !object(limits.images.resize)) throw new Error("Image resize must be an object.");
		for (const section of [limits, limits.images || {}, limits.images?.resize || {}]) for (const [field, value] of Object.entries(section)) {
			if (["maxRequestBytes", "maxPerMessage", "maxPerRequest", "maxWidth", "maxHeight", "maxBytes", "jpegQuality"].includes(field) && (!Number.isInteger(value) || value < 1 || (field === "jpegQuality" && value > 100))) throw new Error("Invalid input limit " + field + ".");
		}
	}
}

function endpoint(value) {
	let url;
	try { url = new URL(value); } catch { throw new Error("Provider baseUrl must be an HTTP(S) URL."); }
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Provider baseUrl must be HTTP(S), without embedded credentials.");
}

function safeMetadata(value) {
	if (Array.isArray(value)) return value.map(safeMetadata);
	if (!object(value)) return value;
	return Object.fromEntries(Object.entries(value).filter(([key]) => !["apiKey", "headers", "oauth"].includes(key)).map(([key, child]) => [key, safeMetadata(child)]));
}

function listCustomProviders(config, reserved = new Set()) {
	return Object.entries(config.providers).filter(([id, provider]) => !reserved.has(id) && object(provider) && Array.isArray(provider.models) && provider.models.length).map(([id, provider]) => ({ id, name: provider.name || id, custom: true, configuredAuth: !!((provider.apiKey && provider.apiKey !== "N/A") || provider.headers || provider.models.some((model) => model.headers)), config: safeMetadata(provider) }));
}

function readAuthFile(file) {
	let text;
	try { text = readFileSync(file, "utf8"); }
	catch (error) { if (error.code === "ENOENT") return {}; throw error; }
	let auth;
	try { auth = JSON.parse(text); } catch { throw new Error("Cannot parse auth.json; repair it before editing credentials."); }
	if (!object(auth)) throw new Error("Invalid auth.json.");
	return auth;
}

// An API key as pi stores it; a blank key means none.
const keyCredential = (key) => (key.trim() ? { type: "api_key", key: key.trim() } : null);

function put(auth, id, credential) {
	if (credential) auth[id] = credential;
	else delete auth[id];
}

// pi's credentials (auth.json) and custom providers (models.json), both in its agent folder.
export function createProviderStore({ agentDir, reserved = [] }) {
	const modelsFile = path.join(agentDir, "models.json");
	const authFile = path.join(agentDir, "auth.json");
	const read = () => readProviderConfig(agentDir);
	const readAuth = () => readAuthFile(authFile);
	const writeAuth = (auth) => writePrivateJson(authFile, auth);
	const reservedIds = () => new Set([...reserved, ...getBuiltinProviders()]);
	const list = () => listCustomProviders(read(), reservedIds());
	function save({ id, config, key }) {
		if (!isProviderId(id)) throw new Error("Invalid provider ID.");
		if (!object(config) || !Array.isArray(config.models) || !config.models.length) throw new Error("Add at least one model.");
		if (typeof config.baseUrl !== "string") throw new Error("Provider baseUrl must be an HTTP(S) URL.");
		if (config.name !== undefined && (typeof config.name !== "string" || !config.name.trim())) throw new Error("Provider name must be a non-empty string.");
		if (config.compat !== undefined && !object(config.compat)) throw new Error("Provider compat must be an object.");
		if (key !== undefined && typeof key !== "string") throw new Error("API key must be a string.");
		const current = read();
		const auth = readAuth();
		const blocked = reservedIds();
		const custom = listCustomProviders(current, blocked).some((provider) => provider.id === id);
		if (blocked.has(id) || (!custom && own(auth, id))) throw new Error("Provider ID already belongs to an existing provider.");
		endpoint(config.baseUrl);
		if (!APIS.has(config.api)) throw new Error("Unsupported provider API.");
		const ids = new Set();
		for (const model of config.models) {
			if (!object(model) || typeof model.id !== "string" || !model.id.trim() || ids.has(model.id)) throw new Error("Model IDs must be non-empty and unique.");
			validateModel(model);
			ids.add(model.id);
			if (model.baseUrl !== undefined) endpoint(model.baseUrl);
			if (model.api !== undefined && !APIS.has(model.api)) throw new Error("Unsupported model API.");
		}
		const previous = current.providers[id];
		const next = { ...previous, ...safeMetadata(config), models: config.models.map((model) => ({
			...previous?.models?.find((entry) => entry.id === model.id), ...safeMetadata(model),
		})) };
		if (key !== undefined) {
			delete next.apiKey;
			put(auth, id, keyCredential(key));
		}
		if (!auth[id] && !next.apiKey && !next.headers) { next.apiKey = "N/A"; next.authHeader = false; }
		else if (auth[id]) { next.authHeader = true; }
		writePrivateJson(modelsFile, { ...current, providers: { ...current.providers, [id]: next } });
		if (key !== undefined) writeAuth(auth);
	}
	function remove(id) {
		const current = read();
		if (!list().some((provider) => provider.id === id)) throw new Error("Unknown custom provider.");
		delete current.providers[id];
		const auth = readAuth();
		delete auth[id];
		writePrivateJson(modelsFile, current);
		writeAuth(auth);
	}
	// Save, or with null remove, one provider's credential.
	function setCredential(id, credential) {
		const auth = readAuth();
		put(auth, id, credential);
		writeAuth(auth);
	}
	// Save an API key; a blank key removes it. A custom provider's models.json
	// entry records whether it has one, so its key goes through save.
	function setKey(id, key) {
		const custom = list().find((provider) => provider.id === id);
		if (custom) save({ id, config: custom.config, key });
		else setCredential(id, keyCredential(key));
	}
	return { read, readAuth, list, save, remove, setCredential, setKey };
}