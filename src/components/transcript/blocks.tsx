import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/lib/markdown";
import { branchAfter, cancelEdit, focusComposer, forkLesson, setEditText, startEdit, submitEdit, useStore } from "@/lib/store";
import type { AssistantBlock, Block, NoteBlock, OutputBlock, ToolBlock, UserBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ansiToHtml } from "./ansi";
import { AskCard } from "./cards/AskCard";
import { QuizCard } from "./cards/QuizCard";
import { scheduleFrame } from "./scroll";

const ICON_FILE = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5h5.5L15 7v9.5H6z M11 3.5V7.5h4" /></svg>;
const ICON_SKILL = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5l1.8 4.2 4.2 1.8-4.2 1.8L10 15.5l-1.8-4.2L4 9.5l4.2-1.8z" /></svg>;
const ICON_EDIT = <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.6 4.9l2.5 2.5-7.6 7.6-3.1.6.6-3.1z" /></svg>;
const ICON_BRANCH = (
	<svg viewBox="0 0 20 20" aria-hidden="true">
		<circle cx="6.5" cy="5" r="1.6" />
		<circle cx="6.5" cy="15" r="1.6" />
		<circle cx="13.5" cy="6.5" r="1.6" />
		<path d="M6.5 6.6v6.8M13.5 8.1c0 3.2-3.8 3.4-6.3 5.2" />
	</svg>
);

/** How the transcript shows a block right now (all primitives, so memo holds). */
export type BlockProps = {
	block: Block;
	/** Shared `.block` classes: margin, scroll margin, rise when added live, dimming. */
	cls: string;
	/** Assistant replies that end a finished turn: "last" for the latest turn, "" before it. */
	turnEnd?: "last" | "";
	/** The learner's message being edited here; `sent` while the edit is on its way. */
	edit?: { text: string; sent: boolean };
	/** Esc Esc picked this message. */
	picked?: boolean;
	/** Stage marker text (progress blocks). */
	stage?: string;
};

export const BlockView = memo(function BlockView(p: BlockProps) {
	const { block: b, cls } = p;
	switch (b.kind) {
		case "user":
			return p.edit ? <EditBox block={b} cls={cls} text={p.edit.text} sent={p.edit.sent} /> : <UserTurn block={b} cls={cls} picked={!!p.picked} />;
		case "assistant":
			return <AssistantTurn block={b} cls={cls} turnEnd={p.turnEnd} />;
		case "tool":
			return <ToolRow block={b} cls={cls} />;
		case "quiz":
			return <QuizCard block={b} className={cls} />;
		case "ask":
			return <AskCard block={b} className={cls} />;
		case "error":
			return (
				<div data-block-id={b.id} className={cn(cls, errorBox)}>
					{b.text}
				</div>
			);
		case "note":
			return <Note block={b} cls={cls} />;
		case "progress":
			return <StageMarker id={b.id} phase={b.phase} cls={cls} text={p.stage ?? ""} />;
		case "output":
			return <Output block={b} cls={cls} />;
	}
});

// Hover actions under a message; they sit in the gap below it, so showing them never moves the text.
function TurnActions({ className, children }: { className: string; children: ReactNode }) {
	return (
		<div className={cn("turn-actions absolute top-[calc(100%+2px)] flex gap-0.5 opacity-0 [transition:opacity_150ms] group-hover/block:opacity-100 focus-within:opacity-100 no-hover:opacity-100", className)}>
			{children}
		</div>
	);
}

function Act({ label, icon, title, onClick }: { label: string; icon: ReactNode; title: string; onClick: () => void }) {
	return (
		<Button variant="chip" title={title} onClick={onClick} className="h-6 px-2 text-[12px] leading-[normal] text-ink-3 [&_svg]:size-[13px]">
			{icon}
			<span>{label}</span>
		</Button>
	);
}

const errorBox = "rounded-[10px] border border-bad-line bg-bad-soft px-3.5 py-2.5 text-[14px] text-bad";
const bubble = "ml-auto w-fit max-w-[85%] rounded-[18px_18px_6px_18px] border border-line bg-surface px-4 py-[11px] font-ui text-[15px] leading-[1.5] font-normal whitespace-pre-wrap wrap-anywhere";
// Esc Esc: the picked message stands out.
const ring = "border-primary-line shadow-[0_0_0_3px_var(--accent-soft)]";

