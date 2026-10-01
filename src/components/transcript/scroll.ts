import { flushSync } from "react-dom";
import { layout } from "@/lib/store";

/** Within 160px of the bottom: new content keeps the view pinned there. */
export function nearBottom() {
	const s = layout.scroller;
	return !!s && s.scrollHeight - s.scrollTop - s.clientHeight < 160;
}

/** A block's element in the transcript. */
export const blockEl = (id: string) => layout.scroller?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`) ?? null;

export function toBottom() {
	const s = layout.scroller;
	if (s) s.scrollTop = s.scrollHeight;
}

/** Run a DOM change; if the view was at the bottom before it, keep it there after. */
export function stickToBottom(fn: () => void) {
	const stick = nearBottom();
	fn();
	if (stick) toBottom();
}

// Streaming text re-renders at most once per frame per message.
const dirty = new Map<string, () => void>();
let frame = 0;

/** Queue `run` (a state update) for the next frame; a later call with the same key replaces it. */
export function scheduleFrame(key: string, run: () => void) {
	dirty.set(key, run);
	if (frame) return;
	frame = requestAnimationFrame(() => {
		frame = 0;
		const runs = [...dirty.values()];
		dirty.clear();
		stickToBottom(() => flushSync(() => runs.forEach((r) => r())));
	});
}
