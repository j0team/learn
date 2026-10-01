// Working status line. Claude Code style: while the tutor is doing anything, a
// line above the composer says what (thinking, writing, running a tool), for how
// long, and how much it's written so far. It stays up for the whole run, not
// just the first token.

import { useEffect, useState } from "react";
import type { Block } from "@/lib/types";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { fmtTokens } from "./format";

const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const IDLE_VERBS = ["Pondering", "Mulling it over", "Puzzling", "Working it out", "Connecting the dots", "Considering", "Sketching"];

// What the tutor is doing right now, read off the current run's blocks.
function activity(blocks: Block[], idle: string) {
	const run = blocks.slice(blocks.findLastIndex((b) => b.kind === "user") + 1);
	const tokens = run.reduce((n, b) => n + (b.kind === "assistant" ? b.outTokens || 0 : 0), 0);
	const tool = run.findLast((b) => b.kind === "tool" && b.status === "running");
	if (tool?.kind === "tool") return { verb: tool.label, tokens };
	const a = run.findLast((b) => b.kind === "assistant");
	if (a?.kind === "assistant" && !a.done) {
		if (a.drafting) return { verb: a.drafting === "worksheet" || a.drafting === "question" ? `Writing a ${a.drafting}` : `Calling ${a.drafting}`, tokens };
		const last = a.parts.findLast((p) => p);
		if (last?.type === "thinking") return { verb: "Thinking", tokens, thinking: true };
		if (last?.type === "text") return { verb: "Writing", tokens };
	}
	return { verb: idle, tokens };
}

function elapsed(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Mounted only while it shows; `hidden` keeps it out of sight under the suggestions. */
export function WorkingLine({ hidden }: { hidden: boolean }) {
	const blocks = useStore((s) => s.blocks);
	const busySince = useStore((s) => s.busySince);
	const [idle] = useState(() => IDLE_VERBS[Math.floor(Math.random() * IDLE_VERBS.length)]);
	const [frame, setFrame] = useState(1);

	useEffect(() => {
		const timer = setInterval(() => setFrame((f) => (f + 1) % SPIN.length), 120);
		return () => clearInterval(timer);
	}, []);

	const { verb, tokens, thinking } = activity(blocks, idle);
	const meta = [elapsed(Date.now() - (busySince || Date.now())), tokens ? `↓ ${fmtTokens(tokens)} token${tokens === 1 ? "" : "s"}` : "", "esc to interrupt"];

	return (
		<div className={cn("pointer-events-none absolute right-1.5 bottom-[calc(100%+8px)] left-1.5 flex", hidden && "invisible")}>
			<div
				className={cn(
					"glass pointer-events-auto inline-flex max-w-full min-w-0 animate-pop-in items-baseline gap-[9px] rounded-full py-[7px] pr-4 pl-[13px] text-[13.5px] text-ink-3 transition-[box-shadow] duration-200",
					thinking && "[box-shadow:0_0_0_1px_var(--accent-line),0_10px_30px_-12px_color-mix(in_oklab,var(--accent)_45%,transparent)]!",
				)}
			>
				<span className="w-[1.1em] flex-none text-center font-mono text-[16px] leading-none text-primary" aria-hidden="true">
					{SPIN[frame]}
				</span>
				{/* A highlight sweeps across the verb so it reads as live even when nothing new arrives. */}
				<span
					role="status"
					className={cn(
						"max-w-[60%] flex-none animate-[shimmer_2.2s_linear_infinite] truncate bg-size-[250%_100%] bg-clip-text bg-position-[0_0] font-semibold text-transparent",
						thinking
							? "bg-[linear-gradient(90deg,var(--accent)_0_30%,var(--ink)_50%,var(--accent)_70%_100%)]"
							: "bg-[linear-gradient(90deg,var(--ink-2)_0_38%,var(--accent)_50%,var(--ink-2)_62%_100%)]",
					)}
				>
					{verb}…
				</span>
				<span className="min-w-0 truncate font-mono text-[12px] leading-[normal] text-ink-3">{meta.filter(Boolean).join("  ·  ")}</span>
			</div>
		</div>
	);
}
