import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProviderStore, isProviderId, writePrivateJson } from "./providers.mjs";

function fixture(t) {
	const agentDir = mkdtempSync(path.join(os.tmpdir(), "learn-providers-"));
	t.after(() => rmSync(agentDir, { recursive: true, force: true }));
	const authFile = path.join(agentDir, "auth.json");
	writePrivateJson(authFile, { existing: { type: "api_key", key: "test-existing" } });
	const readAuth = () => JSON.parse(readFileSync(authFile, "utf8"));
	const store = createProviderStore({ agentDir });
	const config = { baseUrl: "http://127.0.0.1:12345/v1", api: "openai-completions", models: [{ id: "local", name: "Local", reasoning: false, input: ["text"], contextWindow: 8192, maxTokens: 2048 }] };
	return { agentDir, authFile, readAuth, store, config };
}

test("save, edit and remove preserve other configuration and credential boundaries", (t) => {
	const { agentDir, authFile, readAuth, store, config } = fixture(t);
	const other = { baseUrl: "https://other.invalid", apiKey: "private-test", modelOverrides: { model: { reasoning: true } } };
	writePrivateJson(path.join(agentDir, "models.json"), { extra: { retained: true }, providers: { other } });
	store.save({ id: "local-test", config, key: "test-secret" });
	store.save({ id: "local-test", config: { ...config, name: "Renamed", models: [{ id: "new" }] } });
	assert.equal(readAuth()["local-test"].key, "test-secret");
	assert.deepEqual(store.read().providers.other, other);
	assert.deepEqual(store.read().extra, { retained: true });
	assert.equal((store.list())[0].config.apiKey, undefined);
	assert.equal((store.list())[0].name, "Renamed");
	store.save({ id: "local-test", config, key: "" });
	assert.equal(readAuth()["local-test"], undefined);
	assert.equal(store.read().providers["local-test"].apiKey, "N/A");
	assert.equal(store.read().providers["local-test"].authHeader, false);
	assert.equal(statSync(path.join(agentDir, "models.json")).mode & 0o777, 0o600);
	assert.equal(statSync(authFile).mode & 0o777, 0o600);
	store.remove("local-test");
	assert.deepEqual(store.read(), { extra: { retained: true }, providers: { other } });
	assert.equal(readAuth().existing.key, "test-existing");
});

test("invalid config and collisions never mutate files", (t) => {
	const { agentDir, authFile, store, config } = fixture(t);
	assert.throws(() => store.save({ id: "anthropic", config }), /existing provider/);
	assert.throws(() => store.save({ id: "existing", config }), /existing provider/);
	assert.throws(() => store.save({ id: "local-test", config: { ...config, baseUrl: "file:///tmp/a" } }), /HTTP/);
	assert.throws(() => store.save({ id: "local-test", config: { ...config, models: [{ id: "a" }, { id: "a" }] } }), /unique/);
	assert.throws(() => store.save({ id: "local-test", config: { ...config, models: [{ id: "a", reasoning: "yes" }] } }), /boolean/);
	assert.throws(() => store.remove("existing"), /Unknown custom/);
	assert.deepEqual(JSON.parse(readFileSync(authFile)), { existing: { type: "api_key", key: "test-existing" } });
	const modelsFile = path.join(agentDir, "models.json");
	writeFileSync(modelsFile, "{broken");
	assert.throws(() => store.save({ id: "local-test", config, key: "test-only" }), /Cannot parse/);
	assert.equal(readFileSync(modelsFile, "utf8"), "{broken");
});

test("native JSON comments and credential headers never reach provider metadata", (t) => {
	const { agentDir, store } = fixture(t);
	writeFileSync(path.join(agentDir, "models.json"), '\uFEFF{ // comment\n "providers": {"custom": {"baseUrl":"https://example.invalid/v1", "api":"openai-responses", "apiKey":"test-private", "headers":{"Authorization":"test-private"}, "models":[{"id":"a","headers":{"x-token":"test-private"}}]}}}');
	const [provider] = store.list();
	assert.equal(provider.custom, true);
	assert.equal(provider.config.baseUrl, "https://example.invalid/v1");
	assert.equal(provider.config.apiKey, undefined);
	assert.equal(provider.config.headers, undefined);
	assert.equal(provider.config.models[0].headers, undefined);
});

