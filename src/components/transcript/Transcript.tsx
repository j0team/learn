import { Fragment, useEffect, useLayoutEffect, useMemo } from "react";
import { progressAt, stageText, useProgressMarks } from "@/components/outline/progress";
import { PlanCard } from "@/components/plan/PlanMap";
import { exitRewind, openCard, pickRewind, post, refs, startEdit, startRewind, useStore, wideScreen } from "@/lib/store";
import { cn } from "@/lib/utils";
import { BlockView, sentEdit } from "./blocks";
import { blockEl, nearBottom, toBottom } from "./scroll";

const get = useStore.getState;

// ─── Transcript sync ────────────────────────────────────────────────────────
// Measured as the store changes, before React touches the DOM: was the view at
// the bottom (stay pinned after the update), did a snapshot arrive (go to the
// bottom), did a worksheet or question just arrive (scroll it into view).
// Blocks added live rise in; a snapshot renders still.

const live = new Set<string>();
let measured = false;
let stick = false;
let snapped = false;
let jumpTo: string | null = null;

useStore.subscribe((s, prev) => {
	if (s.blocks === prev.blocks) return;
	if (!measured) {
		measured = true;
		stick = nearBottom();
	}
	if (s.session !== prev.session) {
		live.clear();
		snapped = true;
		jumpTo = null;
		return;
	}
	if (s.blocks.length <= prev.blocks.length) return;
	const b = s.blocks[s.blocks.length - 1];
	// A reply arrives empty and shows once it has text, without rising.
	if (b.kind !== "assistant" || b.parts.some((p) => p?.type === "text" && p.text.trim())) live.add(b.id);
	if (b.kind === "ask" || (b.kind === "quiz" && !wideScreen())) jumpTo = b.id;
});


export function Transcript() {
	const blocks = useStore((s) => s.blocks);
	const busy = useStore((s) => s.busy);
	const editing = useStore((s) => s.editing);
	const rewind = useStore((s) => s.rewind);

	// A fresh transcript opens at the bottom.
	useLayoutEffect(toBottom, []);
	useLayoutEffect(() => {
		if (measured && (stick || snapped)) toBottom();
		if (jumpTo) blockEl(jumpTo)?.scrollIntoView({ block: "start", behavior: "smooth" });
		measured = stick = snapped = false;
		jumpTo = null;
	}, [blocks]);

	const picked = rewind?.ids[rewind.i];
	useEffect(() => {
		if (picked) blockEl(picked)?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [rewind, picked]);

	// The message being edited, or whose edit is on its way.
	const sent = !editing && sentEdit?.blocks === blocks ? sentEdit : null;
	const edit = editing || sent;
	const editAt = edit ? blocks.findIndex((b) => b.id === edit.id) : -1;

	// Branch/fork actions belong on the last reply of each finished turn; the
	// latest turn gets "Fork" (nothing after it to leave behind), earlier ones "Branch from here".
	const turnEnds = new Map<string, "last" | "">();
	let open = true;
	let latest = true;
	let working = busy;
	for (let i = blocks.length - 1; i >= 0; i--) {
		const b = blocks[i];
		if (b.kind === "user") {
			open = true;
			latest = working = false;
			continue;
		}
		if (b.kind !== "assistant" || !b.parts.some((p) => p?.type === "text" && p.text.trim())) continue;
		if (open && !working && b.done) turnEnds.set(b.id, latest ? "last" : "");
		open = false;
	}

	// The map sits under the marker where the current plan was presented, and shows live progress.
	const marks = useProgressMarks();
	const progress = useMemo(() => progressAt(marks), [marks]);
	const planAt = marks.findLast((b) => b.steps?.length)?.id;

	return (
		<div
			id="transcript"
			className="mx-auto w-[min(var(--measure),100%_-_64px)] pt-6 pb-[calc(var(--dock-h,140px)_+_40px)] working:pb-[calc(var(--dock-h,140px)_+_88px)] narrow:w-[calc(100%_-_32px)] [&_.prose>:is(h1,h2,h3)]:scroll-mt-5"
		>
			{blocks.map((b, i) => (
				<Fragment key={b.id}>
					<BlockView
						block={b}
						cls={cn(
							"mt-0 mb-7 scroll-mt-5 [transition:opacity_200ms]",
							live.has(b.id) && "animate-rise",
							// Esc Esc: the picked message stands out, the rest of the lesson steps back.
							// Editing: what the edit will replace dims below it.
							((rewind && b.id !== picked) || (editAt >= 0 && i > editAt)) && "opacity-35",
						)}
						turnEnd={turnEnds.get(b.id)}
						edit={edit?.id === b.id ? { text: edit.text, sent: !!sent } : undefined}
						picked={b.id === picked}
						stage={b.kind === "progress" ? stageText(progressAt(marks, b)!) : undefined}
					/>
					{b.id === planAt && progress && <PlanCard p={progress} />}
				</Fragment>
			))}
		</div>
	);
}

// ─── Esc: stop, and Esc Esc rewind ──────────────────────────────────────────

/** Installs the transcript's document keys; returns a cleanup. */
export function installRewindKeys() {
	let lastEsc = 0;
	// Capture phase, so the composer's own Enter/arrow handling never sees these keys.
	const capture = (e: KeyboardEvent) => {
		const { rewind } = get();
		if (!rewind || e.isComposing) return;
		const keys: Record<string, () => void> = {
			ArrowUp: () => pickRewind(-1),
			ArrowDown: () => pickRewind(1),
			Enter: () => startEdit(rewind.ids[rewind.i]),
			Escape: exitRewind,
		};
		if (!keys[e.key]) return;
		e.preventDefault();
		e.stopPropagation();
		keys[e.key]();
	};
	// Bubble phase: an Esc that closed suggestions or a picker already called preventDefault.
	const bubble = (e: KeyboardEvent) => {
		const { rewind, busy, blocks, draft } = get();
		if (e.key !== "Escape" || e.defaultPrevented || rewind) return;
		const target = e.target as Element;
		// Esc in a dialog (settings) closes the dialog, nothing else.
		if (target.closest('dialog, [role="dialog"]')) return;
		// Other text fields (quiz answers, side chat, model search) keep Esc to themselves.
		if (target !== refs.input && target.closest("input, textarea, select, [contenteditable]")) return;
		// While the tutor works, Esc stops it (not while a card waits on the learner).
		if (busy && !openCard(blocks)) {
			e.preventDefault();
			lastEsc = 0;
			post("/api/abort");
			return;
		}
		if (draft.trim()) return;
		if (e.timeStamp - lastEsc < 600) {
			lastEsc = 0;
			startRewind();
		} else lastEsc = e.timeStamp;
	};
	const pointer = (e: PointerEvent) => {
		if (get().rewind && !(e.target as Element).closest(".turn-actions")) exitRewind();
	};
	document.addEventListener("keydown", capture, true);
	document.addEventListener("keydown", bubble);
	document.addEventListener("pointerdown", pointer);
	return () => {
		document.removeEventListener("keydown", capture, true);
		document.removeEventListener("keydown", bubble);
		document.removeEventListener("pointerdown", pointer);
	};
}
