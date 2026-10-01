// The side chat: a floating glass window over the lesson for quick questions the
// tutor never sees. Drag it by its header; where it sits is --side-x/--side-y on
// the root (read before first paint by the head script in index.html), its size
// --side-w/--side-h. Only opacity/scale/translate ever animate, so motion stays
// on the compositor. On narrow screens it docks full-width below the top bar.

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/lib/markdown";
import { askSide, narrowScreen, post, refs, setSide, useStore } from "@/lib/store";
import type { SideBlock } from "@/lib/types";
import { cn } from "@/lib/utils";

const root = document.documentElement;
const SIDE_MARGIN = 8;
const SIDE_MIN = { w: 300, h: 320 };

type Box = { x: number; y: number; w: number; h: number };
type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function moveSide({ x, y }: { x: number; y: number }) {
	root.style.setProperty("--side-x", `${x}px`);
	root.style.setProperty("--side-y", `${y}px`);
}

function sizeSide({ w, h }: { w: number; h: number }) {
	root.style.setProperty("--side-w", `${w}px`);
	root.style.setProperty("--side-h", `${h}px`);
}

function autosize(ta: HTMLTextAreaElement) {
	ta.style.height = "auto";
	ta.style.height = `${ta.scrollHeight}px`;
}

/** The thread, re-rendered at most once a frame however fast deltas stream in. */
function useFrameThread(onBeforeRender: () => void) {
	const [thread, setThread] = useState(() => useStore.getState().side.thread);
	const before = useRef(onBeforeRender);
	before.current = onBeforeRender;
	useEffect(() => {
		let frame = 0;
		const unsub = useStore.subscribe((s, prev) => {
			if (s.side.thread === prev.side.thread || frame) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				before.current();
				setThread(useStore.getState().side.thread);
			});
		});
		return () => {
			unsub();
			cancelAnimationFrame(frame);
		};
	}, []);
	return thread;
}

// Thin invisible strips on each edge, larger squares at the corners.
const HANDLES: [Dir, string][] = [
	["n", "top-0 inset-x-3.5 h-1.5 cursor-ns-resize"],
	["s", "bottom-0 inset-x-3.5 h-1.5 cursor-ns-resize"],
	["e", "right-0 inset-y-3.5 w-[5px] cursor-ew-resize"],
	["w", "left-0 inset-y-3.5 w-[5px] cursor-ew-resize"],
	["ne", "top-0 right-0 size-4 cursor-nesw-resize"],
	["nw", "top-0 left-0 size-4 cursor-nwse-resize"],
	["se", "bottom-0 right-0 size-4 cursor-nwse-resize"],
	["sw", "bottom-0 left-0 size-4 cursor-nesw-resize"],
];

function SideBlockView({ b }: { b: SideBlock }) {
	if (b.kind === "user")
		return (
			<div className="mb-[18px] ml-auto w-fit max-w-[92%] rounded-[18px_18px_6px_18px] border border-ink/10 bg-ink/7 px-4 py-[11px] font-ui text-[14px]/[1.5] wrap-anywhere whitespace-pre-wrap">
				{b.text}
			</div>
		);
	if (b.kind === "error")
		return <div className="mb-[18px] rounded-[10px] border border-bad-line bg-bad-soft px-3.5 py-2.5 text-[14px] text-bad">{b.text}</div>;
	if (b.kind === "tool")
		return (
			<div className="-mt-2.5 mb-4 flex min-h-[22px] flex-wrap items-center gap-2 text-[13px] text-ink-3">
				<span
					className={cn(
						"grid w-4 flex-none place-items-center before:size-1.5 before:rounded-full before:bg-ink-3 before:content-['']",
						b.status === "running" && "before:animate-pulse-dot before:bg-primary",
						b.status === "error" && "before:bg-bad",
					)}
				/>
				<span className={cn("overflow-hidden text-ellipsis whitespace-nowrap", b.status === "running" && "text-ink-2")}>{b.label}</span>
			</div>
		);
	if (b.text.trim())
		return (
			<div className="relative mb-[18px]">
				<Markdown text={b.text} diagrams={b.done} className="prose text-[15px]/[1.6]! [&_.math-display_.katex]:text-[1.05em]!" />
			</div>
		);
	if (b.done) return null;
	return (
		<div className="relative mb-[18px]">
			<span className="inline-flex items-center gap-2 font-ui text-[13px] text-ink-3 before:size-[7px] before:animate-pulse-dot before:rounded-full before:bg-primary before:content-['']">
				{b.thinking ? "Thinking" : "Starting"}
			</span>
		</div>
	);
}

