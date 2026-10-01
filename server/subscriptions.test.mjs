import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionLogin } from "./subscriptions.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const credential = { type: "oauth", access: "private-access", refresh: "private-refresh", expires: 123 };
function fixture(t, login) {
	const manager = createSubscriptionLogin({ providers: [{ id: "test", name: "Test subscription", auth: { oauth: { login } } }] });
	const ids = [];
	const start = manager.start;
	manager.start = (provider) => {
		const state = start(provider);
		ids.push(state.id);
		return state;
	};
	t.after(() => {
		for (const id of ids) try { manager.cancel(id); } catch {}
	});
	return manager;
}
const hasStatus = (status) => (error) => error.status === status;


test("prompts transition to private ready credentials and enforce a single active login", async (t) => {
	let received;
	const manager = fixture(t, async ({ prompt, notify }) => {
		notify({ type: "auth_url", url: "https://example.invalid/auth", credential, signal: new AbortController().signal });
		received = await prompt({ type: "secret", message: "Enter code", signal: new AbortController().signal, credential });
		return credential;
	});
	assert.throws(() => manager.start("missing"), hasStatus(400));
	const initial = manager.start("test");
	assert.equal(initial.status, "waiting");
	assert.throws(() => manager.start("test"), hasStatus(409));
	await tick();
	const state = manager.status(initial.id);
	assert.deepEqual(state.event, { type: "auth_url", url: "https://example.invalid/auth" });
	assert.deepEqual(Object.keys(state.prompt).sort(), ["id", "message", "type"]);
	assert.throws(() => manager.answer(initial.id, { promptId: "stale", value: "code" }), hasStatus(409));
	assert.throws(() => manager.answer(initial.id, { promptId: state.prompt.id, value: "  " }), hasStatus(400));
	manager.answer(initial.id, { promptId: state.prompt.id, value: "private-answer" });
	assert.throws(() => manager.answer(initial.id, { promptId: state.prompt.id, value: "again" }), hasStatus(409));
	await tick();
	assert.equal(received, "private-answer");
	assert.deepEqual(manager.status(initial.id), { id: initial.id, provider: "test", status: "ready" });
	assert.throws(() => manager.start("test"), hasStatus(409));
	assert.throws(() => manager.takeCredential(initial.id, () => { throw new Error("disk failure"); }), /disk failure/);
	assert.equal(manager.status(initial.id).status, "ready");
	let persisted;
	assert.deepEqual(manager.takeCredential(initial.id, (result) => { persisted = result; }), { provider: "test", credential });
	assert.deepEqual(persisted, { provider: "test", credential });
	assert.throws(() => manager.takeCredential(initial.id), hasStatus(404));
	assert.equal(manager.start("test").status, "waiting");
});

test("select validation preserves the pending prompt and later prompts reject stale answers", async (t) => {
	const answers = [];
	const manager = fixture(t, async ({ prompt }) => {
		answers.push(await prompt({ type: "select", message: "Choose", options: [{ id: "yes", label: "Yes", credential }] }));
		answers.push(await prompt({ type: "text", message: "Account" }));
		return credential;
	});
	const { id } = manager.start("test");
	assert.throws(() => manager.takeCredential(id), hasStatus(409));
	await tick();
	const first = manager.status(id).prompt;
	assert.deepEqual(first.options, [{ id: "yes", label: "Yes" }]);
	assert.throws(() => manager.answer(id, { promptId: first.id, value: "no" }), hasStatus(400));
	assert.equal(manager.status(id).prompt.id, first.id);
	manager.answer(id, { promptId: first.id, value: "yes" });
	await tick();
	const second = manager.status(id).prompt;
	assert.notEqual(second.id, first.id);
	assert.throws(() => manager.answer(id, { promptId: first.id, value: "wrong" }), hasStatus(409));
	manager.answer(id, { promptId: second.id, value: "account" });
	await tick();
	assert.deepEqual(answers, ["yes", "account"]);
	assert.deepEqual(manager.takeCredential(id), { provider: "test", credential });
});

test("cancellation rejects pending prompts and ignores late native success", async (t) => {
	let signal;
	let rejected;
	const manager = fixture(t, async (interaction) => {
		signal = interaction.signal;
		try { await interaction.prompt({ type: "manual_code", message: "Paste code" }); }
		catch (error) { rejected = error.name; }
		return credential;
	});
	const { id } = manager.start("test");
	await tick();
	const { prompt } = manager.status(id);
	assert.equal(manager.cancel(id).status, "cancelled");
	assert.equal(signal.aborted, true);
	assert.throws(() => manager.answer(id, { promptId: prompt.id, value: "code" }), hasStatus(409));
	await tick();
	assert.equal(rejected, "AbortError");
	assert.equal(manager.status(id).status, "cancelled");
	assert.throws(() => manager.takeCredential(id), hasStatus(409));
	assert.equal(manager.start("test").status, "waiting");
});

test("native callback wins its race by cancelling only the manual prompt", async (t) => {
	const manual = new AbortController();
	let finishCallback;
	let rejected;
	let signal;
	const callback = new Promise((resolve) => { finishCallback = resolve; });
	const manager = fixture(t, async (interaction) => {
		signal = interaction.signal;
		const entered = interaction.prompt({ type: "manual_code", message: "Paste redirect", signal: manual.signal }).catch((error) => { rejected = error.name; return null; });
		await callback;
		manual.abort();
		await entered;
		return credential;
	});
	const { id } = manager.start("test");
	await tick();
	const promptId = manager.status(id).prompt.id;
	finishCallback();
	await tick();
	assert.equal(rejected, "AbortError");
	assert.equal(signal.aborted, false);
	assert.equal(manager.status(id).status, "ready");
	assert.equal(manager.status(id).prompt, undefined);
	assert.throws(() => manager.answer(id, { promptId, value: "late" }), hasStatus(409));
	assert.deepEqual(manager.takeCredential(id), { provider: "test", credential });
});

test("native failures never publish exception secrets and allow a new login", async (t) => {
	const manager = fixture(t, async ({ prompt }) => {
		await prompt({ type: "secret", message: "Secret" });
		throw new Error("private-access private-refresh private-answer");
	});
	const { id } = manager.start("test");
	await tick();
	manager.answer(id, { promptId: manager.status(id).prompt.id, value: "private-answer" });
	await tick();
	const state = manager.status(id);
	assert.equal(state.status, "error");
	assert.equal(state.error, "Subscription login failed. Please try again.");
	assert.equal(JSON.stringify(state).includes("private-"), false);
	assert.throws(() => manager.takeCredential(id), hasStatus(409));
	assert.equal(manager.start("test").status, "waiting");
});

test("already-aborted native prompts reject and cancel aborts a pending login", async (t) => {
	const manual = new AbortController();
	manual.abort();
	let signal;
	let rejected;
	const manager = fixture(t, async (interaction) => {
		signal = interaction.signal;
		await assert.rejects(interaction.prompt({ type: "manual_code", message: "Paste", signal: manual.signal }), { name: "AbortError" });
		try { await interaction.prompt({ type: "text", message: "Next" }); }
		catch (error) { rejected = error.name; throw error; }
	});
	const { id } = manager.start("test");
	await tick();
	assert.equal(manager.status(id).prompt.message, "Next");
	manager.cancel(id);
	await tick();
	assert.equal(signal.aborted, true);
	assert.equal(rejected, "AbortError");
	assert.equal(manager.status(id).status, "cancelled");
	assert.notEqual(manager.start("test").id, id);
	assert.throws(() => manager.status(id), hasStatus(404));
});
