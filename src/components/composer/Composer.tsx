// The composer: floats over the lesson, with /command and @file suggestions
// above it, the working status line, model + thinking pickers, the hint line
// (flash messages land here) and the context meter.

import { Fragment, useEffect, useLayoutEffect, useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { openCard, post, refs, setDraft, useOpenQuiz, useStore, useWide } from "@/lib/store";
import { cn } from "@/lib/utils";
import { sendMessage } from "./commands";
import { ModelPicker } from "./ModelPicker";
import { UsageMeter } from "./UsageMeter";
import { type Sug, useSuggest } from "./useSuggest";
import { WorkingLine } from "./WorkingLine";

const root = document.documentElement;

export function Composer() {
	const draft = useStore((s) => s.draft);
	const busy = useStore((s) => s.busy);
	const hasContent = useStore((s) => s.blocks.length > 0);
	const card = useStore((s) => openCard(s.blocks));
	// Where the open card is: beside the lesson, still a closed bar (wide windows), or in the lesson.
	const quizOpen = !!useOpenQuiz();
	const quizPending = useStore((s) => s.blocks.some((b) => b.kind === "quiz" && b.state === "pending"));
	const quizBar = useWide() && !quizOpen && quizPending;
	const rewind = useStore((s) => !!s.rewind);
	const flash = useStore((s) => s.flash);
	const input = useRef<HTMLTextAreaElement>(null);
	const form = useRef<HTMLFormElement>(null);
	const caret = useRef<number | null>(null);
	const { sug, ref: sugRef, update, close, highlight } = useSuggest(input);

	// An open card is the learner's turn; the composer already says so.
	const working = busy && !card;
	useEffect(() => {
		root.toggleAttribute("data-working", working);
		return () => root.removeAttribute("data-working");
	}, [working]);

	useEffect(() => {
		refs.input = input.current;
		input.current?.focus();
		return () => void (refs.input = null);
	}, []);

	// Grow with the text (up to 40vh), and put the caret where a suggestion left it.
	useLayoutEffect(() => {
		const ta = input.current;
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${ta.scrollHeight}px`;
		if (caret.current !== null) {
			ta.setSelectionRange(caret.current, caret.current);
			caret.current = null;
		}
	}, [draft]);

	// The composer floats over the lesson; pad the transcript by its height so the
	// last lines can scroll clear of it.
	useEffect(() => {
		const el = form.current;
		if (!el) return;
		const ro = new ResizeObserver(() => root.style.setProperty("--dock-h", `${el.offsetHeight}px`));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const send = (text: string) => sendMessage(text, close);

	// `run`: Enter on a command that takes no arguments runs it straight away.
	const accept = (i: number, run: boolean) => {
		const s = sugRef.current;
		const it = s?.items?.[i];
		const ta = input.current;
		if (!s || !it || !ta) return;
		const v = ta.value;
		const insert = it.kind === "cmd" ? `/${it.name} ` : /\s/.test(it.path) ? `@"${it.path}" ` : `@${it.path} `;
		const after = v.slice(s.end).replace(/^ /, "");
		const next = v.slice(0, s.start) + insert + after;
		const at = s.start + insert.length;
		close();
		if (next === v) ta.setSelectionRange(at, at);
		else caret.current = at;
		setDraft(next);
		ta.focus();
		if (run && it.kind === "cmd" && !it.takesArgs && !after.trim()) send(next);
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.nativeEvent.isComposing) return;
		const s = sugRef.current;
		if (s?.items?.length) {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				return highlight(s.hl + (e.key === "ArrowDown" ? 1 : -1));
			}
			if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
				e.preventDefault();
				return accept(s.hl, e.key === "Enter");
			}
		}
		if (e.key === "Escape" && s) {
			e.preventDefault();
			return close();
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			send(e.currentTarget.value);
		}
	};

	const empty = !draft.trim();
	const hint = flash
		? flash.msg
		: rewind
			? "↑ ↓ pick  ·  Enter edit  ·  Esc cancel"
			: card
				? "Waiting on your answers"
				: busy
					? ""
					: "/ commands  ·  @ files  ·  Esc Esc edit";

	return (
		<footer
			className="pointer-events-none absolute right-0 bottom-0 left-0 z-4 flex flex-col items-center pt-0 pr-[calc(32px+var(--outline-pad,0px))] pb-[18px] pl-8 *:pointer-events-auto narrow:px-3 narrow:pb-3"
			id="dock"
		>
			{sug && <Suggest sug={sug} onAccept={(i) => accept(i, false)} />}
			<form
				ref={form}
				id="composer"
				className="glass flex w-[min(var(--measure)_+_24px,100%)] flex-col gap-1 rounded-[22px] pt-3 pr-3 pb-2.5 pl-3.5 transition-[border-color,box-shadow] duration-150"
				onSubmit={(e) => {
					e.preventDefault();
					send(draft);
				}}
			>
				{/* What the tutor is doing right now; floats just above the composer. */}
				{working && <WorkingLine hidden={!!sug} />}
				<textarea
					ref={input}
					id="input"
					rows={1}
					className="max-h-[40vh] min-w-0 flex-1 resize-none border-0 bg-transparent px-1.5 pt-1 pb-0.5 font-ui text-[16px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
					placeholder={quizBar ? "Open the check-in to answer, or ask the side chat" : card ? `Answer the card ${quizOpen ? "on the right" : "above"}, or ask the side chat` : busy ? "Add a thought while the tutor works" : hasContent ? "Reply" : "Ask anything, or name a topic"}
					aria-label="Message"
					aria-autocomplete="list"
					aria-controls="suggest"
					disabled={card}
					value={draft}
					onChange={(e) => {
						setDraft(e.target.value);
						update();
					}}
					onKeyDown={onKeyDown}
					onClick={update}
					onBlur={() => setTimeout(() => document.activeElement !== input.current && close(), 100)}
				/>
				<div className="flex min-w-0 items-center gap-0.5">
					<ModelPicker />
					<ThinkingSelect />
					<span
						className={cn("min-w-0 flex-1 truncate px-2 text-right text-[12px]", flash?.bad ? "text-bad" : "text-ink-3")}
						title={flash ? flash.msg : undefined}
					>
						{hint}
					</span>
					<UsageMeter />
					{!(busy && empty) && (
						<button className={sendButton} type="submit" aria-label="Send" title="Send" disabled={card || empty}>
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" />
							</svg>
						</button>
					)}
					{busy && (
						<button className={cn(sendButton, "bg-ink text-bg")} type="button" aria-label="Stop" title="Stop" onClick={() => post("/api/abort")}>
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<rect x="6" y="6" width="8" height="8" rx="1.5" className="fill" />
							</svg>
						</button>
					)}
				</div>
			</form>
		</footer>
	);
}

const sendButton =
	"ml-0.5 grid size-[34px] flex-none place-items-center rounded-[12px] border-0 bg-primary text-primary-ink [transition:opacity_150ms,filter_150ms,scale_120ms_var(--ease)] hover:enabled:brightness-106 active:enabled:scale-95 disabled:opacity-30 [&_svg]:size-[17px] [&_svg]:stroke-[1.9]";

function ThinkingSelect() {
	const { thinking, levels } = useStore((s) => s.tuning);
	const busy = useStore((s) => s.busy);
	const opts = levels.includes(thinking) || !thinking ? levels : [...levels, thinking];
	return (
		<label
			className={cn(buttonVariants({ variant: "chip" }), "pr-0.5 pl-2 hover:bg-ink/9 hover:text-ink has-[select:disabled]:opacity-45")}
			title="Thinking level"
		>
			<svg viewBox="0 0 20 20" aria-hidden="true">
				<path d="M7.5 15.5h5M8 13c-1.8-1-3-2.7-3-4.7a5 5 0 0 1 10 0c0 2-1.2 3.7-3 4.7z" />
			</svg>
			{/* Uncontrolled: it shows the pick at once and resets when the server reports the level. */}
			<select
				key={`${thinking}|${opts.join()}`}
				id="thinking"
				aria-label="Thinking level"
				className="cursor-pointer appearance-none border-0 bg-transparent py-1 pr-1.5 pl-0 [font:inherit] text-inherit outline-none [&_option]:bg-raised [&_option]:text-ink"
				defaultValue={thinking}
				disabled={busy}
				onChange={(e) => post("/api/thinking", { level: e.target.value })}
			>
				{opts.map((l) => (
					<option key={l} value={l}>
						{l}
					</option>
				))}
			</select>
		</label>
	);
}

function Suggest({ sug, onAccept }: { sug: Sug; onAccept: (i: number) => void }) {
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		box.current?.querySelectorAll("button")[sug.hl]?.scrollIntoView({ block: "nearest" });
	}, [sug.hl, sug.items]);

	let group = "";
	return (
		<div
			ref={box}
			id="suggest"
			role="listbox"
			className="glass absolute bottom-[calc(100%+10px)] z-5 max-h-[min(360px,50vh)] w-[min(var(--measure)_+_24px,100%_-_64px)] animate-pop-in overflow-y-auto rounded-[18px] p-1.5 [--tint-light:color-mix(in_oklab,white_78%,transparent)] [--tint:color-mix(in_oklab,var(--bg)_80%,transparent)]"
		>
			{!sug.items ? (
				<div className="p-2.5 text-ink-3">Searching the vault…</div>
			) : (
				!sug.items.length && <div className="p-2.5 text-ink-3">{sug.mode === "cmd" ? "No matching commands." : "No matching files."}</div>
			)}
			{sug.items?.map((it, i) => {
				const head = it.kind === "cmd" && it.group !== group ? (group = it.group) : null;
				return (
					<Fragment key={it.kind === "cmd" ? `/${it.name}` : it.path}>
						{head && <h4 className="mx-2.5 mt-2 mb-1 font-ui text-[12.5px] leading-[normal] font-medium text-ink-3">{head}</h4>}
						<button
							type="button"
							role="option"
							title={it.kind === "file" ? it.path : it.desc}
							className={cn(
								"flex w-full min-w-0 items-baseline gap-3 rounded-[10px] border-0 bg-transparent px-2.5 py-[7px] text-left text-ink-2",
								i === sug.hl && "bg-ink/11 text-ink",
							)}
							onPointerDown={(e) => e.preventDefault()} // keep focus in the textarea
							onClick={() => onAccept(i)}
						>
							<span className="flex-none font-mono text-[14px] leading-[normal] font-medium text-ink">{it.kind === "cmd" ? `/${it.name}` : it.name}</span>
							{it.kind === "cmd" && it.hint && <span className="flex-none font-mono text-[12px] leading-[normal] text-ink-3">{it.hint}</span>}
							<span className="min-w-0 flex-1 truncate text-[13px] text-ink-3">{it.desc}</span>
						</button>
					</Fragment>
				);
			})}
		</div>
	);
}
