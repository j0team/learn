#!/usr/bin/env node
// Learn: a local web front end for teaching sessions.
//
// Runs `pi --mode rpc` from the vault root and serves a single page on
// 127.0.0.1. The `quiz` and `ask_user_question` tools (learn.ts) hand their
// cards to this process; answer keys stay here until the learner submits, and
// the browser only ever sees sanitized questions.

import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeQuiz, shownQuestions, validateQuiz } from "./cards.mjs";
import { AGENT_DIR, PI_BASE_ARGS, readJsonLines, spawnPi } from "./pi.mjs";
import { createProviderStore, isProviderId, writePrivateJson } from "./providers.mjs";
import { branchesOf, lessonStats, listSessions, moveLesson, renameOnDisk, sessionParent } from "./sessions.mjs";
import { createSubscriptionLogin, subscriptionProviders } from "./subscriptions.mjs";
import { SKILL_MESSAGE, assistantParts, blocksFromMessages, clip, firstLine, isHiddenTool, textOf, toolBlock, toolLabel, userBlocks } from "./transcript.mjs";
import { createVault, vaultFolder } from "./vault.mjs";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
// The folder the tutor works in (its notes, files, viz/): LEARN_VAULT, or wherever the server was started.
const VAULT = path.resolve(process.env.LEARN_VAULT || process.cwd());
// The built UI (`npm run build`).
const PUBLIC = path.resolve(APP_DIR, "../dist");
const SESSIONS = process.env.LEARN_SESSIONS || path.join(os.homedir(), ".pi", "agent", "learn-sessions");
const PORT = Number(process.env.LEARN_PORT || 4747);
const HOST = "127.0.0.1";
const EXTRA_ARGS = (process.env.LEARN_PI_ARGS || "").split(" ").filter(Boolean);
const SKILLS = path.resolve(APP_DIR, "../skills");
// The tutor's tools: pi's file and shell tools plus the ones learn.ts adds.
const TUTOR_TOOLS = "read,bash,edit,write,grep,find,ls,quiz,ask_user_question,lesson_progress,subagent";

mkdirSync(SESSIONS, { recursive: true });

// ─── RPC client ─────────────────────────────────────────────────────────────

let seq = 0;

// One `pi --mode rpc` child. Responses resolve `call()` promises; everything
// else goes to `onEvent`.
function spawnRpc(args, { onEvent, onExit }) {
	const proc = spawnPi(args, { cwd: VAULT, stdio: ["pipe", "pipe", "pipe"] });
	const waiting = new Map();
	const rpc = {
		send(frame) {
			if (proc.stdin.writable) proc.stdin.write(`${JSON.stringify(frame)}\n`);
		},
		call(type, fields = {}) {
			const id = `learn-${++seq}`;
			return new Promise((resolve, reject) => {
				waiting.set(id, { resolve, reject });
				rpc.send({ id, type, ...fields });
			});
		},
		// Resolves once the process is gone.
		kill() {
			return new Promise((resolve) => {
				if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
				proc.once("exit", () => resolve());
				proc.kill();
			});
		},
	};
	readJsonLines(proc.stdout, (f) => {
		if (f.type === "response" && waiting.has(f.id)) {
			const w = waiting.get(f.id);
			waiting.delete(f.id);
			if (f.success) w.resolve(f.data ?? {});
			else w.reject(new Error(f.error));
		} else onEvent(f);
	});
	proc.stderr.on("data", (d) => process.stderr.write(d));
	proc.on("error", (err) => console.error(`couldn't start pi: ${err.message}`));
	proc.on("exit", (code) => {
		for (const w of waiting.values()) w.reject(new Error("pi exited"));
		waiting.clear();
		onExit?.(code);
	});
	return rpc;
}

// ─── Tutors ─────────────────────────────────────────────────────────────────
// pi holds one session per process, so every lesson that's open or still
// working has its own `pi --mode rpc`: a tutor `t`, which also keeps that
// lesson's transcript state (what the browser renders). The page shows one
// lesson at a time (`active`); a lesson left mid-turn carries on in the
// background, and its process exits once it has nothing left to do.

const tutors = new Set();
let active = null;
const clients = new Set();

function broadcast(op) {
	const data = `data: ${JSON.stringify(op)}\n\n`;
	for (const res of clients) res.write(data);
}

// A lesson's own updates reach the page only while it's the one on screen.
const emit = (t, op) => t === active && broadcast(op);

// Mid-turn, or waiting on the learner's answer to a card.
const working = (t) => t.busy || t.pending.size > 0;

// Lessons whose tutor is working, for the sidebar.
const runningFiles = () => [...tutors].filter((t) => working(t) && t.session.file).map((t) => t.session.file);
let runningSent = "[]";
function broadcastRunning() {
	const files = runningFiles();
	const sent = JSON.stringify(files);
	if (sent === runningSent) return;
	runningSent = sent;
	broadcast({ op: "running", files });
}

// `file` reopens a lesson; without one the tutor starts a new lesson. pi takes
// commands as soon as it starts; there is no ready handshake.
function spawnTutor(file = null) {
	const resume = file && existsSync(file) ? ["--session", file] : [];
	const t = {
		blocks: [],
		busy: false,
		busySince: 0, // when the current stretch of work started, for the "working" timer
		session: { file: resume.length ? file : null, title: "", parent: null },
		pending: new Map(), // host call id -> { blockId, kind, args }
		tuning: { model: null, thinking: "", levels: [] }, // shown in (and settable from) the composer
		usage: null, // context window fill and session cost, like the terminal status line
		usageTimer: null,
		current: null, // the assistant block being written (see onMessageStart)
		stopping: false,
		rewindWait: null,
		closing: false, // shut down on purpose: don't restart it
	};
	t.rpc = spawnRpc(
		[
			"--mode", "rpc",
			"--session-dir", SESSIONS,
			...resume,
			// Only the app's own extensions and skills, so the tutor behaves the same on every machine.
			...PI_BASE_ARGS, "-e", path.join(APP_DIR, "learn.ts"),
			"--no-skills", "--skill", SKILLS,
			"--tools", TUTOR_TOOLS,
			"--append-system-prompt", path.join(APP_DIR, "app-prompt.md"),
			...EXTRA_ARGS,
		],
		{ onEvent: (f) => onFrame(t, f), onExit: (code) => onTutorExit(t, code) },
	);
	t.call = (type, fields) => t.rpc.call(type, fields);
	t.send = (frame) => t.rpc.send(frame);
	tutors.add(t);
	t.ready = startTutor(t, !resume.length).catch((err) => console.error("startup failed:", err.message));
	return t;
}

