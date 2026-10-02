// One store for the lesson the server streams (`apply`) and the bits of UI state
// more than one component needs: panels, editing, Esc Esc rewind, the flash line.
// Components keep anything else (drafts, hover, menus) to themselves.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import type { AssistantBlock, Block, Command, Lessons, Op, QuizBlock, Session, SideBlock, Tuning, Usage } from "./types";

export const NARROW = "(max-width: 860px)";
export const narrowScreen = () => matchMedia(NARROW).matches;
/** Wide enough for worksheets to open beside the lesson (in the lesson they show as a bar). */
const WIDE = matchMedia("(min-width: 1080px)");
export const wideScreen = () => WIDE.matches;
const root = document.documentElement;

export type Flash = { msg: string; bad: boolean };
export type Rewind = { ids: string[]; i: number };

type State = {
	// From the server
	blocks: Block[];
	busy: boolean;
	busySince: number;
	session: Session;
	tuning: Tuning;
	usage: Usage;
	commands: Command[];
	side: { thread: SideBlock[]; busy: boolean };
	vault: string;
	connected: boolean;
	lessons: Lessons;
	/** Lessons whose tutor is working, on screen or in the background. */
	running: string[];

	// UI
	/** What's typed in the composer. */
	draft: string;
	sidebarOpen: boolean;
	sideOpen: boolean;
	/** The worksheet open beside the lesson (wide windows only). */
	quizOpen: string | null;
	settingsOpen: boolean;
	/** Open Settings scrolled to this field ("Set up providers"); Settings clears it. */
	settingsFocus: "provider-key" | null;
	/** Bumped when providers change, so the model picker refetches /api/models. */
	modelsVersion: number;
	modelPickerOpen: boolean;
	/** "Save to vault" folder picker. */
	saveOpen: boolean;
	/** The plan map, opened over everything. */
	planMapOpen: boolean;
	theme: "dark" | "light";
	/** The learner's message being edited in place. */
	editing: { id: string; text: string } | null;
	/** Esc Esc: walking back through the learner's own messages. */
	rewind: Rewind | null;
	flash: Flash | null;
	/** A lesson row whose ⋯ menu is open; `confirm` jumps straight to the delete question. */
	lessonMenu: { file: string; confirm: boolean } | null;
};

export const useStore = create<State>(() => ({
	blocks: [],
	busy: false,
	busySince: 0,
	session: { file: null, title: "" },
	tuning: { model: null, thinking: "", levels: [] },
	usage: null,
	commands: [],
	side: { thread: [], busy: false },
	vault: "",
	connected: true,
	lessons: { sessions: [], archived: [] },
	running: [],

	draft: "",
	sidebarOpen: root.dataset.sidebar !== "closed",
	sideOpen: root.dataset.side === "open",
	quizOpen: null,
	settingsOpen: false,
	settingsFocus: null,
	modelsVersion: 0,
	modelPickerOpen: false,
	saveOpen: false,
	planMapOpen: false,
	theme: root.dataset.theme === "light" ? "light" : "dark",
	editing: null,
	rewind: null,
	flash: null,
	lessonMenu: null,
}));

const set = useStore.setState;
const get = useStore.getState;

/** Text fields other components focus (registered by the component that owns them). */
export const refs: { input: HTMLTextAreaElement | null; sideInput: HTMLTextAreaElement | null } = { input: null, sideInput: null };
export const focusComposer = () => refs.input?.focus();
/** Shared layout elements: the lesson's scroll container (transcript or home). */
export const layout: { scroller: HTMLDivElement | null } = { scroller: null };

// ─── Derived ────────────────────────────────────────────────────────────────

/** A worksheet or question waiting on the learner (the composer locks meanwhile). */
export const openCard = (blocks: Block[]) => blocks.some((b) => (b.kind === "quiz" || b.kind === "ask") && b.state === "pending");

const onWide = (change: () => void) => {
	WIDE.addEventListener("change", change);
	return () => WIDE.removeEventListener("change", change);
};
export const useWide = () => useSyncExternalStore(onWide, () => WIDE.matches);

/** The worksheet open beside the lesson, or undefined. */
export function useOpenQuiz() {
	const wide = useWide();
	return useStore((s) => (wide && s.quizOpen ? s.blocks.find((b): b is QuizBlock => b.kind === "quiz" && b.id === s.quizOpen) : undefined));
}

// ─── Server ops ─────────────────────────────────────────────────────────────

