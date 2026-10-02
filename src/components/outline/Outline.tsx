// Beside the chat when there's room: where the lesson is (the tutor reports
// probe → plan → teach and the planned steps through lesson_progress), then
// a contents list of the tutor's headings and the worksheets, with the one in
// view highlighted. Click anything to jump to it.

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderInline } from "@/lib/markdown";
import { layout, NARROW, narrowScreen, useOpenQuiz, useStore } from "@/lib/store";
import type { Block, ProgressBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PlanThumb } from "@/components/plan/PlanMap";
import { blockEl } from "@/components/transcript/scroll";
import { PHASES, type Progress, progressAt, useProgressMarks } from "./progress";

type Entry = { text: string; sub?: boolean; card?: boolean; badge?: string; open?: boolean };

// The outline takes the right-hand gutter only when the lesson keeps its full
// width; the lesson and composer shift left just enough to clear it.
const OUTLINE_W = 216;
const OUTLINE_GAP = 32;
const OUTLINE_EDGE = 24; // kept clear at the window's right edge

const plain = (md: string) => {
	const span = document.createElement("span");
	span.innerHTML = renderInline(md);
	return span.textContent!.trim();
};


/** Headings and worksheets, read from the rendered transcript. */
function outlineEntries(blocks: Block[]): { entries: Entry[]; targets: Element[] } {
	const entries: Entry[] = [];
	const targets: Element[] = [];
	for (const b of blocks) {
		const el = blockEl(b.id);
		if (!el) continue;
		if (b.kind === "assistant") {
			for (const hd of el.querySelectorAll(".prose > :is(h1, h2, h3)")) {
				entries.push({ text: hd.textContent!.trim(), sub: hd.tagName === "H3" });
				targets.push(hd);
			}
		} else if (b.kind === "quiz" && b.state !== "cancelled") {
			const graded = (b.results || []).filter((r) => typeof r.correct === "boolean");
			const badge = b.state === "pending" ? "Open" : graded.length ? `${graded.filter((r) => r.correct).length}/${graded.length}` : "";
			entries.push({ text: b.title ? plain(b.title) : "Check-in", card: true, badge, open: b.state === "pending" });
			targets.push(el);
		} else if (b.kind === "ask" && b.state !== "cancelled") {
			entries.push({ text: plain(b.question), card: true, badge: b.state === "pending" ? "Open" : "", open: b.state === "pending" });
			targets.push(el);
		}
	}
	return { entries, targets };
}

const jump = (el: Element | null | undefined) => el?.scrollIntoView({ behavior: "smooth", block: "start" });