async function startTutor(t, fresh) {
	const [{ commands }] = await Promise.all([t.call("get_commands"), fresh && applyLearnDefaults(t)]);
	setCommands(commands);
	await loadLesson(t);
}

function onTutorExit(t, code) {
	dropPending(t);
	tutors.delete(t);
	setBusy(t, false);
	if (t.closing) return;
	// The lesson on screen reopens where it was; one in the background just stops.
	const shown = t === active;
	console.error(`pi exited (${code})${shown ? "; restarting" : ""}`);
	if (shown) setTimeout(() => t === active && show(spawnTutor(t.session.file)), 1000);
}

// Let a tutor's process go: its lesson finished in the background, or is going away.
function retire(t) {
	t.closing = true;
	tutors.delete(t);
	broadcastRunning();
	return t.rpc.kill();
}

// A background lesson that has settled; a short grace so pi finishes writing.
function retireIfIdle(t) {
	setTimeout(() => t !== active && tutors.has(t) && !working(t) && retire(t), 2000);
}

// Put a tutor's lesson on screen. The lesson it replaces keeps going in the
// background if it's working; otherwise its process goes.
async function show(t) {
	const prev = active;
	active = t;
	await t.ready;
	if (t !== active) return;
	broadcast(snapshot(t));
	broadcastRunning();
	if (prev && prev !== t && tutors.has(prev) && !working(prev)) retire(prev);
	if (prev?.session.file !== t.session.file) await resetSide();
}

const byId = (t, id) => t.blocks.find((b) => b.id === id);

function addBlock(t, block) {
	t.blocks.push(block);
	emit(t, { op: "add", block });
}

function patchBlock(t, block) {
	emit(t, { op: "patch", block });
}

function setBusy(t, value) {
	if (t.busy === value) return;
	t.busy = value;
	t.busySince = value ? Date.now() : 0;
	emit(t, { op: "busy", busy: value, since: t.busySince });
	broadcastRunning();
}

// The model and thinking level last picked in Learn. Every new lesson starts on
// them, so Learn doesn't drift with pi's own startup default, which is shared
// with pi in the terminal and changes whenever it's used there. Until something
// is picked here, pi's default applies. An opened lesson keeps its own model.
const PREFS_FILE = path.join(SESSIONS, "learn.json");

function readPrefs() {
	try {
		return JSON.parse(readFileSync(PREFS_FILE, "utf8"));
	} catch {
		return {};
	}
}

function savePrefs(patch) {
	writePrivateJson(PREFS_FILE, { ...readPrefs(), ...patch });
}

async function applyLearnDefaults(t) {
	const { model, thinking } = readPrefs();
	if (model?.provider && model?.id) {
		try {
			await t.call("set_model", { provider: model.provider, modelId: model.id });
		} catch (err) {
			// The key for it was removed, or the model retired: fall back to pi's default.
			console.error(`Learn's model ${model.provider}/${model.id} isn't available: ${err.message}`);
		}
	}
	if (thinking) await t.call("set_thinking_level", { level: thinking }).catch(() => {});
}
let modelCache = null;

// Slash commands for autocomplete: the vault's skills and prompt templates, plus
// compaction, which pi only offers as an RPC command. The app's own commands
// (learn-*) and any other extension commands stay out of the list.
const COMPACT = { name: "compact", description: "Summarize the lesson so far to free up room in the context", hint: "", source: "builtin" };
let commands = [];
let commandNames = new Set();

function setCommands(list = []) {
	commandNames = new Set([COMPACT.name, ...list.map((c) => c.name)]);
	commands = [
		COMPACT,
		...list.filter((c) => c.source !== "extension").map((c) => ({ name: c.name, description: c.description || "", hint: "", source: c.source })),
	];
	broadcast({ op: "commands", commands });
}

function refreshUsage(t) {
	clearTimeout(t.usageTimer);
	t.usageTimer = setTimeout(async () => {
		try {
			const s = await t.call("get_session_stats");
			t.usage = { ...(s.contextUsage || {}), cost: s.cost || 0 };
			emit(t, { op: "usage", usage: t.usage });
		} catch {}
	}, 150);
}

function snapshot(t) {
	return {
		op: "snapshot",
		blocks: t.blocks,
		busy: t.busy,
		busySince: t.busySince,
		session: t.session,
		tuning: t.tuning,
		usage: t.usage,
		commands,
		running: runningFiles(),
		side: { thread: sideThread, busy: sideBusy },
		vault: path.basename(VAULT),
	};
}

// `known` is a get_state reply the caller already has.
async function refreshTuning(t, known) {
	const [state, { levels }] = await Promise.all([known ?? t.call("get_state"), t.call("get_available_thinking_levels")]);
	const m = state.model;
	t.tuning = {
		model: m ? { provider: m.provider, id: m.id, name: m.name || m.id } : null,
		thinking: state.thinkingLevel || "",
		levels,
	};
	emit(t, { op: "tuning", tuning: t.tuning });
	refreshUsage(t);
}

function markCancelled(t, blockId) {
	const b = byId(t, blockId);
	if (b && b.state === "pending") {
		b.state = "cancelled";
		patchBlock(t, b);
	}
}

