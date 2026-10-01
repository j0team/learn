// Suggestions: /commands and @files for the composer's textarea.

import { type RefObject, useCallback, useRef, useState } from "react";
import { getJson, useStore } from "@/lib/store";
import { APP_COMMANDS } from "./commands";

export type SuggestItem =
	| { kind: "cmd"; name: string; hint: string; takesArgs: boolean; desc: string; group: string }
	| { kind: "file"; path: string; name: string; desc: string };

type At = { mode: "cmd" | "file"; query: string; start: number; end: number };
/** `items` null while the vault search is still out. */
export type Sug = At & { items: SuggestItem[] | null; hl: number };

// The token being completed at the caret, if any.
function completionAt(ta: HTMLTextAreaElement): At | null {
	const v = ta.value;
	const pos = ta.selectionStart;
	if (pos !== ta.selectionEnd) return null;
	const before = v.slice(0, pos);
	let m = /^\/(\S*)$/.exec(before);
	if (m) return { mode: "cmd", query: m[1], start: 0, end: pos + (/^\S*/.exec(v.slice(pos))?.[0].length ?? 0) };
	m = /(?:^|\s)@(?:"([^"]*)|([^\s"]*))$/.exec(before);
	if (m) {
		const quoted = m[1] !== undefined;
		const query = quoted ? m[1] : m[2];
		return { mode: "file", query, start: pos - query.length - (quoted ? 2 : 1), end: pos };
	}
	return null;
}

const SOURCE_GROUP: Record<string, string> = { app: "Learn", builtin: "Lesson", skill: "Skills" };
const ORDER = ["Learn", "Lesson", "Prompts", "Skills"];

function commandItems(query: string): SuggestItem[] {
	const q = query.toLowerCase();
	const all = [...APP_COMMANDS.map((c) => ({ ...c, source: "app" })), ...useStore.getState().commands];
	const rank = (c: { name: string; description: string }) =>
		c.name.startsWith(q) ? 0 : c.name.includes(q) ? 1 : c.description.toLowerCase().includes(q) ? 2 : -1;
	const group = (c: { source: string }) => SOURCE_GROUP[c.source] || "Prompts";
	return all
		.map((c) => [rank(c), c] as const)
		.filter(([r]) => r >= 0)
		.sort((a, b) => ORDER.indexOf(group(a[1])) - ORDER.indexOf(group(b[1])) || a[0] - b[0])
		.slice(0, 60)
		.map(([, c]) => ({ kind: "cmd", name: c.name, hint: c.hint === "arguments" ? "" : c.hint || "", takesArgs: !!c.hint, desc: c.description, group: group(c) }));
}

export function useSuggest(input: RefObject<HTMLTextAreaElement | null>) {
	const [sug, setSugState] = useState<Sug | null>(null);
	const ref = useRef<Sug | null>(null);
	const fileReq = useRef(0);
	const fileTimer = useRef(0);

	const setSug = useCallback((next: Sug | null) => {
		ref.current = next;
		setSugState(next);
	}, []);

	const close = useCallback(() => {
		fileReq.current++;
		setSug(null);
	}, [setSug]);

	const show = useCallback((next: (At & { items: SuggestItem[] | null }) | null) => (next?.mode ? setSug({ ...next, hl: 0 }) : close()), [setSug, close]);

	const update = useCallback(() => {
		const ta = input.current;
		const at = ta && completionAt(ta);
		if (!ta || !at || ta.disabled) return close();
		if (at.mode === "cmd") return show({ ...at, items: commandItems(at.query) });
		// Keep the old list up while the next one loads, so typing doesn't flicker.
		const prev = ref.current;
		if (prev?.mode === "file") ref.current = { ...prev, ...at };
		else show({ ...at, items: null });
		clearTimeout(fileTimer.current);
		const req = ++fileReq.current;
		fileTimer.current = window.setTimeout(async () => {
			const res = await getJson<{ files?: string[] }>(`/api/files?q=${encodeURIComponent(at.query)}`);
			if (req !== fileReq.current || ref.current?.mode !== "file") return;
			const items: SuggestItem[] = (res?.files || []).map((p) => {
				const i = p.lastIndexOf("/");
				return { kind: "file", path: p, name: p.slice(i + 1), desc: i > 0 ? p.slice(0, i) : "" };
			});
			const now = input.current && completionAt(input.current);
			show(now ? { ...now, items } : null);
		}, 60);
	}, [input, show, close]);

	const highlight = useCallback(
		(i: number) => {
			const s = ref.current;
			const n = s?.items?.length;
			if (!s || !n) return;
			setSug({ ...s, hl: (i + n) % n });
		},
		[setSug],
	);

	return { sug, ref, update, close, highlight };
}