export function Outline() {
	const blocks = useStore((s) => s.blocks);
	const sideOpen = useStore((s) => s.sideOpen);
	const nav = useRef<HTMLElement>(null);
	const [entries, setEntries] = useState<Entry[]>([]);
	const [active, setActive] = useState(-1);
	const [fits, setFits] = useState(false);
	const targets = useRef<Element[]>([]);
	const blocksRef = useRef(blocks);
	blocksRef.current = blocks;

	const marks = useProgressMarks();
	const p = useMemo(() => progressAt(marks), [marks]);
	// A worksheet open beside the lesson takes the room the outline would use.
	const quizBeside = !!useOpenQuiz();
	const has = blocks.length > 0 && (!!p || entries.length > 0) && !quizBeside;
	const hasRef = useRef(has);
	hasRef.current = has;

	// Highlight the entry being read: the last one above a line a third of the way
	// down the view, or, scrolled to the end, the last one on screen.
	const spy = useCallback(() => {
		const s = layout.scroller;
		if (!s) return;
		const box = s.getBoundingClientRect();
		const atEnd = s.scrollHeight - s.scrollTop - s.clientHeight < 4;
		const line = atEnd ? box.bottom - 40 : box.top + Math.min(220, box.height / 3);
		let at = -1;
		for (const [i, el] of targets.current.entries()) {
			if (!el.isConnected || el.getBoundingClientRect().top > line) break;
			at = i;
		}
		setActive(at);
	}, []);

	// Fresh element references even when the text didn't change (streaming re-renders replace nodes).
	const refresh = useCallback(() => {
		const { entries: next, targets: els } = outlineEntries(blocksRef.current);
		targets.current = els;
		setEntries((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
		spy();
	}, [spy]);

	const layoutOutline = useCallback(() => {
		const main = nav.current?.parentElement;
		if (!main) return;
		const W = main.clientWidth;
		const M = parseFloat(getComputedStyle(main).getPropertyValue("--measure")) || 880;
		// Shift the lesson left just enough to clear the rail; on smaller windows it narrows instead.
		const pad = Math.min(OUTLINE_W + OUTLINE_GAP + OUTLINE_EDGE, Math.max(0, 2 * (OUTLINE_W + OUTLINE_GAP + OUTLINE_EDGE) + M - W));
		const ok = hasRef.current && !narrowScreen();
		main.toggleAttribute("data-outline", ok);
		main.style.setProperty("--outline-pad", `${ok ? pad : 0}px`);
		setFits(ok);
	}, []);

	// Watch the transcript (headings stream in, cards change) and its scrolling.
	// Deferred a frame: App registers the scroller after its children mount.
	useEffect(() => {
		let frame = 0;
		let spyFrame = 0;
		let scroller: HTMLElement | null = null;
		const schedule = () => void (frame ||= requestAnimationFrame(() => ((frame = 0), refresh())));
		const onScroll = () => void (spyFrame ||= requestAnimationFrame(() => ((spyFrame = 0), spy())));
		const mo = new MutationObserver(schedule);
		const attach = requestAnimationFrame(() => {
			scroller = layout.scroller;
			if (!scroller) return;
			mo.observe(scroller, { childList: true, subtree: true, characterData: true });
			scroller.addEventListener("scroll", onScroll, { passive: true });
			refresh();
		});
		return () => {
			cancelAnimationFrame(attach);
			cancelAnimationFrame(frame);
			cancelAnimationFrame(spyFrame);
			mo.disconnect();
			scroller?.removeEventListener("scroll", onScroll);
		};
	}, [refresh, spy]);

	useEffect(() => {
		const id = requestAnimationFrame(refresh);
		return () => cancelAnimationFrame(id);
	}, [blocks, refresh]);

	useLayoutEffect(layoutOutline, [has, layoutOutline]);

	useEffect(() => {
		const main = nav.current?.parentElement;
		if (!main) return;
		const ro = new ResizeObserver(layoutOutline);
		ro.observe(main);
		const mq = matchMedia(NARROW);
		mq.addEventListener("change", layoutOutline);
		return () => {
			ro.disconnect();
			mq.removeEventListener("change", layoutOutline);
		};
	}, [layoutOutline]);

	return (
		<nav
			ref={nav}
			aria-label="Lesson outline"
			className={cn(
				"absolute top-[72px] right-6 z-3 max-h-[calc(100%-72px-var(--dock-h,140px)-40px)] w-[216px] flex-col gap-[26px] overflow-y-auto overscroll-contain pb-3 transition-opacity duration-200",
				fits && blocks.length ? "flex animate-[rise_300ms_var(--ease)_both]" : "hidden",
				// The side chat opens in the same corner, so the outline steps aside.
				sideOpen && "pointer-events-none opacity-0",
			)}
		>
			{blocks.length > 0 && p && <Stages p={p} markers={marks} />}
			{blocks.length > 0 && entries.length > 0 && (
				<div className="flex flex-col gap-px">
					<Heading>In this lesson</Heading>
					{entries.map((e, i) => {
						const current = i === active;
						return (
							<button
								// biome-ignore lint/suspicious/noArrayIndexKey: entries have no identity beyond position
								key={i}
								type="button"
								aria-current={current || undefined}
								onClick={() => jump(targets.current[i])}
								className={cn(
									"flex w-full cursor-pointer items-baseline gap-2 rounded-[9px] border-0 bg-transparent px-2.5 py-[5px] text-left font-ui text-[13px] leading-[1.4] font-normal text-ink-3 transition-[background,color] duration-150",
									current ? "bg-ink/8 text-ink" : "hover:bg-ink/6 hover:text-ink",
									e.sub && "pl-[22px] text-[12.5px]/[1.4]",
									e.card &&
										"before:box-content before:flex-none before:size-2 before:translate-y-[-1px] before:rounded-[2.5px] before:border-[1.5px] before:border-current before:opacity-70 before:content-['']",
								)}
							>
								<span className="line-clamp-2 min-w-0 flex-1">{e.text}</span>
								{e.badge && (
									<span
										className={cn(
											"flex-none rounded-full px-[7px] py-px font-ui text-[11.5px] leading-[1.5] font-medium tabular-nums",
											e.open ? "bg-primary-soft text-primary" : "bg-sunken text-ink-2",
										)}
									>
										{e.badge}
									</span>
								)}
							</button>
						);
					})}
				</div>
			)}
		</nav>
	);
}

function Heading({ children }: { children: string }) {
	return <h3 className="mt-0 mr-0 mb-1.5 ml-2.5 font-ui text-[12.5px] leading-[normal] font-medium text-ink-3">{children}</h3>;
}

type Status = "done" | "now" | "todo";

// One row in the stage list; a button that jumps to the marker when there is one.
function StageRow({ status, to, step, label, count }: { status: Status; to?: string; step?: boolean; label: string; count?: string }) {
	const cls = cn(
		"relative z-1 flex w-full items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2.5 py-1.5 text-left font-ui text-[13.5px] leading-[1.3] font-medium",
		step && "py-1 text-[13px]/[1.3] font-normal",
		status === "done" ? "text-ink-2" : status === "now" ? "text-ink" : "text-ink-3",
		to && "cursor-pointer transition-[background,color] duration-150 hover:bg-ink/6 hover:text-ink",
	);
	const inner = (
		<>
			<span
				className={cn(
					"flex-none rounded-full border-[1.5px]",
					step ? "size-[7px]" : "size-[9px]",
					status === "done"
						? "border-transparent bg-ink-3"
						: status === "now"
							? cn("border-transparent bg-primary", step ? "shadow-[0_0_0_3px_var(--accent-soft)]" : "shadow-[0_0_0_4px_var(--accent-soft)]")
							: "border-line-strong bg-bg",
				)}
			/>
			<span className="min-w-0 flex-1" dangerouslySetInnerHTML={{ __html: renderInline(label) }} />
			{count && <span className="font-ui text-[12px] leading-[normal] font-normal text-ink-3">{count}</span>}
		</>
	);
	return to ? (
		<button type="button" data-stage={to} className={cls} onClick={() => jump(blockEl(to))}>
			{inner}
		</button>
	) : (
		<div className={cls}>{inner}</div>
	);
}

// Probe → Plan → Teach, with the planned steps under Teach.
const Stages = memo(function Stages({ p, markers }: { p: Progress; markers: ProgressBlock[] }) {
	const at = PHASES.findIndex(([id]) => id === p.phase);
	const status = (i: number, now: number): Status => (i < now ? "done" : i === now ? "now" : "todo");
	return (
		<div>
			<Heading>Progress</Heading>
			<ol className="m-0 list-none p-0">
				{PHASES.map(([id, label], i) => (
					<li
						key={id}
						className={cn(
							"relative",
							i < PHASES.length - 1 && "after:absolute after:top-6 after:-bottom-1.5 after:left-[14px] after:w-px after:bg-line-strong after:content-['']",
						)}
					>
						<StageRow
							status={status(i, at)}
							to={markers.find((b) => b.phase === id)?.id}
							label={label}
							count={id === "teach" && p.steps && at === 2 && p.current != null ? `${Math.min(p.current + 1, p.steps.length)} of ${p.steps.length}` : undefined}
						/>
						{id === "teach" && p.steps && (
							<ol className="m-0 mb-1 ml-3.5 list-none p-0">
								{p.steps.map((s, k) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: steps are positional
									<li key={k}>
										<StageRow
											step
											status={status(k, at === 2 ? (p.current ?? -1) : -1)}
											to={markers.find((b) => b.phase === "teach" && b.current === k)?.id}
											label={s}
										/>
									</li>
								))}
							</ol>
						)}
					</li>
				))}
			</ol>
			{p.steps && (
				<div className="mt-3">
					<PlanThumb p={p} />
				</div>
			)}
		</div>
	);
});