// Cards nobody can answer any more (the tutor was stopped, or the tool failed).
function dropPending(t, blockId) {
	for (const [id, p] of t.pending) {
		if (blockId && p.blockId !== blockId) continue;
		t.pending.delete(id);
		markCancelled(t, p.blockId);
	}
}

// ─── pi event handling ──────────────────────────────────────────────────────

// pi's events carry no message ids; messages stream one at a time, so the
// assistant block being written is simply the latest one started (`t.current`).
function onFrame(t, f) {
	switch (f.type) {
		case "thinking_level_changed":
			refreshTuning(t).catch(() => {});
			return;
		case "agent_start":
			return setBusy(t, true);
		// agent_end can be followed by retries or queued messages; settled is final.
		case "agent_settled":
			setBusy(t, false);
			dropPending(t);
			refreshUsage(t);
			syncEntryIds(t);
			if (t !== active) retireIfIdle(t);
			return;
		case "compaction_end":
			return refreshUsage(t);
		case "message_start":
			return onMessageStart(t, f);
		case "message_update":
			return onMessageUpdate(t, f);
		case "message_end":
			return onMessageEnd(t, f);
		case "tool_execution_start": {
			const b = toolBlock(f.toolCallId, f.toolName, f.args, "running");
			return b && addBlock(t, b);
		}
		case "tool_execution_end": {
			if (isHiddenTool(f.toolName)) return f.isError && dropPending(t, f.toolCallId);
			const b = byId(t, f.toolCallId);
			if (!b || b.kind !== "tool") return;
			b.status = f.isError ? "error" : "done";
			b.output = clip(textOf(f.result?.content));
			return patchBlock(t, b);
		}
		case "extension_ui_request":
			if (f.method === "input" && f.title?.startsWith("learn:")) return onCardRequest(t, f);
			if (f.method === "notify" && t.rewindWait && f.message === `learn-rewind:${t.rewindWait.entryId}`) return t.rewindWait.resolve();
			return declineDialog(f, t.send);
		case "extension_error":
			if (t.rewindWait) t.rewindWait.reject(new Error(f.error));
			return;
	}
}

// Move the lesson back to just before one of the learner's messages, inside the
// same session file (what `/tree` does in the terminal). learn.ts does the move;
// it reports back through a notify frame or an extension error.
async function rewindTo(t, entryId) {
	const done = new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Rewind timed out.")), 15000);
		const settle = (fn) => (v) => {
			clearTimeout(timer);
			t.rewindWait = null;
			fn(v);
		};
		t.rewindWait = { entryId, resolve: settle(resolve), reject: settle(reject) };
	});
	// Awaited together: a rejection nobody is waiting on yet would end the server.
	await Promise.all([t.call("prompt", { message: `/learn-rewind ${entryId}` }), done]);
}

// Dialog-style extension requests must be answered or the extension hangs.
function declineDialog(f, reply) {
	if (["select", "confirm", "input", "editor"].includes(f.method)) reply({ type: "extension_ui_response", id: f.id, cancelled: true });
}

function onMessageStart(t, f) {
	const m = f.message;
	if (m.role === "user") {
		for (const b of userBlocks(m.content, `u-${++seq}`)) addBlock(t, b);
	} else if (m.role === "assistant") {
		t.current = { id: `a-${++seq}`, kind: "assistant", parts: [], done: false };
		addBlock(t, t.current);
	}
}

// Tools the model writes out at length before they run, named for the status line.
const DRAFTING = { quiz: "worksheet", ask_user_question: "question" };
const tokensSent = new WeakMap(); // block -> when its token count last went out
const streamed = new WeakMap(); // block -> characters streamed so far

function onMessageUpdate(t, f) {
	const b = t.current;
	const e = f.assistantMessageEvent;
	if (!b || !e) return;
	const i = e.contentIndex;
	// Output tokens so far. Many providers report the real count only at the end
	// of a message, so in between estimate from what has streamed (~4 chars a
	// token, thinking and tool arguments included); message_end sets the real one.
	if (typeof e.delta === "string") streamed.set(b, (streamed.get(b) || 0) + e.delta.length);
	const out = Math.max(f.usage?.output || 0, Math.round((streamed.get(b) || 0) / 4));
	if (out !== b.outTokens) {
		b.outTokens = out;
		const now = Date.now();
		if (now - (tokensSent.get(b) || 0) > 250) {
			tokensSent.set(b, now);
			emit(t, { op: "tokens", id: b.id, n: out });
		}
	}
	// Thinking is never shown: it routinely contains the answer key of the quiz
	// being written. The browser only learns that thinking is happening.
	if (e.type === "text_start" || e.type === "thinking_start") {
		b.parts[i] = { type: e.type === "text_start" ? "text" : "thinking", text: "" };
		emit(t, { op: "part", id: b.id, index: i, part: b.parts[i] });
	} else if (e.type === "text_delta") {
		if (!b.parts[i]) return;
		b.parts[i].text += e.delta;
		emit(t, { op: "delta", id: b.id, index: i, text: e.delta });
	} else if (e.type === "toolcall_start") {
		b.drafting = DRAFTING[e.toolName] || e.toolName || "tool";
		emit(t, { op: "drafting", id: b.id, what: b.drafting });
	}
}

function onMessageEnd(t, f) {
	const m = f.message;
	// The learner's message is in the session now, so it can be edited straight away.
	if (m.role === "user") return void syncEntryIds(t);
	const b = t.current;
	if (m.role !== "assistant" || !b) return;
	t.current = null;
	b.parts = assistantParts(m.content);
	b.done = true;
	if (typeof m.usage?.output === "number") b.outTokens = m.usage.output;
	delete b.drafting;
	patchBlock(t, b);
	// Stopping the tutor fails the request in flight; that isn't worth an error card.
	if (m.stopReason === "error" && m.errorMessage && !t.stopping) {
		addBlock(t, { id: `err-${++seq}`, kind: "error", text: m.errorMessage });
	}
}

