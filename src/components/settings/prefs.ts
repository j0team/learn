// Fonts and lesson width: stored only when they differ from the default, so a
// changed default reaches everyone who never picked. Mirrored to <html data-*>,
// which index.css reads (index.html applies the saved ones before first paint).

import { create } from "zustand";

export const FONTS: [id: string, label: string][] = [
	["geist", "Geist"],
	["inter", "Inter"],
	["system", "System"],
	["source-serif", "Source Serif"],
	["literata", "Literata"],
	["code-new-roman", "Code New Roman"],
];
export const PREF_DEFAULTS = { uiFont: "geist", readFont: "source-serif", width: "" };
export type PrefKey = keyof typeof PREF_DEFAULTS;

const root = document.documentElement;
const read = (): Record<PrefKey, string> => ({
	uiFont: root.dataset.uiFont || PREF_DEFAULTS.uiFont,
	readFont: root.dataset.readFont || PREF_DEFAULTS.readFont,
	width: root.dataset.width || PREF_DEFAULTS.width,
});

/** The current fonts and width; subscribe to redraw on a change (diagrams on uiFont, the outline on width). */
export const usePrefs = create(read);

export function setPref(key: PrefKey, value: string) {
	if (value && value !== PREF_DEFAULTS[key]) {
		root.dataset[key] = value;
		localStorage.setItem(`learn-${key}`, value);
	} else {
		delete root.dataset[key];
		localStorage.removeItem(`learn-${key}`);
	}
	usePrefs.setState(read());
}
