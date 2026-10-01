import { useShallow } from "zustand/react/shallow";
import { useStore } from "@/lib/store";
import type { Block, Phase, ProgressBlock } from "@/lib/types";

export const PHASES: [Phase, string, string][] = [
	["probe", "Probe", "Finding where your understanding runs out"],
	["plan", "Plan", "Mapping the route to your goal"],
	["teach", "Teach", "Building it one step at a time"],
];

export type Progress = { phase: Phase; steps: string[] | null; depends: number[][] | null; goal: string | null; current: number | null };

/** The lesson's progress markers. They keep their identity while text streams in,
 *  so anything memoized on them skips the per-delta renders. */
export const useProgressMarks = () => useStore(useShallow((s) => s.blocks.filter((b): b is ProgressBlock => b.kind === "progress")));

/** Where each step was taught, so the map can jump there. */
export function taughtAt(blocks: Block[]) {
	const at = new Map<number, string>();
	for (const b of blocks) if (b.kind === "progress" && b.phase === "teach" && b.current != null && !at.has(b.current)) at.set(b.current, b.id);
	return at;
}

/** The lesson's progress as of block `upTo` (or the latest). */
export function progressAt(blocks: Block[], upTo?: Block): Progress | null {
	let p: Progress | null = null;
	for (const b of blocks) {
		if (b.kind === "progress") {
			const prev = p as Progress | null;
			// A new plan replaces the old one whole; later markers keep it.
			const plan = b.steps?.length
				? { steps: b.steps, depends: b.depends ?? null, goal: b.goal ?? null }
				: { steps: prev?.steps || null, depends: prev?.depends ?? null, goal: prev?.goal ?? null };
			p = {
				phase: b.phase,
				...plan,
				current: b.current ?? (b.phase === "teach" ? prev?.current : null) ?? null,
			};
		}
		if (b === upTo) break;
	}
	return p;
}

export function stageText(p: Progress): string {
	if (p.phase !== "teach" || !p.steps) return PHASES.find(([id]) => id === p.phase)![2];
	if (p.current == null) return `${p.steps.length} steps planned`;
	if (p.current >= p.steps.length) return "Every step done";
	return `Step ${p.current + 1} of ${p.steps.length} · ${p.steps[p.current]}`;
}
