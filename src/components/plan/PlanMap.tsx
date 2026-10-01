// The plan's dependency map, drawn natively (not mermaid) so it can show where
// the lesson is: done steps settle back, the current one glows in the accent,
// steps whose prerequisites are done read as ready, the rest wait. Three sizes:
// a card in the chat at the plan marker, a thumbnail in the outline, and the
// full map in an overlay. Clicking a taught step jumps to where it was taught.

import { type CSSProperties, memo, type MouseEvent, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Progress, progressAt, stageText, taughtAt, useProgressMarks } from "@/components/outline/progress";
import { renderInline } from "@/lib/markdown";
import { focusComposer, setPlanMap, useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { blockEl } from "@/components/transcript/scroll";
import { cn } from "@/lib/utils";
import { DOT, fitPlan, type Graph, layoutPlan, type MapNode, type Status } from "./graph";

const BOX_STYLE: Record<Status, CSSProperties> = {
	done: { fill: "var(--good-soft)", stroke: "var(--good-line)" },
	now: { fill: "var(--accent-soft)", stroke: "var(--accent)", strokeWidth: 2 },
	ready: { fill: "var(--raised)", stroke: "var(--line-strong)" },
	later: { fill: "var(--bg)", stroke: "var(--line-strong)", strokeDasharray: "4 4" },
};
const DOT_FILL: Record<Status, string> = { done: "var(--good)", now: "var(--accent)", ready: "var(--ink-3)", later: "var(--line-strong)" };
const TEXT: Record<Status, string> = { done: "text-ink-2", now: "text-ink", ready: "text-ink", later: "text-ink-3" };
const LEGEND: [Status, string][] = [
	["done", "Done"],
	["now", "Now"],
	["ready", "Ready"],
	["later", "Needs earlier steps"],
];

function jumpTo(id: string) {
	blockEl(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function edgePath(g: Graph, from: MapNode, to: MapNode) {
	const { w, h, dir } = g.shape;
	if (dir === "LR") {
		const [x1, y1, x2, y2] = [from.x + w, from.y + h / 2, to.x, to.y + h / 2];
		const mid = (x1 + x2) / 2;
		return `M${x1} ${y1}C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
	}
	const [x1, y1, x2, y2] = [from.x + w / 2, from.y + h, to.x + w / 2, to.y];
	const mid = (y1 + y2) / 2;
	return `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
}

/** The map itself. `labels` false draws dots (the thumbnail). */
function MapSvg({ graph, labels, scale = 1, taught, onPick }: { graph: Graph; labels: boolean; scale?: number; taught?: Map<number, string>; onPick?: (id: string) => void }) {
	const arrow = useId();
	const { w, h } = graph.shape;
	return (
		// Sized inline: the base layer styles every svg as an 18px stroked icon.
		<svg
			viewBox={`0 0 ${graph.width} ${graph.height}`}
			className="mx-auto block flex-none"
			style={{ width: graph.width * scale, height: graph.height * scale, stroke: "none" }}
			role="img"
			aria-label="Plan map"
		>
			<defs>
				<marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
					<path d="M0 0.5 7.5 4 0 7.5z" style={{ fill: "var(--line-strong)" }} />
				</marker>
			</defs>
			{graph.edges.map(({ from, to }) => {
				const lit = from.status === "done";
				return (
					<path
						key={`${from.id}-${to.id}`}
						d={edgePath(graph, from, to)}
						markerEnd={labels ? `url(#${arrow})` : undefined}
						style={{ fill: "none", stroke: lit ? "var(--good-line)" : "var(--line-strong)", strokeWidth: labels ? 1.5 : 1.25 }}
					/>
				);
			})}
			{graph.nodes.map((n) => {
				const target = n.goal ? undefined : taught?.get(n.id);
				const pick = target && onPick ? () => onPick(target) : undefined;
				if (!labels)
					return (
						<g key={n.id}>
							<title>{n.label}</title>
							{n.status === "now" && <circle cx={n.x + w / 2} cy={n.y + h / 2} r={w / 2 + 3} style={{ fill: "var(--accent-soft)" }} />}
							{n.goal ? (
								<rect x={n.x} y={n.y} width={w} height={h} rx={3} style={{ fill: n.status === "done" ? "var(--good)" : "var(--bg)", stroke: "var(--accent-line)", strokeWidth: 1.5 }} />
							) : (
								<circle cx={n.x + w / 2} cy={n.y + h / 2} r={w / 2} style={{ fill: DOT_FILL[n.status] }} />
							)}
						</g>
					);
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: role and keyboard handling are set when the step is pickable
					<g
						key={n.id}
						role={pick ? "button" : undefined}
						tabIndex={pick ? 0 : undefined}
						aria-label={pick ? `Go to step ${n.id + 1}: ${n.label}` : undefined}
						onClick={pick}
						onKeyDown={pick && ((e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()))}
						className={cn("outline-none", pick && "group/node cursor-pointer")}
					>
						<title>{n.goal ? `Goal: ${n.label}` : `${n.id + 1}. ${n.label}`}</title>
						{n.status === "now" && <rect x={n.x - 4} y={n.y - 4} width={w + 8} height={h + 8} rx={16} style={{ fill: "none", stroke: "var(--accent-soft)", strokeWidth: 6 }} />}
						<rect
							x={n.x}
							y={n.y}
							width={w}
							height={h}
							rx={12}
							className="transition-[filter] duration-150 group-hover/node:brightness-110 group-focus-visible/node:[stroke:var(--accent)]"
							style={n.goal ? { fill: n.status === "done" ? "var(--good-soft)" : "var(--bg)", stroke: "var(--accent-line)", strokeWidth: 1.5 } : BOX_STYLE[n.status]}
						/>
						<foreignObject x={n.x} y={n.y} width={w} height={h}>
							<div className={cn("flex h-full items-center gap-2 px-3 font-ui text-[12.5px] leading-[1.25] select-none", n.goal ? "text-ink" : TEXT[n.status])}>
								{n.goal ? (
									<span className="flex-none font-medium text-primary">Goal</span>
								) : (
									<span
										className={cn(
											"grid size-[19px] flex-none place-items-center rounded-full text-[11px] font-semibold tabular-nums",
											n.status === "done" ? "bg-good text-primary-ink" : n.status === "now" ? "bg-primary text-primary-ink" : "bg-sunken text-ink-2",
										)}
									>
										{n.status === "done" ? (
											<svg viewBox="0 0 12 12" aria-hidden="true" className="size-2.5 fill-none stroke-current stroke-2">
												<path d="m2.5 6.2 2.3 2.3 4.7-5" />
											</svg>
										) : (
											n.id + 1
										)}
									</span>
								)}
								<span className={cn("line-clamp-2 min-w-0", n.status === "now" && "font-medium")} dangerouslySetInnerHTML={{ __html: renderInline(n.label) }} />
							</div>
						</foreignObject>
					</g>
				);
			})}
		</svg>
	);
}

function Legend({ className }: { className?: string }) {
	return (
		<ul className={cn("m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-ui text-[12px] text-ink-3", className)}>
			{LEGEND.map(([s, label]) => (
				<li key={s} className="flex items-center gap-1.5">
					<span className="size-2.5 rounded-[3px] border" style={{ background: BOX_STYLE[s].fill as string, borderColor: BOX_STYLE[s].stroke as string, borderStyle: s === "later" ? "dashed" : "solid" }} />
					{label}
				</li>
			))}
		</ul>
	);
}

const EXPAND = (
	<svg viewBox="0 0 20 20" aria-hidden="true" className="fill-none stroke-current stroke-[1.6]">
		<path d="M11.5 4.5h4v4M8.5 15.5h-4v-4M15.5 4.5 11 9M4.5 15.5 9 11" />
	</svg>
);

/** Fits the map to its container's width, measured once laid out. */
function useRoom<T extends HTMLElement>(fallback: number) {
	const ref = useRef<T>(null);
	const [room, setRoom] = useState(fallback);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setRoom(el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return [ref, room] as const;
}

/** In the chat, under the marker where the tutor presented the plan. */
export const PlanCard = memo(function PlanCard({ p }: { p: Progress }) {
	const marks = useProgressMarks();
	const taught = useMemo(() => taughtAt(marks), [marks]);
	const [ref, room] = useRoom<HTMLDivElement>(720);
	const graph = useMemo(() => fitPlan(p, room - 32), [p, room]);
	if (!graph) return null;
	const scale = Math.min(1, (room - 32) / graph.width);
	return (
		<figure className="mt-[-10px] mb-7 ml-0 mr-0 overflow-hidden rounded-[16px] border border-line bg-raised">
			<figcaption className="flex items-center gap-3 px-4 pt-3 pb-1">
				<span className="font-ui text-[13.5px] font-medium text-ink">Plan map</span>
				<span className="min-w-0 flex-1 truncate font-ui text-[12.5px] text-ink-3">{stageText(p)}</span>
				<Button variant="quiet" className="h-7 px-2 text-[12.5px]" onClick={() => setPlanMap(true)} aria-label="Open the plan map">
					{EXPAND}
					Open
				</Button>
			</figcaption>
			<div ref={ref} className="max-h-[420px] overflow-auto px-4 pb-3">
				<MapSvg graph={graph} labels scale={scale} taught={taught} onPick={jumpTo} />
			</div>
			<Legend className="border-t border-line px-4 py-2" />
		</figure>
	);
});

/** In the outline: a thumbnail that opens the full map. */
export function PlanThumb({ p }: { p: Progress }) {
	const graph = layoutPlan(p, { dir: "TB", ...DOT });
	if (!graph) return null;
	const scale = Math.min(1, 184 / graph.width);
	return (
		<button
			type="button"
			onClick={() => setPlanMap(true)}
			title="Open the plan map"
			className="group flex w-full cursor-pointer flex-col items-center gap-2 rounded-[12px] border border-line bg-transparent px-2 pt-3 pb-2 transition-[background,border-color] duration-150 hover:border-line-strong hover:bg-ink/5"
		>
			<MapSvg graph={graph} labels={false} scale={scale} />
			<span className="flex items-center gap-1 font-ui text-[12px] text-ink-3 group-hover:text-ink [&_svg]:size-3.5">
				{EXPAND}
				Open plan map
			</span>
		</button>
	);
}

/** The full map, over everything. */
export function PlanDialog() {
	const open = useStore((s) => s.planMapOpen);
	const marks = useProgressMarks();
	const ref = useRef<HTMLDialogElement>(null);
	const [body, room] = useRoom<HTMLDivElement>(1000);
	// Closed, it skips laying the map out.
	const p = useMemo(() => (open ? progressAt(marks) : null), [open, marks]);
	const taught = useMemo(() => taughtAt(marks), [marks]);

	useLayoutEffect(() => {
		const d = ref.current;
		if (!d) return;
		if (open && p?.steps && !d.open) d.showModal();
		else if (!(open && p?.steps) && d.open) d.close();
	}, [open, p?.steps]);

	const close = () => ref.current?.close();
	const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
		if (e.target === e.currentTarget && e.detail !== 0) close();
	};
	const graph = useMemo(() => p && fitPlan(p, room - 48), [p, room]);
	const scale = graph ? Math.max(0.75, Math.min(1.15, (room - 48) / graph.width)) : 1;

	return (
		<dialog
			ref={ref}
			aria-labelledby="plan-title"
			onClick={onBackdrop}
			onClose={() => {
				setPlanMap(false);
				focusComposer();
			}}
			className={cn(
				"m-auto h-[min(860px,calc(100vh_-_48px))] w-[min(1280px,calc(100vw_-_48px))] overflow-hidden rounded-[20px] border border-line bg-bg p-0 text-ink shadow-(--shadow)",
				"open:flex open:animate-[pop-in_240ms_var(--ease)_both] open:flex-col",
				"backdrop:bg-[color-mix(in_srgb,var(--shade)_55%,transparent)] light:backdrop:bg-[color-mix(in_srgb,var(--shade)_22%,transparent)]",
			)}
		>
			<header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line py-3.5 pr-3.5 pl-6">
				<div className="min-w-0 flex-1">
					<h2 id="plan-title" className="m-0 font-ui text-[17px]/[1.3] font-semibold">
						{p?.goal ? `Plan: ${p.goal}` : "Plan"}
					</h2>
					{p && <p className="m-0 mt-0.5 font-ui text-[13px] text-ink-3">{stageText(p)}. Click a step you've reached to go back to it.</p>}
				</div>
				<Legend />
				<Button variant="icon" aria-label="Close the plan map" title="Close (Esc)" onClick={close}>
					<svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 fill-none stroke-current stroke-[1.6]">
						<path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
					</svg>
				</Button>
			</header>
			<div ref={body} className="grid min-h-0 flex-1 place-items-center overflow-auto overscroll-contain p-6">
				{graph && (
					<MapSvg
						graph={graph}
						labels
						scale={scale}
						taught={taught}
						onPick={(id) => {
							close();
							jumpTo(id);
						}}
					/>
				)}
			</div>
		</dialog>
	);
}