test("editing imported custom providers retains redacted authentication and per-model headers", (t) => {
	const { agentDir, store } = fixture(t);
	const original = { baseUrl: "https://example.invalid/v1", api: "openai-responses", apiKey: "$CUSTOM_KEY", headers: { "x-organization": "private-org" }, models: [{ id: "a", headers: { "x-token": "$TOKEN" }, compat: { supportsDeveloperRole: false } }] };
	writePrivateJson(path.join(agentDir, "models.json"), { providers: { custom: original } });
	const [listed] = store.list();
	store.save({ id: "custom", config: { ...listed.config, baseUrl: "https://changed.invalid/v1" } });
	assert.deepEqual(store.read().providers.custom, { ...original, baseUrl: "https://changed.invalid/v1" });
	writePrivateJson(path.join(agentDir, "models.json"), { extra: { retained: true } });
	store.save({ id: "fresh", config: { baseUrl: "http://localhost:1234/v1", api: "openai-completions", models: [{ id: "b" }] } });
	assert.deepEqual(store.read().extra, { retained: true });
});

test("setKey stores, trims and removes a built-in provider's key", (t) => {
	const { readAuth, store } = fixture(t);
	store.setKey("openai", "  test-key  ");
	assert.deepEqual(readAuth().openai, { type: "api_key", key: "test-key" });
	store.setKey("openai", "   ");
	assert.equal(readAuth().openai, undefined);
	assert.equal(readAuth().existing.key, "test-existing");
});

test("setKey on a custom provider keeps its models.json auth flags in step", (t) => {
	const { agentDir, readAuth, store, config } = fixture(t);
	store.save({ id: "local-test", config });
	assert.equal(store.read().providers["local-test"].authHeader, false);
	store.setKey("local-test", "test-secret");
	assert.equal(readAuth()["local-test"].key, "test-secret");
	assert.equal(store.read().providers["local-test"].authHeader, true);
	assert.equal(store.read().providers["local-test"].apiKey, undefined);
	store.setKey("local-test", "");
	assert.equal(readAuth()["local-test"], undefined);
	assert.equal(store.read().providers["local-test"].apiKey, "N/A");
	assert.equal(JSON.parse(readFileSync(path.join(agentDir, "models.json"))).providers["local-test"].models[0].id, "local");
});

test("setCredential saves and removes a sign-in without touching other entries", (t) => {
	const { readAuth, store } = fixture(t);
	const login = { type: "oauth", access: "test-access", refresh: "test-refresh", expires: 1 };
	store.setCredential("anthropic", login);
	assert.deepEqual(store.readAuth().anthropic, login);
	store.setCredential("anthropic", null);
	assert.deepEqual(readAuth(), { existing: { type: "api_key", key: "test-existing" } });
});

test("readAuth treats a missing auth.json as empty and refuses a broken one", (t) => {
	const { authFile, store } = fixture(t);
	rmSync(authFile);
	assert.deepEqual(store.readAuth(), {});
	writeFileSync(authFile, "{broken");
	assert.throws(() => store.readAuth(), /Cannot parse auth.json/);
	assert.throws(() => store.setKey("openai", "test-key"), /Cannot parse auth.json/);
	assert.equal(readFileSync(authFile, "utf8"), "{broken");
	writeFileSync(authFile, "[]");
	assert.throws(() => store.readAuth(), /Invalid auth.json/);
});

test("isProviderId accepts lowercase ids and rejects everything else", () => {
	for (const id of ["openai", "local-test", "a1"]) assert.equal(isProviderId(id), true);
	for (const id of ["", "-x", "Upper", "a b", "a/b", null, undefined, 3]) assert.equal(isProviderId(id), false);
});