// Stop whatever the tutor is doing. pi answers once it is idle again, so every
// message that ends in between belongs to the stop.
async function stopTutor(t) {
	t.stopping = true;
	try {
		await t.call("abort");
	} finally {
		t.stopping = false;
	}
}

// ─── Cards: quiz / ask_user_question ────────────────────────────────────────
// learn.ts sends each call as an `input` dialog titled "learn:<tool>" carrying
// { toolCallId, args }; the answer goes back as that dialog's value.

const answerCard = (t, dialogId, result) => t.send({ type: "extension_ui_response", id: dialogId, value: JSON.stringify(result) });

function onCardRequest(t, f) {
	const tool = f.title.slice("learn:".length);
	const { toolCallId, args } = JSON.parse(f.placeholder || "{}");
	const reject = (error) => answerCard(t, f.id, { error });
	const blockId = toolCallId || f.id;
	if (tool === "quiz") {
		const problem = validateQuiz(args);
		if (problem) return reject(`Invalid quiz: ${problem}. Fix it and call quiz again.`);
		const questions = shownQuestions(args);
		t.pending.set(f.id, { blockId, kind: "quiz", args, questions });
		return addBlock(t, { id: blockId, kind: "quiz", title: args.title || "", questions, state: "pending" });
	}
	if (tool === "ask_user_question") {
		const a = args || {};
		if (!a.question || !Array.isArray(a.options) || a.options.length === 0) return reject("ask_user_question needs a question and at least one option.");
		t.pending.set(f.id, { blockId, kind: "ask", args: a });
		return addBlock(t, {
			id: blockId,
			kind: "ask",
			question: a.question,
			details: a.details || "",
			multi: !!a.multiSelect,
			options: a.options.map(({ label, description }) => ({ label, description: description || "" })),
			state: "pending",
		});
	}
	reject(`Unknown card ${tool}`);
}

function findPending(t, blockId) {
	for (const [dialogId, p] of t.pending) if (p.blockId === blockId) return [dialogId, p];
	return [];
}

// The card is answered: off the waiting list, and the learner's answer shown on it.
function settleCard(t, dialogId, blockId, fields) {
	const b = Object.assign(byId(t, blockId), { state: "answered" }, fields);
	t.pending.delete(dialogId);
	patchBlock(t, b);
	return b;
}

function answerQuiz(t, blockId, answers) {
	const [dialogId, p] = findPending(t, blockId);
	if (!p || p.kind !== "quiz") throw new Error("This worksheet is no longer waiting for answers.");
	if (!Array.isArray(answers) || answers.length !== p.questions.length) throw new Error("Answer every question first.");
	const { results, text } = gradeQuiz(p, answers);
	const b = settleCard(t, dialogId, blockId, { results });
	answerCard(t, dialogId, { text, block: b });
}

function answerAsk(t, blockId, picked, text) {
	const [dialogId, p] = findPending(t, blockId);
	if (!p || p.kind !== "ask") throw new Error("This question is no longer waiting for an answer.");
	const chosen = [picked || []].flat().filter((l) => p.args.options.some((o) => o.label === l));
	const other = (text || "").trim();
	if (!chosen.length && !other) throw new Error("Pick an option or write something.");
	const b = settleCard(t, dialogId, blockId, { answer: { picked: chosen, text: other } });
	const parts = [];
	if (chosen.length) parts.push(`Learner chose: ${chosen.map((c) => `"${c}"`).join(", ")}.`);
	if (other) parts.push(`Learner wrote: """${other}"""`);
	answerCard(t, dialogId, { text: parts.join("\n"), block: b });
}

// ─── Sessions ───────────────────────────────────────────────────────────────

async function loadLesson(t) {
	const [state, { messages }] = await Promise.all([t.call("get_state"), t.call("get_messages")]);
	t.blocks = blocksFromMessages(messages);
	t.current = null;
	t.session = { file: state.sessionFile || null, title: state.sessionName || firstUserText(t), parent: sessionParent(state.sessionFile) };
	setBusy(t, !!state.isStreaming);
	await Promise.all([syncEntryIds(t, true), refreshTuning(t, state)]);
	emit(t, snapshot(t));
}

// Tag each of the learner's messages with its session entry id, which is what
// editing and branching need. pi only hands those out per branch, in order, so
// match by text.
async function syncEntryIds(t, quiet = false) {
	const res = await t.call("get_fork_messages").catch(() => null);
	if (!res) return;
	const users = t.blocks.filter((b) => b.kind === "user");
	let from = 0;
	for (const m of res.messages) {
		const text = m.text.replace(SKILL_MESSAGE, "").trim();
		const k = users.findIndex((b, i) => i >= from && b.text === text);
		if (k < 0) continue;
		from = k + 1;
		if (users[k].entryId === m.entryId) continue;
		users[k].entryId = m.entryId;
		if (!quiet) patchBlock(t, users[k]);
	}
}

// Name the lesson: after its first prompt, and on a new branch, which starts untitled.
async function keepTitle(t, title) {
	if (!title || t.session.title === title) return;
	t.session.title = title;
	await t.call("set_session_name", { name: title }).catch(() => {});
	emit(t, { op: "session", session: t.session });
}

function firstUserText(t) {
	return firstLine(t.blocks.find((b) => b.kind === "user")?.text, 80);
}

// pi writes a new session to disk only once the first reply is done; list a
// live one as soon as it has a prompt.
function liveLessons() {
	const out = [];
	for (const t of tutors) {
		const { file, title, parent } = t.session;
		const lastUser = t.blocks.findLast((b) => b.kind === "user");
		if (file && lastUser) out.push({ file, title: title || "Untitled lesson", last: firstLine(lastUser.text, 80), parent, updated: Date.now() });
	}
	return out;
}

const lessons = () => listSessions(SESSIONS, liveLessons());
const archived = () => listSessions(ARCHIVE);

// ─── Archive / delete ───────────────────────────────────────────────────────

const ARCHIVE = path.join(SESSIONS, "archive");