function UserTurn({ block: b, cls, picked }: { block: UserBlock; cls: string; picked: boolean }) {
	return (
		<div data-block-id={b.id} className={cn(cls, "user-turn group/block relative", picked && "picked")}>
			<div className={cn("user", bubble, picked && ring)}>{b.text}</div>
			{b.entryId && (
				<TurnActions className="right-0">
					<Act label="Edit" icon={ICON_EDIT} title="Edit this message; the replies after it get redone" onClick={() => startEdit(b.id)} />
				</TurnActions>
			)}
		</div>
	);
}

function autosize(ta: HTMLTextAreaElement) {
	ta.style.height = "auto";
	ta.style.height = `${ta.scrollHeight}px`;
}

/** An edit on its way to the server: its editor stays up, disabled, until the
 *  lesson changes (the snapshot that follows) or the editor reopens after a failure. */
export let sentEdit: { id: string; text: string; blocks: Block[] } | null = null;
useStore.subscribe((s) => {
	if (s.editing) sentEdit = null;
});

function sendEdit() {
	const { editing, blocks } = useStore.getState();
	if (!editing?.text.trim()) return;
	sentEdit = { ...editing, blocks };
	submitEdit();
}

// Editing a message in place; what it will replace dims below it (see Transcript).
function EditBox({ block: b, cls, text, sent }: { block: UserBlock; cls: string; text: string; sent: boolean }) {
	const ta = useRef<HTMLTextAreaElement>(null);
	// When the editor opens: fit, focus at the end, bring into view.
	useLayoutEffect(() => {
		const el = ta.current;
		if (!el) return;
		autosize(el);
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
		el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, []);
	return (
		<div data-block-id={b.id} className={cn(cls, "user-turn editing relative")}>
			<div className={cn("user edit-box", bubble, "w-[85%] px-3.5 pt-3 pb-2.5", ring)}>
				<textarea
					ref={ta}
					rows={1}
					value={text}
					disabled={sent}
					aria-label="Edit your message"
					className="block max-h-[40vh] w-full resize-none overflow-y-auto border-0 bg-transparent p-0 font-[inherit] leading-[1.5] text-ink outline-none"
					onChange={(e) => {
						setEditText(e.target.value);
						autosize(e.target);
					}}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing) return;
						if (e.key === "Escape") {
							e.preventDefault();
							cancelEdit();
							focusComposer();
						} else if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							sendEdit();
						}
					}}
				/>
				<div className="mt-2.5 flex items-center justify-end gap-1.5 whitespace-normal">
					<span className="flex-1 text-[12px] text-ink-3">Replies after this message get replaced</span>
					<Button variant="chip" disabled={sent} onClick={cancelEdit}>
						Cancel
					</Button>
					<Button variant="primary" disabled={sent || !text.trim()} onClick={sendEdit} className="h-7 px-3 text-[13px]">
						Send
					</Button>
				</div>
			</div>
		</div>
	);
}

/** `value`, updated at most once per animation frame (streaming text). */
function useFrameValue<T>(key: string, value: T) {
	const [shown, setShown] = useState(value);
	useLayoutEffect(() => {
		if (!Object.is(value, shown)) scheduleFrame(key, () => setShown(value));
	}, [key, value, shown]);
	return shown;
}

function AssistantTurn({ block: b, cls, turnEnd }: { block: AssistantBlock; cls: string; turnEnd?: "last" | "" }) {
	const text = useFrameValue(
		b.id,
		b.parts
			.filter((p) => p?.type === "text")
			.map((p) => p.text)
			.join("\n\n"),
	);
	// Nothing to read yet; the status line above the composer says what's happening.
	if (!text.trim()) return <div data-block-id={b.id} className={cn(cls, "assistant relative")} hidden />;
	return (
		<div data-block-id={b.id} data-turn-end={b.done ? turnEnd : undefined} className={cn(cls, "assistant group/block relative")}>
			<Markdown text={text} className="prose" diagrams={b.done} />
			{b.done && turnEnd !== undefined && (
				<TurnActions className="-left-[9px]">
					{turnEnd === "last" ? (
						<Act label="Fork" icon={ICON_BRANCH} title="Copy this lesson into a new one; this one stays as it is" onClick={() => forkLesson()} />
					) : (
						<Act label="Branch from here" icon={ICON_BRANCH} title="Start a new lesson from this reply; this one stays as it is" onClick={() => branchAfter(b.id)} />
					)}
				</TurnActions>
			)}
		</div>
	);
}

