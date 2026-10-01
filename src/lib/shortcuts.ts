// Shortcuts are stored as "Ctrl+Alt+Shift+Meta+<KeyboardEvent.code>" (only the
// modifiers held), matched on code so they work on any keyboard layout. Defaults
// use ⌘ on a Mac and Ctrl elsewhere, leaving Option free for typing characters
// like é and ∑, and skip the combos browsers keep for themselves (⌘N, ⌘T, ⌘W).

import { create } from "zustand";
import { forkLesson, newLesson, setModelPicker, setSettings, setSidebar, startRewind, toggleSide, toggleTheme, useStore } from "./store";

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const mod = (code: string, shift = false) => (IS_MAC ? `${shift ? "Shift+" : ""}Meta+${code}` : `Ctrl+${shift ? "Shift+" : ""}${code}`);

export type ShortcutId = "new" | "side" | "sidebar" | "edit" | "model" | "fork" | "theme" | "settings";
export type Shortcut = { id: ShortcutId; label: string; keys: string; run: () => void };

const get = useStore.getState;

export const SHORTCUTS: Shortcut[] = [
	{ id: "new", label: "New lesson", keys: mod("KeyO", true), run: () => newLesson() },
	{ id: "side", label: "Open or hide the side chat", keys: mod("KeyS", true), run: () => toggleSide() },
	{ id: "sidebar", label: "Show or hide the lessons list", keys: mod("KeyB"), run: () => setSidebar(!get().sidebarOpen) },
	{ id: "edit", label: "Edit an earlier message", keys: mod("KeyE", true), run: () => startRewind() },
	{ id: "model", label: "Pick a model", keys: mod("KeyK"), run: () => setModelPicker(!get().modelPickerOpen) },
	{ id: "fork", label: "Fork this lesson", keys: "", run: () => forkLesson() },
	{ id: "theme", label: "Switch dark / light", keys: mod("KeyD", true), run: () => toggleTheme() },
	{ id: "settings", label: "Open settings", keys: mod("Comma"), run: () => setSettings(!get().settingsOpen) },
];

export const FIXED_KEYS: [label: string, keys: string][] = [
	["Send", "Enter"],
	["New line", "Shift+Enter"],
	["Stop the tutor", "Escape"],
	["Go back and edit a message", "Escape Escape"],
	["Commands and skills", "/"],
	["Attach a vault file", "@"],
];

export type Keymap = Record<ShortcutId, string>;

function loadKeymap(): Keymap {
	let saved: Partial<Keymap> = {};
	try {
		saved = JSON.parse(localStorage.getItem("learn-keys") || "{}");
	} catch {}
	return Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.id in saved ? saved[s.id] : s.keys])) as Keymap;
}

function saveKeymap(keymap: Keymap) {
	const changed = Object.fromEntries(SHORTCUTS.filter((s) => keymap[s.id] !== s.keys).map((s) => [s.id, keymap[s.id]]));
	localStorage.setItem("learn-keys", JSON.stringify(changed));
}

/** The keymap, the shortcut waiting for new keys, and the editor's note (a warning when set). */
export const useKeymap = create<{ keymap: Keymap; capturing: ShortcutId | null; note: string }>(() => ({
	keymap: loadKeymap(),
	capturing: null,
	note: "",
}));
const setKeys = useKeymap.setState;

/** Start (or, on the same shortcut, stop) listening for new keys. */
export const toggleCapture = (id: ShortcutId) => setKeys((s) => ({ capturing: s.capturing === id ? null : id, note: "" }));
export const stopCapture = () => setKeys({ capturing: null, note: "" });

export function resetKeymap() {
	localStorage.removeItem("learn-keys");
	setKeys({ keymap: Object.fromEntries(SHORTCUTS.map((s) => [s.id, s.keys])) as Keymap, capturing: null, note: "" });
}

export function comboOf(e: KeyboardEvent) {
	const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
	return [...mods, e.code].join("+");
}

const CODE_LABELS: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`", Space: "Space", Enter: "Enter", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
const MOD_LABELS: Record<string, string> = IS_MAC ? { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" } : { Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" };

export function keyLabel(part: string) {
	return MOD_LABELS[part] || CODE_LABELS[part] || part.replace(/^Key|^Digit|^Numpad/, "");
}

/** A combo as one compact label, e.g. "⇧⌘S" (or "Ctrl+Shift+S"). */
export const comboLabel = (combo: string) => combo.split("+").map(keyLabel).join(IS_MAC ? "" : "+");

/** The tooltip suffix for a shortcut's button, e.g. " (⇧⌘S)", or "" when unset. */
export function useShortcutHint(id: ShortcutId) {
	const keys = useKeymap((s) => s.keymap[id]);
	return keys ? ` (${comboLabel(keys)})` : "";
}

// While a shortcut is being changed, the next chord goes to it and nowhere else.
function capture(e: KeyboardEvent) {
	const { capturing, keymap } = useKeymap.getState();
	if (!capturing || e.isComposing) return;
	e.preventDefault();
	e.stopPropagation();
	const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
	if (e.key === "Escape" && plain && !e.shiftKey) return stopCapture();
	if ((e.key === "Backspace" || e.key === "Delete") && plain) {
		const next = { ...keymap, [capturing]: "" };
		saveKeymap(next);
		return setKeys({ keymap: next, capturing: null, note: "" });
	}
	if (/^(Control|Alt|Shift|Meta|OS)/.test(e.code)) return; // still holding modifiers
	// Plain keys would fire while typing; F-keys are the exception.
	if (plain && !/^F\d{1,2}$/.test(e.code)) return setKeys({ note: `Hold ${IS_MAC ? "⌘ or ⌃" : "Ctrl"} with the key, so it doesn't fire while you type.` });
	const combo = comboOf(e);
	const other = SHORTCUTS.find((s) => s.id !== capturing && keymap[s.id] === combo);
	const next = { ...keymap, ...(other && { [other.id]: "" }), [capturing]: combo };
	saveKeymap(next);
	const notes = [];
	if (other) notes.push(`That was the shortcut for "${other.label}", which is now unset.`);
	if (IS_MAC && e.altKey && !e.metaKey && !e.ctrlKey) notes.push("Heads up: while it's set, ⌥ with that key won't type its character.");
	setKeys({ keymap: next, capturing: null, note: notes.join(" ") });
}

// Run a shortcut from anywhere, including while typing in the composer.
function run(e: KeyboardEvent) {
	const { capturing, keymap } = useKeymap.getState();
	if (capturing || e.isComposing || e.repeat) return;
	if (!e.ctrlKey && !e.altKey && !e.metaKey && !/^F\d{1,2}$/.test(e.code)) return;
	const combo = comboOf(e);
	const s = SHORTCUTS.find((x) => keymap[x.id] && keymap[x.id] === combo);
	if (!s || (get().settingsOpen && s.id !== "settings")) return;
	e.preventDefault();
	s.run();
}

/** Installs the global keyboard shortcuts; returns a cleanup. */
export function installShortcuts() {
	document.addEventListener("keydown", capture, true);
	document.addEventListener("keydown", run);
	return () => {
		document.removeEventListener("keydown", capture, true);
		document.removeEventListener("keydown", run);
	};
}