// pi holds an open lesson's file; let go of it before touching the file. A
// working tutor stops first, so pi writes the turn (a new lesson's file only
// appears once its first turn ends). The lesson on screen moves to a new one;
// one in the background just goes.
async function leaveIf(files) {
	for (const t of [...tutors]) {
		if (!files.includes(t.session.file)) continue;
		if (working(t)) await stopTutor(t);
		if (t !== active) {
			await retire(t);
			continue;
		}
		t.pending.clear();
		await freshLesson(t);
	}
}

// Moves a tutor onto a new, empty lesson. pi starts each new session on its own
// default model, so Learn's pick is applied again.
async function freshLesson(t) {
	await t.call("new_session");
	await applyLearnDefaults(t);
	await loadLesson(t);
	await resetSide();
}

// /compact [what to keep]: pi summarizes the older turns in place. The transcript
// on screen stays as it is; only the tutor's context shrinks.
async function compact(t, text) {
	const instructions = text.replace(/^\/compact\s*/, "").trim();
	setBusy(t, true);
	try {
		const r = await t.call("compact", instructions ? { customInstructions: instructions } : {});
		const after = r.estimatedTokensAfter ? ` to about ${r.estimatedTokensAfter.toLocaleString()}` : "";
		addBlock(t, { id: `cmd-${++seq}`, kind: "user", text });
		addBlock(t, { id: `out-${++seq}`, kind: "output", text: `Summarized the lesson so far: ${r.tokensBefore.toLocaleString()} tokens of context${after}.` });
	} finally {
		setBusy(t, false);
		refreshUsage(t);
	}
}

// ─── Side chat ──────────────────────────────────────────────────────────────
// A second, session-less pi for quick questions mid-lesson. It never sees the
// lesson transcript, only a short brief of what is on screen (the open card and
// the tutor's latest message), so it stays cheap and nothing it says leaks into
// the main tutor's context.

let side = null;
let sideModel = "";
let sideThread = [];
let sideBusy = false;
let sideBrief = null;
let sideCurrent = null; // assistant reply being streamed

function setSideBusy(value) {
	if (sideBusy === value) return;
	sideBusy = value;
	broadcast({ op: "sideBusy", busy: value });
}

function upsertSide(block) {
	if (!sideThread.includes(block)) sideThread.push(block);
	broadcast({ op: "sideBlock", block });
}

function startSide() {
	const m = active?.tuning.model;
	sideModel = m ? `${m.provider}/${m.id}` : "";
	const args = [
		"--mode", "rpc", "--no-session",
		...PI_BASE_ARGS, "--no-skills", "--no-prompt-templates",
		"--thinking", "low",
		"--tools", "read,grep,find,ls",
		"--append-system-prompt", path.join(APP_DIR, "side-prompt.md"),
	];
	if (sideModel) args.push("--model", sideModel);
	side = spawnRpc([...args, ...EXTRA_ARGS], {
		onEvent: onSideFrame,
		onExit: (code) => {
			console.error(`side chat pi exited (${code})`);
			side = null;
			sideCurrent = null;
			setSideBusy(false);
		},
	});
}

function onSideFrame(f) {
	switch (f.type) {
		case "agent_start":
			return setSideBusy(true);
		case "agent_settled":
			return setSideBusy(false);
		case "message_start":
			if (f.message.role !== "assistant") return;
			sideCurrent = { id: `sa-${++seq}`, kind: "assistant", text: "", thinking: false, done: false };
			return upsertSide(sideCurrent);
		case "message_update": {
			const e = f.assistantMessageEvent;
			if (!sideCurrent || !e) return;
			if (e.type === "thinking_start" && !sideCurrent.thinking) {
				sideCurrent.thinking = true;
				upsertSide(sideCurrent);
			} else if (e.type === "text_delta") {
				sideCurrent.text += e.delta;
				broadcast({ op: "sideDelta", id: sideCurrent.id, text: e.delta });
			}
			return;
		}
		case "message_end": {
			if (f.message.role !== "assistant" || !sideCurrent) return;
			sideCurrent.text = textOf(f.message.content);
			sideCurrent.done = true;
			upsertSide(sideCurrent);
			sideCurrent = null;
			if (f.message.stopReason === "error" && f.message.errorMessage) upsertSide({ id: `se-${++seq}`, kind: "error", text: f.message.errorMessage });
			return;
		}
		case "tool_execution_start":
			return upsertSide({ id: `st-${f.toolCallId}`, kind: "tool", label: toolLabel(f.toolName, f.args), status: "running" });
		case "tool_execution_end": {
			const b = sideThread.find((x) => x.id === `st-${f.toolCallId}`);
			if (!b) return;
			b.status = f.isError ? "error" : "done";
			return upsertSide(b);
		}
		case "extension_ui_request":
			return declineDialog(f, (frame) => side?.send(frame));
	}
}

// What the learner is looking at right now, without any answer keys.
function lessonBrief() {
	const { session, blocks } = active;
	const lines = [`Lesson: ${session.title || "untitled"}`];
	const card = blocks.findLast((b) => (b.kind === "quiz" || b.kind === "ask") && b.state === "pending");
	if (card?.kind === "quiz") {
		lines.push("", `The learner is working on this worksheet right now${card.title ? ` ("${card.title}")` : ""}. You do not have its answer key.`);
		card.questions.forEach((q, i) => {
			lines.push(`${i + 1}. ${q.question}`);
			if (q.details) lines.push(`   ${q.details}`);
			for (const [j, o] of (q.options || []).entries()) lines.push(`   ${String.fromCharCode(65 + j)}) ${o.label}`);
		});
	} else if (card?.kind === "ask") {
		lines.push("", `The tutor just asked the learner: ${card.question}`, ...card.options.map((o) => `- ${o.label}`));
	}
	const last = blocks.findLast((b) => b.kind === "assistant" && b.done);
	const text = last?.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n\n").trim();
	if (text) lines.push("", "The tutor's latest message:", text.length > 2400 ? `${text.slice(0, 2400)}…` : text);
	return lines.join("\n");
}