const replace = (blocks: Block[], b: Block) => blocks.map((x) => (x.id === b.id ? b : x));
const mapAssistant = (blocks: Block[], id: string, fn: (b: AssistantBlock) => AssistantBlock) =>
	blocks.map((x) => (x.id === id && x.kind === "assistant" ? fn(x) : x));

export function apply(op: Op) {
	switch (op.op) {
		case "snapshot":
			set((s) => ({
				blocks: op.blocks,
				busy: op.busy,
				busySince: op.busySince || (op.busy ? Date.now() : 0),
				session: op.session,
				vault: op.vault || s.vault,
				tuning: op.tuning || s.tuning,
				usage: op.usage,
				commands: op.commands || [],
				running: op.running || [],
				side: op.side || { thread: [], busy: false },
				editing: null,
				rewind: null,
				saveOpen: false,
				// Block ids repeat across lessons; another lesson starts with nothing open.
				quizOpen: op.session.file === s.session.file ? s.quizOpen : null,
			}));
			loadLessons();
			return;
		case "add":
			return set((s) => ({ blocks: [...s.blocks, op.block] }));
		case "patch":
			return set((s) => (s.blocks.some((b) => b.id === op.block.id) ? { blocks: replace(s.blocks, op.block) } : {}));
		case "part":
			return set((s) => ({
				blocks: mapAssistant(s.blocks, op.id, (b) => {
					const parts = [...b.parts];
					parts[op.index] = op.part;
					return { ...b, parts };
				}),
			}));
		case "delta":
			return set((s) => ({
				blocks: mapAssistant(s.blocks, op.id, (b) => {
					if (!b.parts[op.index]) return b;
					const parts = [...b.parts];
					parts[op.index] = { ...parts[op.index], text: parts[op.index].text + op.text };
					return { ...b, parts };
				}),
			}));
		case "tuning":
			return set({ tuning: op.tuning });
		case "usage":
			return set({ usage: op.usage });
		case "commands":
			return set({ commands: op.commands });
		case "tokens":
			return set((s) => ({ blocks: mapAssistant(s.blocks, op.id, (b) => ({ ...b, outTokens: op.n })) }));
		case "drafting":
			return set((s) => ({ blocks: mapAssistant(s.blocks, op.id, (b) => ({ ...b, drafting: op.what })) }));
		case "sideBlock":
			return set((s) => {
				const t = s.side.thread;
				const thread = t.some((b) => b.id === op.block.id) ? t.map((b) => (b.id === op.block.id ? op.block : b)) : [...t, op.block];
				return { side: { ...s.side, thread } };
			});
		case "sideDelta":
			return set((s) => ({
				side: { ...s.side, thread: s.side.thread.map((b) => (b.id === op.id && b.kind === "assistant" ? { ...b, text: b.text + op.text } : b)) },
			}));
		case "sideBusy":
			return set((s) => ({ side: { ...s.side, busy: op.busy } }));
		case "sideReset":
			return set({ side: { thread: [], busy: false } });
		case "busy":
			set({ busy: op.busy, busySince: op.since || (op.busy ? Date.now() : 0) });
			if (op.busy) set({ modelPickerOpen: false, saveOpen: false });
			else loadLessons();
			return;
		case "session":
			set({ session: op.session });
			loadLessons();
			return;
		case "running":
			set({ running: op.files });
			loadLessons();
			return;
	}
}

export function connect() {
	const es = new EventSource("/api/events");
	es.onopen = () => set({ connected: true });
	es.onmessage = (e) => apply(JSON.parse(e.data));
	es.onerror = () => set({ connected: false });
	return () => es.close();
}

// ─── Requests ───────────────────────────────────────────────────────────────

let flashTimer = 0;
/** A message in the composer's hint line for a few seconds (red unless `bad` is false). */
export function flash(msg: string, bad = true) {
	clearTimeout(flashTimer);
	set({ flash: { msg, bad } });
	flashTimer = window.setTimeout(() => set({ flash: null }), 4000);
}

/** The server's JSON reply: a GET, or a POST when there's a body. Throws the server's error message. */
export async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<T> {
	const init = body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
	const r = await fetch(url, init);
	const res = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(res.error || r.statusText);
	return res as T;
}

/** A GET that resolves to null when it fails. */
export const getJson = <T>(url: string) => api<T>(url).catch(() => null);

