// The plan as a dependency map: steps in teaching order, each building on
// earlier ones, the learner's goal as the sink. Laid out in layers (a step sits
// one layer after the deepest step it needs), ordered to keep edges straight.

import type { Progress } from "@/components/outline/progress";

export type Status = "done" | "now" | "ready" | "later";
export type MapNode = { id: number; label: string; status: Status; goal: boolean; x: number; y: number };
type MapEdge = { from: MapNode; to: MapNode };
type Shape = { dir: "LR" | "TB"; w: number; h: number; along: number; across: number; pad: number };
export type Graph = { nodes: MapNode[]; edges: MapEdge[]; width: number; height: number; shape: Shape };

/** Readable node boxes, for the chat card and the overlay. */
const BOX = { w: 176, h: 54, along: 56, across: 18, pad: 14 };
/** Dots, for the outline's thumbnail. */
export const DOT = { w: 12, h: 12, along: 14, across: 12, pad: 6 };

/** Each step's prerequisites; a plan without them is a straight chain. */
function prerequisites(p: Progress): number[][] {
	const steps = p.steps ?? [];
	return steps.map((_, i) => p.depends?.[i] ?? (i ? [i - 1] : []));
}

function statuses(p: Progress): Status[] {
	const teaching = p.phase === "teach" && p.current != null;
	const done = (i: number) => teaching && i < p.current!;
	return prerequisites(p).map((needs, i) => (done(i) ? "done" : teaching && i === p.current ? "now" : needs.every(done) ? "ready" : "later"));
}

export function layoutPlan(p: Progress, shape: Shape): Graph | null {
	const steps = p.steps;
	if (!steps?.length) return null;
	const status = statuses(p);
	const needs = prerequisites(p);
	const used = new Set(needs.flat());
	if (p.goal) needs.push(steps.map((_, i) => i).filter((i) => !used.has(i)));
	const allDone = status.every((s) => s === "done");

	const layer: number[] = [];
	needs.forEach((n, i) => (layer[i] = n.length ? 1 + Math.max(...n.map((j) => layer[j])) : 0));
	const layers: number[][] = [];
	needs.forEach((_, i) => (layers[layer[i]] ??= []).push(i));

	// One barycenter pass: each node sits near the average of what it builds on.
	const across: number[] = [];
	const place = (ids: number[]) => ids.forEach((id, k) => (across[id] = k - (ids.length - 1) / 2));
	place(layers[0]);
	for (const ids of layers.slice(1)) {
		const pull = (id: number) => needs[id].reduce((sum, j) => sum + across[j], 0) / needs[id].length;
		ids.sort((a, b) => pull(a) - pull(b) || a - b);
		place(ids);
	}

	const lr = shape.dir === "LR";
	const stepAlong = (lr ? shape.w : shape.h) + shape.along;
	const stepAcross = (lr ? shape.h : shape.w) + shape.across;
	const minAcross = Math.min(...across);
	const nodes: MapNode[] = needs.map((_, i) => {
		const a = shape.pad + layer[i] * stepAlong;
		const c = shape.pad + (across[i] - minAcross) * stepAcross;
		const goal = i === steps.length;
		return { id: i, label: goal ? p.goal! : steps[i], status: goal ? (allDone ? "done" : "later") : status[i], goal, x: lr ? a : c, y: lr ? c : a };
	});
	const edges = needs.flatMap((n, i) => n.map((j) => ({ from: nodes[j], to: nodes[i] })));
	const width = Math.max(...nodes.map((n) => n.x)) + shape.w + shape.pad;
	const height = Math.max(...nodes.map((n) => n.y)) + shape.h + shape.pad;
	return { nodes, edges, width, height, shape };
}

/** Left to right when that fits `room` without shrinking much; otherwise top to bottom. */
export function fitPlan(p: Progress, room: number): Graph | null {
	const wide = layoutPlan(p, { dir: "LR", ...BOX });
	if (!wide || wide.width * 0.85 <= room) return wide;
	return layoutPlan(p, { dir: "TB", ...BOX });
}
