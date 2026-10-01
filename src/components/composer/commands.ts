import {
	archiveLesson,
	deleteCurrent,
	flash,
	forkLesson,
	newLesson,
	openSide,
	saveLesson,
	sendPrompt,
	setDraft,
	setModelPicker,
	setSettings,
	setThinking,
	startRewind,
	toggleTheme,
	useStore,
} from "@/lib/store";

export type AppCommand = { name: string; hint?: string; description: string; run: (arg: string) => unknown };

// Commands the app handles itself; everything else starting with "/" goes to pi.
export const APP_COMMANDS: AppCommand[] = [
	{ name: "new", description: "Start a new lesson", run: () => newLesson() },
	{ name: "save", description: "Write this lesson up as a note in your vault", run: () => saveLesson() },
	{ name: "side", hint: "[question]", description: "Open the side chat, optionally asking right away", run: (arg) => openSide(arg) },
	{ name: "model", description: "Pick the tutor's model", run: () => setModelPicker(true) },
	{ name: "thinking", hint: "<level>", description: "Set the thinking level (off, low, medium, high…)", run: (arg) => setThinking(arg) },
	{ name: "theme", description: "Switch between dark and light", run: () => toggleTheme() },
	{ name: "edit", description: "Pick one of your earlier messages to edit and redo from there (Esc Esc)", run: () => startRewind() },
	{ name: "fork", description: "Copy this lesson into a new one and carry on there", run: () => forkLesson() },
	{ name: "settings", description: "Theme and keyboard shortcuts", run: () => setSettings(true) },
	{
		name: "archive",
		description: "Archive this lesson (and its branches)",
		run: () => {
			const file = useStore.getState().session.file;
			return file ? archiveLesson(file) : flash("Nothing to archive yet");
		},
	},
	{ name: "delete", description: "Delete this lesson (asks first)", run: () => deleteCurrent() },
];

/** Send what's typed: app commands run here, the rest goes to the tutor.
 *  `clear` empties the composer (and its suggestions) once it's been taken. */
export async function sendMessage(text: string, clear: () => void) {
	if (!text.trim()) return;
	const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
	const app = m && APP_COMMANDS.find((c) => c.name === m[1]);
	if (app) {
		setDraft("");
		clear();
		return app.run((m[2] || "").trim());
	}
	// sendPrompt empties the draft only if it still holds what was sent.
	if ((await sendPrompt(text)) && !useStore.getState().draft) clear();
}