/** Resolves to the response body (truthy) on success, false after flashing the error. */
export async function post<T = Record<string, unknown>>(url: string, body: unknown = {}): Promise<T | false> {
	try {
		return await api<T>(url, body);
	} catch (err) {
		// fetch itself rejects with a TypeError when the server is down.
		flash(err instanceof TypeError ? "Can't reach the Learn server" : (err as Error).message || "Something went wrong");
		return false;
	}
}

// End of turn sends `busy` and `running` back to back; fetch once, then once more
// if anything asked again meanwhile.
let lessonsLoad: Promise<void> | null = null;
let lessonsStale = false;

export function loadLessons(): Promise<void> {
	if (lessonsLoad) {
		lessonsStale = true;
		return lessonsLoad;
	}
	lessonsLoad = (async () => {
		do {
			lessonsStale = false;
			const lessons = await getJson<Lessons>("/api/sessions");
			if (lessons) set({ lessons, lessonMenu: null });
		} while (lessonsStale);
	})().finally(() => {
		lessonsLoad = null;
	});
	return lessonsLoad;
}

// ─── Panels ─────────────────────────────────────────────────────────────────

export function setSidebar(open: boolean) {
	if (open) delete root.dataset.sidebar;
	else root.dataset.sidebar = "closed";
	localStorage.setItem("learn-sidebar", open ? "open" : "closed");
	set({ sidebarOpen: open });
}
/** After picking something in the sidebar on a phone, get the drawer out of the way. */
export const closeDrawerOnNarrow = () => narrowScreen() && setSidebar(false);

export function setSide(open: boolean) {
	if (open) root.dataset.side = "open";
	else delete root.dataset.side;
	localStorage.setItem("learn-side", open ? "open" : "closed");
	set({ sideOpen: open });
}

export const setQuizOpen = (id: string | null) => set({ quizOpen: id });

export async function askSide(text: string) {
	if (!text.trim() || get().side.busy) return false;
	return !!(await post("/api/side", { text }));
}

/** Open the side chat; with a question, ask it straight away. */
export function openSide(question = "") {
	setSide(true);
	if (question) askSide(question);
	else requestAnimationFrame(() => refs.sideInput?.focus());
}

export function toggleSide() {
	const open = !get().sideOpen;
	setSide(open);
	if (open) requestAnimationFrame(() => refs.sideInput?.focus());
}

export const setSettings = (open: boolean) => set({ settingsOpen: open });
export const setPlanMap = (open: boolean) => set({ planMapOpen: open });
export const setModelPicker = (open: boolean) => set({ modelPickerOpen: open && !get().busy });

export function toggleTheme() {
	const next = get().theme === "dark" ? "light" : "dark";
	root.dataset.theme = next;
	localStorage.setItem("learn-theme", next);
	set({ theme: next });
}

// ─── Lesson actions ─────────────────────────────────────────────────────────

export function setDraft(draft: string) {
	set({ draft });
}

export function newLesson() {
	post("/api/new");
	closeDrawerOnNarrow();
	focusComposer();
}

/** Home is the blank page a new lesson opens on; from there, already home. */
export function goHome() {
	if (get().blocks.length) newLesson();
	else closeDrawerOnNarrow();
}

export async function sendPrompt(text: string) {
	const ok = await post("/api/prompt", { text });
	if (ok && get().draft === text) set({ draft: "" });
	return !!ok;
}

/** "Save to vault" asks for the folder first (last time's filled in). */
export function saveLesson() {
	const s = get();
	if (s.busy) return flash("Wait for the tutor to finish first");
	if (!s.blocks.some((b) => b.kind === "assistant")) return flash("Nothing to save yet");
	set({ saveOpen: true });
}
export const closeSave = () => set({ saveOpen: false });
/** The tutor writes the note into `folder`, which becomes next time's default. */
export async function saveTo(folder: string) {
	const ok = !!(await post("/api/save", { folder }));
	if (ok) closeSave();
	return ok;
}

export function setThinking(level: string) {
	const { levels } = get().tuning;
	if (!levels.includes(level)) return flash(`Thinking levels: ${levels.join(", ")}`);
	post("/api/thinking", { level });
}

export async function archiveLesson(file: string) {
	set({ lessonMenu: null });
	if (await post("/api/archive", { file })) {
		flash("Archived. It's at the bottom of the sidebar", false);
		loadLessons();
	}
}