export function SideChat() {
	const open = useStore((s) => s.sideOpen);
	const busy = useStore((s) => s.side.busy);
	const [text, setText] = useState("");
	const [dragging, setDragging] = useState(false);
	const [resizing, setResizing] = useState(false);
	const [settling, setSettling] = useState(false);

	const side = useRef<HTMLElement>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const composer = useRef<HTMLFormElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	const stick = useRef(true);
	const settleTimer = useRef(0);
	const drag = useRef<{ dx: number; dy: number; pos: { x: number; y: number }; start: { x: number; y: number }; frame: number } | null>(null);
	const resize = useRef<{ dir: Dir; px: number; py: number; x: number; y: number; w: number; h: number; box: Box | null; frame: number } | null>(null);
	const lastHeadDown = useRef(0);

	// Stay pinned to the bottom while an answer streams, unless scrolled up to read.
	const thread = useFrameThread(() => {
		const s = scroller.current;
		stick.current = !s || s.scrollHeight - s.scrollTop - s.clientHeight < 120;
	});
	useLayoutEffect(() => {
		const s = scroller.current;
		if (s && stick.current) s.scrollTop = s.scrollHeight;
	}, [thread]);

	useEffect(() => {
		refs.sideInput = input.current;
		return () => void (refs.sideInput = null);
	}, []);

	// Only resize once something's been typed.
	const typed = useRef(text);
	useLayoutEffect(() => {
		if (typed.current !== text && input.current) autosize(input.current);
		typed.current = text;
	}, [text]);

	// The scroller pads by the composer's height so the last lines scroll clear of it.
	useEffect(() => {
		const el = composer.current;
		if (!el) return;
		const ro = new ResizeObserver(() => side.current?.style.setProperty("--side-dock-h", `${el.offsetHeight}px`));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const sidePos = () => {
		const [x, y] = getComputedStyle(side.current!).translate.split(" ").map(parseFloat);
		return { x: x || 0, y: y || 0 };
	};

	const clampSide = (x: number, y: number) => {
		const el = side.current!;
		const maxX = innerWidth - el.offsetWidth - SIDE_MARGIN;
		const maxY = innerHeight - el.offsetHeight - SIDE_MARGIN;
		return { x: Math.round(Math.max(SIDE_MARGIN, Math.min(maxX, x))), y: Math.round(Math.max(SIDE_MARGIN, Math.min(maxY, y))) };
	};

	// Animated move (reset, or pulled back on screen after the window shrank).
	// The settling transition must be on before the move, hence flushSync.
	const settleSide = (apply: () => void) => {
		flushSync(() => setSettling(true));
		apply();
		clearTimeout(settleTimer.current);
		settleTimer.current = window.setTimeout(() => setSettling(false), 450);
	};

	// Back to the default corner and size.
	const recenterSide = () => {
		localStorage.removeItem("learn-side-pos");
		localStorage.removeItem("learn-side-size");
		settleSide(() => {
			for (const k of ["x", "y", "w", "h"]) root.style.removeProperty(`--side-${k}`);
		});
	};

	useEffect(() => {
		const keepSideInView = () => {
			if (narrowScreen()) return;
			const size = JSON.parse(localStorage.getItem("learn-side-size") || "null") as { w: number; h: number } | null;
			if (size) sizeSide({ w: Math.min(size.w, innerWidth - 2 * SIDE_MARGIN), h: Math.min(size.h, innerHeight - 2 * SIDE_MARGIN) });
			if (!localStorage.getItem("learn-side-pos")) return;
			const p = sidePos();
			const c = clampSide(p.x, p.y);
			if (c.x !== p.x || c.y !== p.y) settleSide(() => moveSide(c));
		};
		keepSideInView();
		addEventListener("resize", keepSideInView);
		return () => {
			removeEventListener("resize", keepSideInView);
			clearTimeout(settleTimer.current);
		};
	}, []);

	// ─── Drag by the header ───────────────────────────────────────────────

	const onHeadDown = (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 || (e.target as Element).closest("button") || narrowScreen()) return;
		e.preventDefault();
		// A second press on the header right after the first sends the card back to its corner.
		if (e.timeStamp - lastHeadDown.current < 350) {
			lastHeadDown.current = 0;
			return recenterSide();
		}
		lastHeadDown.current = e.timeStamp;
		const p = sidePos();
		drag.current = { dx: e.clientX - p.x, dy: e.clientY - p.y, pos: p, start: p, frame: 0 };
		e.currentTarget.setPointerCapture(e.pointerId);
		setSettling(false);
		setDragging(true);
	};
	const onHeadMove = (e: PointerEvent<HTMLDivElement>) => {
		const d = drag.current;
		if (!d) return;
		d.pos = clampSide(e.clientX - d.dx, e.clientY - d.dy);
		// One style write per frame, however fast the pointer events come.
		d.frame ||= requestAnimationFrame(() => {
			if (!drag.current) return;
			drag.current.frame = 0;
			moveSide(drag.current.pos);
		});
	};
	const endDrag = () => {
		const d = drag.current;
		if (!d) return;
		cancelAnimationFrame(d.frame);
		drag.current = null;
		setDragging(false);
		if (d.pos.x === d.start.x && d.pos.y === d.start.y) return;
		lastHeadDown.current = 0;
		moveSide(d.pos);
		localStorage.setItem("learn-side-pos", JSON.stringify(d.pos));
	};

	// ─── Resize from any edge or corner ───────────────────────────────────
	// The west/north edges move the card as they resize it, so the opposite edge
	// stays put, like a desktop window.

	const onResizeDown = (dir: Dir) => (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 || narrowScreen()) return;
		e.preventDefault();
		e.stopPropagation();
		const p = sidePos();
		const el = side.current!;
		resize.current = { dir, px: e.clientX, py: e.clientY, x: p.x, y: p.y, w: el.offsetWidth, h: el.offsetHeight, box: null, frame: 0 };
		e.currentTarget.setPointerCapture(e.pointerId);
		setSettling(false);
		setResizing(true);
	};
	const onResizeMove = (e: PointerEvent<HTMLDivElement>) => {
		const r = resize.current;
		if (!r) return;
		const dx = e.clientX - r.px;
		const dy = e.clientY - r.py;
		let { x, y, w, h } = r;
		if (r.dir.includes("e")) w = Math.min(r.w + dx, innerWidth - SIDE_MARGIN - r.x);
		if (r.dir.includes("s")) h = Math.min(r.h + dy, innerHeight - SIDE_MARGIN - r.y);
		if (r.dir.includes("w")) {
			const right = r.x + r.w;
			x = Math.max(SIDE_MARGIN, Math.min(r.x + dx, right - SIDE_MIN.w));
			w = right - x;
		}
		if (r.dir.includes("n")) {
			const bottom = r.y + r.h;
			y = Math.max(SIDE_MARGIN, Math.min(r.y + dy, bottom - SIDE_MIN.h));
			h = bottom - y;
		}
		r.box = { x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(SIDE_MIN.w, w)), h: Math.round(Math.max(SIDE_MIN.h, h)) };
		r.frame ||= requestAnimationFrame(() => {
			const cur = resize.current;
			if (!cur?.box) return;
			cur.frame = 0;
			moveSide(cur.box);
			sizeSide(cur.box);
		});
	};
	const endResize = () => {
		const r = resize.current;
		if (!r) return;
		cancelAnimationFrame(r.frame);
		resize.current = null;
		setResizing(false);
		if (!r.box) return;
		moveSide(r.box);
		sizeSide(r.box);
		localStorage.setItem("learn-side-pos", JSON.stringify({ x: r.box.x, y: r.box.y }));
		localStorage.setItem("learn-side-size", JSON.stringify({ w: r.box.w, h: r.box.h }));
	};

	// ─── Composer ─────────────────────────────────────────────────────────

	const ask = async (q: string) => {
		const ok = await askSide(q);
		if (ok && input.current?.value === q) setText("");
	};
	const onSubmit = (e: FormEvent) => {
		e.preventDefault();
		ask(text);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			ask(text);
		} else if (e.key === "Escape") setSide(false);
	};

	const lifted = open && dragging;
	return (
		<aside
			ref={side}
			id="side"
			aria-label="Side chat"
			className={cn(
				"glass fixed top-0 left-0 z-6 flex flex-col overflow-hidden rounded-3xl",
				"h-(--side-h,min(680px,calc(100vh_-_76px))) w-(--side-w) origin-[85%_0]",
				"[translate:var(--side-x,calc(100vw_-_var(--side-w)_-_16px))_var(--side-y,60px)]",
				// More see-through than the composer: the lesson stays readable behind it. A
				// single soft shadow (no dark inner edge), and a faint rim instead of a border.
				"border-white/7 light:border-white/65 [--tint-light:color-mix(in_oklab,white_48%,transparent)] [--tint:color-mix(in_oklab,var(--bg)_48%,transparent)] backdrop-blur-[16px] backdrop-saturate-180",
				"before:inset-0 before:opacity-60", // the card clips overflow, so keep the rim inside it
				lifted
					? // Picked up: lifts slightly and casts a longer shadow.
						"cursor-grabbing [box-shadow:inset_0_1px_0_color-mix(in_oklab,white_10%,transparent),0_34px_80px_-28px_color-mix(in_srgb,var(--shade)_65%,transparent)]"
					: "[box-shadow:inset_0_1px_0_color-mix(in_oklab,white_10%,transparent),0_24px_60px_-28px_color-mix(in_srgb,var(--shade)_55%,transparent)] light:[box-shadow:inset_0_1px_0_color-mix(in_oklab,white_80%,transparent),0_24px_60px_-28px_color-mix(in_srgb,var(--shade)_28%,transparent)]",
				!open
					? "invisible scale-92 opacity-0 [transition:opacity_160ms_ease-in,scale_200ms_ease-in,visibility_0s_linear_200ms]"
					: cn(
							"visible opacity-100",
							lifted ? "scale-[1.015]" : "scale-100",
							// Snapping back into view after a window resize or a double-click reset.
							settling
								? "[transition:translate_420ms_var(--spring),width_420ms_var(--ease),height_420ms_var(--ease),opacity_220ms_ease-out,scale_420ms_var(--spring)]"
								: lifted
									? "[transition:scale_180ms_var(--spring),box-shadow_180ms_ease-out]"
									: "[transition:opacity_220ms_ease-out,scale_420ms_var(--spring),visibility_0s]",
						),
				open && (dragging || resizing) && "will-change-[translate,width,height]",
				resizing && "select-none",
				"narrow:top-[60px] narrow:right-2 narrow:bottom-2 narrow:left-2 narrow:h-auto narrow:w-auto narrow:origin-[50%_0] narrow:translate-none",
			)}
		>
			<div
				className="flex cursor-grab touch-none items-start gap-0.5 pt-4 pr-2.5 pb-2 pl-5 select-none narrow:cursor-default"
				onPointerDown={onHeadDown}
				onPointerMove={onHeadMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
			>
				<div className="min-w-0 flex-1">
					<h2 className="m-0 font-ui text-[15px]/[1.3] font-semibold">Side chat</h2>
					<p className="mt-0.5 mb-0 text-[12px] text-ink-3">Quick questions. The lesson never sees these.</p>
				</div>
				<Button variant="icon" aria-label="Clear side chat" title="Clear side chat" onClick={() => post("/api/side/clear")}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />
					</svg>
				</Button>
				{/* Minimize: the card goes away but the conversation stays for next time. */}
				<Button variant="icon" aria-label="Minimize side chat" title="Minimize side chat (your conversation stays)" onClick={() => setSide(false)}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M5.5 10h9" />
					</svg>
				</Button>
			</div>
			<div ref={scroller} className="flex-1 overflow-x-hidden overflow-y-auto px-5 pt-2 pb-[calc(var(--side-dock-h,64px)+24px)]">
				<div>
					{thread.map((b) => (
						<SideBlockView key={b.id} b={b} />
					))}
				</div>
				<div hidden={thread.length > 0}>
					<p className="mt-1.5 mb-3 text-[13.5px]/[1.55] text-ink-3">Stuck on notation, a definition, or what a question is even asking? Ask here while you work.</p>
					<p className="mt-1.5 mb-3 text-[13.5px]/[1.55] text-ink-3">
						It sees the open worksheet and the tutor's last message, not the whole lesson, and it won't give away answers.
					</p>
				</div>
			</div>
			{/* A field inside the card rather than glass on glass. */}
			<form
				ref={composer}
				onSubmit={onSubmit}
				className="absolute right-2.5 bottom-2.5 left-2.5 flex flex-row items-end gap-1.5 rounded-[18px] border border-ink/10 bg-ink/7 py-[7px] pr-[7px] pl-3 transition-[border-color,box-shadow] duration-150 focus-within:border-primary-line"
			>
				<textarea
					ref={input}
					rows={1}
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder={busy ? "Answering…" : thread.length ? "Another quick question" : "Quick question"}
					aria-label="Side question"
					className="max-h-[40vh] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-[5px] font-ui text-[15px]/[1.5] text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed"
				/>
				<button type="submit" aria-label="Ask" title="Ask" hidden={busy} disabled={!text.trim()} className={sendClass}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" />
					</svg>
				</button>
				<button type="button" aria-label="Stop" title="Stop" hidden={!busy} onClick={() => post("/api/side/abort")} className={cn(sendClass, "bg-ink text-bg")}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<rect x="6" y="6" width="8" height="8" rx="1.5" className="fill" />
					</svg>
				</button>
			</form>
			{HANDLES.map(([dir, pos]) => (
				<div
					key={dir}
					className={cn("absolute z-3 touch-none narrow:hidden", pos)}
					onPointerDown={onResizeDown(dir)}
					onPointerMove={onResizeMove}
					onPointerUp={endResize}
					onPointerCancel={endResize}
				/>
			))}
		</aside>
	);
}

const sendClass =
	"ml-0.5 grid size-[34px] flex-none place-items-center rounded-xl border-0 bg-primary text-primary-ink [transition:opacity_150ms,filter_150ms,scale_120ms_var(--ease)] hover:enabled:brightness-106 active:enabled:scale-95 disabled:opacity-30 [&_svg]:size-[17px] [&_svg]:stroke-[1.9]";