async function askSide(text) {
	if (sideBusy) throw new Error("The side chat is still answering.");
	if (!side) startSide();
	const m = active.tuning.model;
	const key = m ? `${m.provider}/${m.id}` : "";
	if (key && key !== sideModel) {
		await side.call("set_model", { provider: m.provider, modelId: m.id });
		sideModel = key;
	}
	// Re-send the brief only when the screen changed since the last question.
	const brief = lessonBrief();
	const message = brief === sideBrief ? text : `<lesson-context>\n${brief}\n</lesson-context>\n\n${text}`;
	sideBrief = brief;
	upsertSide({ id: `su-${++seq}`, kind: "user", text });
	setSideBusy(true);
	try {
		await side.call("prompt", { message });
	} catch (err) {
		setSideBusy(false);
		throw err;
	}
}

async function resetSide() {
	if (side) {
		if (sideBusy) await side.call("abort").catch(() => {});
		await side.call("new_session").catch(() => {});
		sideModel = ""; // the new session is on pi's default model; the next question sets it again
	}
	sideThread = [];
	sideBrief = null;
	sideCurrent = null;
	setSideBusy(false);
	broadcast({ op: "sideReset" });
}

// ─── Providers ──────────────────────────────────────────────────────────────
// Keys live in pi's auth.json, the file its `/login` writes. pi reads it once
// at startup, so a change restarts both pi processes; the lesson reopens where
// it was.

// [pi provider id, name, the environment variable pi also reads the key from]
const PROVIDERS = [
	["anthropic", "Anthropic", "ANTHROPIC_API_KEY"],
	["openai", "OpenAI", "OPENAI_API_KEY"],
	["openai-codex", "OpenAI Codex", null],
	["google", "Google Gemini", "GEMINI_API_KEY"],
	["openrouter", "OpenRouter", "OPENROUTER_API_KEY"],
	["xai", "xAI", "XAI_API_KEY"],
	["mistral", "Mistral", "MISTRAL_API_KEY"],
	["deepseek", "DeepSeek", "DEEPSEEK_API_KEY"],
	["groq", "Groq", "GROQ_API_KEY"],
	["cerebras", "Cerebras", "CEREBRAS_API_KEY"],
	["together", "Together AI", "TOGETHER_API_KEY"],
	["fireworks", "Fireworks", "FIREWORKS_API_KEY"],
	["moonshotai", "Moonshot AI", "MOONSHOT_API_KEY"],
	["zai", "Z.AI", "ZAI_API_KEY"],
	["vercel-ai-gateway", "Vercel AI Gateway", "AI_GATEWAY_API_KEY"],
	["huggingface", "Hugging Face", "HF_TOKEN"],
];

const providerStore = createProviderStore({ agentDir: AGENT_DIR, reserved: PROVIDERS.map(([id]) => id) });
const subscriptionLogin = createSubscriptionLogin();

// How each provider is signed in, if at all. Keys never leave this process;
// the page gets their last four characters.
function providerList() {
	const auth = providerStore.readAuth();
	const row = (id, name, env) => {
		const a = auth[id];
		const key = a?.type === "api_key" ? String(a.key || "") : "";
		const source = a?.type === "oauth" ? "login" : key.startsWith("!") ? "command" : key ? "key" : env && process.env[env] ? "env" : null;
		return { id, name, env, source, tail: source === "key" ? key.slice(-4) : "", subscription: subscriptionProviders.some((provider) => provider.id === id) };
	};
	const custom = providerStore.list();
	const known = new Set([...PROVIDERS.map(([id]) => id), ...custom.map(({ id }) => id)]);
	return [...PROVIDERS.map((p) => row(...p)), ...Object.keys(auth).filter((id) => !known.has(id)).map((id) => row(id, id, null)), ...custom.map((provider) => ({ ...row(provider.id, provider.name, null), ...provider }))];
}

// Why a lesson can't take a lesson-wide action (save, fork, reload) right now.
function tutorBlocker(t) {
	if (t.busy) return "Wait for the tutor to finish first.";
	if (t.pending.size) return "Answer the open card first.";
	return null;
}

function reloadBlocker() {
	return tutorBlocker(active) || ([...tutors].some(working) ? "Wait for the lessons working in the background to finish." : null);
}

// Change provider settings, then restart pi so it reads them.
async function reloadAfter(res, change) {
	const blocked = reloadBlocker();
	if (blocked) return json(res, 409, { error: blocked });
	await change?.();
	await reloadPi();
	return json(res, 200, { providers: providerList() });
}

async function reloadPi() {
	modelCache = null;
	if (side) {
		await side.kill();
		await resetSide();
	}
	const file = active.session.file;
	await Promise.all([...tutors].map(retire));
	await show(spawnTutor(file));
}

// ─── Vault index (@ mentions, save folders) ─────────────────────────────────

const vault = createVault(VAULT);

// ─── HTTP ───────────────────────────────────────────────────────────────────

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
};

function serveFile(res, file) {
	if (!existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: "not found" });
	res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
	createReadStream(file).pipe(res);
}

function json(res, status, body) {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	res.end(JSON.stringify(body));
}

async function readBody(req) {
	let raw = "";
	for await (const chunk of req) raw += chunk;
	return raw ? JSON.parse(raw) : {};
}

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