export async function restoreLesson(file: string, open: boolean) {
	set({ lessonMenu: null });
	const r = await post<{ file: string }>("/api/restore", { file });
	if (!r) return;
	if (open) await post("/api/open", { file: r.file });
	loadLessons();
}

export async function deleteLesson(file: string, branches: boolean) {
	set({ lessonMenu: null });
	if (await post("/api/delete", { file, branches })) {
		flash("Deleted", false);
		loadLessons();
	}
}

/** Shows the new name straight away; the list reloads (and reverts) if the server says no. */
export async function renameLesson(file: string, title: string) {
	const name = title.trim();
	const rename = (list: Lessons["sessions"]) => list.map((s) => (s.file === file ? { ...s, title: name } : s));
	set((s) => ({ lessons: { ...s.lessons, sessions: rename(s.lessons.sessions), archived: rename(s.lessons.archived) } }));
	await post("/api/rename", { file, title: name });
	loadLessons();
}

export const setLessonMenu = (menu: State["lessonMenu"]) => set({ lessonMenu: menu });

/** Same confirmation as the sidebar menu, opened on the current lesson's row. */
export function deleteCurrent() {
	const { lessons, session } = get();
	if (!session.file || !lessons.sessions.some((s) => s.file === session.file)) return flash("Nothing to delete yet");
	setSidebar(true);
	set({ lessonMenu: { file: session.file, confirm: true } });
}

// ─── Editing and branching ──────────────────────────────────────────────────
// Editing rewrites the lesson in place from that message on (the old turns stay
// in the session file's tree, like the terminal's /tree). Branch and fork make a
// new lesson and leave this one untouched in the sidebar.

export function startEdit(id: string) {
	exitRewind();
	const b = get().blocks.find((x) => x.id === id);
	if (b?.kind !== "user" || !b.entryId) return;
	set({ editing: { id, text: b.text } });
}

export const setEditText = (text: string) => set((s) => (s.editing ? { editing: { ...s.editing, text } } : {}));
export const cancelEdit = () => set({ editing: null });

export async function submitEdit() {
	const { editing, blocks } = get();
	const b = blocks.find((x) => x.id === editing?.id);
	if (!editing || b?.kind !== "user" || !editing.text.trim()) return;
	// Cleared first: the snapshot that follows a successful edit may reuse this block id.
	set({ editing: null });
	if (!(await post("/api/edit", { entryId: b.entryId, text: editing.text })) && get().blocks.some((x) => x.id === b.id)) set({ editing });
}

export async function forkLesson() {
	if (await post("/api/fork")) flash("Forked. The original is in the sidebar", false);
}

/** Keep everything up to this reply in a new lesson: branch at the learner's next
 *  message, or copy the whole lesson when the reply is the latest one. */
export async function branchAfter(id: string) {
	const { blocks } = get();
	const i = blocks.findIndex((b) => b.id === id);
	const next = blocks.slice(i + 1).find((b) => b.kind === "user" && b.entryId);
	if (next?.kind !== "user") return forkLesson();
	if (await post("/api/branch", { entryId: next.entryId })) {
		focusComposer();
		flash("New branch from that reply. The original is in the sidebar", false);
	}
}

// Esc Esc: walk back through your own messages, Enter to edit from one.
export function startRewind() {
	const ids = get()
		.blocks.filter((b) => b.kind === "user" && b.entryId)
		.map((b) => b.id);
	if (!ids.length) return flash("No messages to go back to yet");
	clearTimeout(flashTimer);
	root.dataset.rewind = "on";
	set({ rewind: { ids, i: ids.length - 1 }, flash: null });
}

export function pickRewind(step: number) {
	const r = get().rewind;
	if (r) set({ rewind: { ...r, i: Math.max(0, Math.min(r.ids.length - 1, r.i + step)) } });
}

export function exitRewind() {
	if (!get().rewind) return;
	delete root.dataset.rewind;
	set({ rewind: null });
}

// ─── Settings focus and the model list (composer ↔ settings) ───────────────
// "Set up providers" in the model picker (and onboarding) open Settings on the
// API key field; Settings honours `settingsFocus` and clears it. Adding or
// removing a provider bumps `modelsVersion` so the picker refetches /api/models.

export function openSettings(focus: State["settingsFocus"] = null) {
	set({ settingsFocus: focus, settingsOpen: true });
}
export const clearSettingsFocus = () => set({ settingsFocus: null });
export const invalidateModels = () => set((s) => ({ modelsVersion: s.modelsVersion + 1 }));