// Tool rows open to show what was run and what came back. Kept for the session,
// so a row stays open through re-renders and lesson switches.
const openTools = new Set<string>();

function ToolRow({ block: b, cls }: { block: ToolBlock; cls: string }) {
	const [open, setOpen] = useState(() => openTools.has(b.id));
	const expandable = !!(b.input || b.output || b.status === "running");
	const toggle = () => {
		if (open) openTools.delete(b.id);
		else openTools.add(b.id);
		setOpen(!open);
	};
	return (
		<div
			data-block-id={b.id}
			className={cn(
				cls,
				"tool -mt-4 mb-6 flex min-h-[22px] flex-wrap items-center gap-2 text-[13px] text-ink-3 [.tool+&]:-mt-[22px]",
				// A failed step shares the error block's box (old `.error` matched `.tool.error` too).
				b.status === "error" && errorBox,
			)}
		>
			<button
				type="button"
				title={b.label}
				disabled={!expandable}
				aria-expanded={expandable ? open : undefined}
				onClick={expandable ? toggle : undefined}
				className="group/head flex max-w-full min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left [color:inherit] [font:inherit]"
			>
				<span
					className={cn(
						"grid w-4 flex-none place-items-center before:size-1.5 before:rounded-full before:bg-ink-3",
						b.status === "running" && "before:animate-pulse-dot before:bg-primary",
						b.status === "error" && "before:bg-bad",
					)}
				/>
				<span className={cn("truncate", b.status === "running" && "text-ink-2", expandable && "group-hover/head:text-ink")}>{b.label}</span>
				{expandable && (
					<svg viewBox="0 0 20 20" aria-hidden="true" className={cn("size-3 flex-none opacity-60 [transition:transform_150ms_var(--ease)]", open && "rotate-90")}>
						<path d="m8 5.5 4.5 4.5L8 14.5" />
					</svg>
				)}
			</button>
			{open && (
				<div className="mt-1 mr-0 mb-2 ml-6 basis-full overflow-hidden rounded-[10px] border border-line bg-code">
					{b.input && <pre className={cn(toolPre, "max-h-[140px] border-b border-line text-ink")}>{b.name === "bash" ? `$ ${b.input}` : b.input}</pre>}
					{b.output ? (
						<pre className={cn(toolPre, "ansi")} dangerouslySetInnerHTML={{ __html: ansiToHtml(b.output) }} />
					) : (
						<div className="px-3 py-2.5 text-[12.5px] text-ink-3">{b.status === "running" ? "Running…" : "No output"}</div>
					)}
				</div>
			)}
		</div>
	);
}
const toolPre = "m-0 max-h-80 overflow-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.5] whitespace-pre-wrap wrap-anywhere text-ink-2";

// Skill loads and attached files: quiet one-liners, like tool steps.
function Note({ block: b, cls }: { block: NoteBlock; cls: string }) {
	return (
		<div data-block-id={b.id} title={b.text} className={cn(cls, "-mt-4 mb-6 flex min-h-[22px] items-center gap-2 text-[13px] text-ink-3 [&_svg]:size-[15px] [&_svg]:text-primary")}>
			{b.icon === "file" ? ICON_FILE : ICON_SKILL}
			<span className="truncate">{b.text}</span>
		</div>
	);
}

// Slash command output, rendered like the terminal (ANSI colors kept).
function Output({ block: b, cls }: { block: OutputBlock; cls: string }) {
	return (
		<div data-block-id={b.id} className={cn(cls, "overflow-x-auto rounded-xl border border-line bg-code px-4 py-3")}>
			<pre className="ansi m-0 font-mono text-[13px] leading-[1.5] whitespace-pre text-ink-2" dangerouslySetInnerHTML={{ __html: ansiToHtml(b.text) }} />
		</div>
	);
}

const PHASE_LABEL = { probe: "Probe", plan: "Plan", teach: "Teach" } as const;

// A stage marker where the tutor moved the lesson on (lesson_progress).
function StageMarker({ id, phase, cls, text }: { id: string; phase: keyof typeof PHASE_LABEL; cls: string; text: string }) {
	return (
		<div
			data-block-id={id}
			className={cn(
				cls,
				"stage mt-1 mb-[26px] flex items-center gap-2.5 font-ui text-[12.5px] leading-[1.3] font-medium text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line",
			)}
		>
			<span className="text-primary">{PHASE_LABEL[phase]}</span>
			<span>{text}</span>
		</div>
	);
}