async function handle(req, res) {
	// The agent can run shell commands, so only the page served from here may
	// drive it: reject DNS-rebinding hosts and cross-site requests.
	if (!ALLOWED_HOSTS.has(req.headers.host)) return json(res, 403, { error: "bad host" });
	const url = new URL(req.url, `http://${req.headers.host}`);
	if (req.method === "POST") {
		const origin = req.headers.origin;
		if (!origin || !ALLOWED_HOSTS.has(new URL(origin).host)) return json(res, 403, { error: "bad origin" });
	}
	const route = `${req.method} ${url.pathname}`;
	try {
		// Lesson requests go to the lesson on screen, once its tutor has started.
		if (req.method === "POST") await active.ready;
		const t = active;
		switch (route) {
			case "GET /api/events": {
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
				res.write(`data: ${JSON.stringify(snapshot(active))}\n\n`);
				clients.add(res);
				const ping = setInterval(() => res.write(": ping\n\n"), 20000);
				req.on("close", () => {
					clearInterval(ping);
					clients.delete(res);
				});
				return;
			}
			case "POST /api/prompt": {
				const { text } = await readBody(req);
				if (!text?.trim()) return json(res, 400, { error: "empty" });
				if (t.pending.size) return json(res, 409, { error: "Answer the open question first." });
				const name = /^\/(\S+)/.exec(text)?.[1];
				if (commandNames.has(name) && t.busy) return json(res, 409, { error: "Wait for the tutor to finish before running a command." });
				if (name === "compact") {
					await compact(t, text);
					return json(res, 200, { ok: true });
				}
				const firstPrompt = !t.blocks.some((b) => b.kind === "user");
				// While the tutor works, a message waits for its current step to finish.
				await t.call("prompt", t.busy ? { message: text, streamingBehavior: "steer" } : { message: text });
				if (firstPrompt) await keepTitle(t, firstLine(text, 80));
				return json(res, 200, { ok: true });
			}
			case "POST /api/abort":
				await stopTutor(t);
				return json(res, 200, { ok: true });
			case "POST /api/quiz": {
				const { id, answers } = await readBody(req);
				answerQuiz(t, id, answers);
				return json(res, 200, { ok: true });
			}
			case "POST /api/ask": {
				const { id, picked, text } = await readBody(req);
				answerAsk(t, id, picked, text);
				return json(res, 200, { ok: true });
			}
			case "GET /api/models": {
				modelCache ??= (await t.call("get_available_models")).models.map((m) => ({ provider: m.provider, id: m.id, name: m.name || m.id }));
				return json(res, 200, { models: modelCache, providerNames: Object.fromEntries(providerList().map(({ id, name }) => [id, name])) });
			}
			case "POST /api/model": {
				const { provider, id } = await readBody(req);
				await t.call("set_model", { provider, modelId: id });
				savePrefs({ model: { provider, id } });
				await refreshTuning(t);
				return json(res, 200, { ok: true });
			}
			case "POST /api/thinking": {
				const { level } = await readBody(req);
				await t.call("set_thinking_level", { level });
				await refreshTuning(t);
				if (t.tuning.thinking === level) savePrefs({ thinking: level });
				return json(res, 200, { ok: true });
			}
			case "GET /api/providers":
				return json(res, 200, { providers: providerList() });
			case "POST /api/providers/login": {
				const { provider } = await readBody(req);
				return json(res, 200, { login: subscriptionLogin.start(provider) });
			}
			case "GET /api/providers/login":
				return json(res, 200, { login: subscriptionLogin.status(url.searchParams.get("id")) });
			case "POST /api/providers/login/answer": {
				const { id, promptId, value } = await readBody(req);
				return json(res, 200, { login: subscriptionLogin.answer(id, { promptId, value }) });
			}
			case "POST /api/providers/login/cancel": {
				const { id } = await readBody(req);
				return json(res, 200, { login: subscriptionLogin.cancel(id) });
			}
			case "POST /api/providers/login/finish": {
				const { id } = await readBody(req);
				return reloadAfter(res, () =>
					subscriptionLogin.takeCredential(id, ({ provider, credential }) => providerStore.setCredential(provider, credential)),
				);
			}
			// Save or replace an API key; an empty key removes the provider's saved credential.
			case "POST /api/providers": {
				const { id, key = "" } = await readBody(req);
				if (!isProviderId(id)) return json(res, 400, { error: "unknown provider" });
				if (typeof key !== "string") return json(res, 400, { error: "API key must be a string." });
				return reloadAfter(res, () => providerStore.setKey(id, key));
			}
			case "POST /api/providers/custom": {
				const body = await readBody(req);
				return reloadAfter(res, () => providerStore.save(body));
			}
			case "POST /api/providers/custom/remove": {
				const { id } = await readBody(req);
				return reloadAfter(res, () => providerStore.remove(id));
			}
			// After a `/login` in a terminal: pick the new credential up.
			case "POST /api/providers/reload":
				return reloadAfter(res);
			case "GET /api/health":
				return json(res, 200, { ok: true });
			case "GET /api/sessions":
				return json(res, 200, { sessions: lessons(), archived: archived() });
			case "GET /api/stats":
				return json(res, 200, lessonStats([SESSIONS, ARCHIVE]));
			// Where "Save to vault" can put the note, and the folder used last time.
			case "GET /api/folders":
				return json(res, 200, { folders: vault.dirs(), saved: readPrefs().saveFolder ?? null });
			// The tutor writes the note into the folder the learner picked, which
			// becomes the default next time.
			case "POST /api/save": {
				const folder = vaultFolder((await readBody(req)).folder);
				if (!folder) return json(res, 400, { error: "Pick a folder in your vault." });
				const blocked = tutorBlocker(t);
				if (blocked) return json(res, 409, { error: blocked });
				savePrefs({ saveFolder: folder });
				await t.call("prompt", { message: `Save this lesson to the vault, in \`${folder}/\`. That's the folder I picked, so put the note right there (follow "Saving the lesson" in the teach skill).` });
				return json(res, 200, { ok: true });
			}
			// Archiving takes the lesson's branches along; restoring brings them back.
			case "POST /api/archive": {
				const { file } = await readBody(req);
				const all = lessons();
				if (!all.some((s) => s.file === file)) return json(res, 404, { error: "unknown lesson" });
				const files = [file, ...branchesOf(file, all)];
				await leaveIf(files);
				for (const f of files) moveLesson(f, ARCHIVE);
				return json(res, 200, { ok: true });
			}
			case "POST /api/restore": {
				const { file } = await readBody(req);
				const all = archived();
				if (!all.some((s) => s.file === file)) return json(res, 404, { error: "unknown lesson" });
				for (const f of [file, ...branchesOf(file, all)]) moveLesson(f, SESSIONS);
				return json(res, 200, { file: path.join(SESSIONS, path.basename(file)) });
			}
			case "POST /api/rename": {
				const { file, title } = await readBody(req);
				const name = String(title ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
				if (!name) return json(res, 400, { error: "Give the lesson a name." });
				const holder = file && [...tutors].find((x) => x.session.file === file);
				if (holder) {
					// A lesson with a tutor: pi writes the name (now, or with the file once it exists).
					await holder.call("set_session_name", { name });
					holder.session.title = name;
					emit(holder, { op: "session", session: holder.session });
					return json(res, 200, { ok: true });
				}
				if (![...lessons(), ...archived()].some((s) => s.file === file)) return json(res, 404, { error: "unknown lesson" });
				renameOnDisk(file, name);
				return json(res, 200, { ok: true });
			}
			// `branches: false` keeps the lesson's branches; they become lessons of their own.
			case "POST /api/delete": {
				const { file, branches } = await readBody(req);
				const all = [...lessons(), ...archived()];
				if (!all.some((s) => s.file === file)) return json(res, 404, { error: "unknown lesson" });
				const files = branches ? [file, ...branchesOf(file, all)] : [file];
				await leaveIf(files);
				for (const f of files) rmSync(f, { force: true });
				return json(res, 200, { ok: true });
			}
			// A new lesson takes over the tutor on screen when it's idle. One that's
			// working carries on in the background, and the new lesson gets its own.
			case "POST /api/new":
				if (working(t)) await show(spawnTutor());
				else await freshLesson(t);
				return json(res, 200, { ok: true });
			case "POST /api/side": {
				const { text } = await readBody(req);
				if (!text?.trim()) return json(res, 400, { error: "empty" });
				await askSide(text.trim());
				return json(res, 200, { ok: true });
			}
			case "POST /api/side/abort":
				await side?.call("abort");
				return json(res, 200, { ok: true });
			case "POST /api/side/clear":
				await resetSide();
				return json(res, 200, { ok: true });
			case "GET /api/files":
				return json(res, 200, { files: vault.search(url.searchParams.get("q") || "") });
			// Opening a lesson that's working in the background brings its tutor up;
			// otherwise it's the same choice as a new lesson.
			case "POST /api/open": {
				const { file } = await readBody(req);
				if (!lessons().some((s) => s.file === file)) return json(res, 404, { error: "unknown lesson" });
				const holder = [...tutors].find((x) => x.session.file === file);
				if (holder) await show(holder);
				else if (working(t)) await show(spawnTutor(file));
				else {
					await t.call("switch_session", { sessionPath: file });
					await loadLesson(t);
					await resetSide();
				}
				return json(res, 200, { ok: true });
			}
			// Edit one of the learner's messages: rewind the lesson to just before it,
			// in place, then send the new text. The old turns stay in the session tree.
			case "POST /api/edit": {
				const { entryId, text } = await readBody(req);
				if (!text?.trim()) return json(res, 400, { error: "empty" });
				if (!t.blocks.some((b) => b.kind === "user" && b.entryId === entryId)) return json(res, 404, { error: "That message isn't in this lesson." });
				if (working(t)) await stopTutor(t);
				await rewindTo(t, entryId);
				t.pending.clear();
				await loadLesson(t);
				await t.call("prompt", { message: text });
				return json(res, 200, { ok: true });
			}
			// Branch from a reply: pi copies everything before the learner's next
			// message into a new session; the old one stays, listed as the parent.
			case "POST /api/branch": {
				const { entryId } = await readBody(req);
				if (!t.blocks.some((b) => b.kind === "user" && b.entryId === entryId)) return json(res, 404, { error: "That message isn't in this lesson." });
				const { title, file } = t.session;
				if (working(t)) await stopTutor(t);
				const r = await t.call("fork", { entryId });
				if (r.cancelled) return json(res, 409, { error: "Branching was cancelled." });
				t.pending.clear();
				await loadLesson(t);
				t.session.parent ??= file;
				await keepTitle(t, title);
				return json(res, 200, { ok: true });
			}
			case "POST /api/fork": {
				const blocked = tutorBlocker(t);
				if (blocked) return json(res, 409, { error: blocked });
				if (!t.session.file || !existsSync(t.session.file)) return json(res, 409, { error: "Nothing to fork yet." });
				const { title } = t.session;
				const r = await t.call("clone");
				if (r.cancelled) return json(res, 409, { error: "Forking was cancelled." });
				await loadLesson(t);
				await keepTitle(t, title);
				return json(res, 200, { ok: true });
			}
		}
		// The page is read from disk on every load, so it can be newer than this
		// running server; an API it doesn't know means the server needs a restart.
		if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "The Learn server is older than this page. Restart it." });
		if (req.method !== "GET") return json(res, 404, { error: "not found" });
		if (url.pathname.startsWith("/vault/")) {
			const name = path.basename(decodeURIComponent(url.pathname.slice(7)));
			const file = vault.find(name);
			return file ? serveFile(res, file) : json(res, 404, { error: "not found" });
		}
		if (!existsSync(path.join(PUBLIC, "index.html"))) return json(res, 503, { error: "The UI isn't built yet. Run: npm run build" });
		const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
		const file = path.resolve(PUBLIC, rel);
		if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "forbidden" });
		return serveFile(res, file);
	} catch (err) {
		return json(res, err.status || 400, { error: err.message });
	}
}

http.createServer(handle).listen(PORT, HOST, async () => {
	console.log(`Learn server on http://localhost:${PORT} (vault: ${VAULT})`);
	await show(spawnTutor());
	console.log(`Learn ready at http://localhost:${PORT}`);
});
