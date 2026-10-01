// Context fill, the same figure as the terminal's status line.

import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { fmtTokens } from "./format";

export function UsageMeter() {
	const u = useStore((s) => s.usage);
	if (!u?.contextWindow) return null;
	const known = typeof u.tokens === "number";
	const tokens = u.tokens ?? 0;
	const pct = known ? Math.min(100, (tokens / u.contextWindow) * 100) : 0;
	const cost = u.cost ? ` · $${u.cost.toFixed(2)} this lesson` : "";
	const title = known
		? `Context: ${tokens.toLocaleString()} of ${u.contextWindow.toLocaleString()} tokens (${pct.toFixed(1)}%)${cost}`
		: `Context size unknown until the next reply${cost}`;
	return (
		<span className="inline-flex h-7 cursor-default items-center gap-1.5 pr-2.5 pl-1.5 font-mono text-[12px] leading-[normal] whitespace-nowrap text-ink-3" title={title}>
			<svg viewBox="0 0 20 20" aria-hidden="true" className="size-4 -rotate-90 [&_circle]:fill-none [&_circle]:stroke-[2.6]">
				<circle className="stroke-ink/14" cx="10" cy="10" r="7" />
				<circle
					className={cn("[stroke-linecap:round] transition-[stroke-dasharray] duration-400 ease-soft", pct >= 85 ? "stroke-bad" : pct >= 60 ? "stroke-warn" : "stroke-primary")}
					style={{ strokeDasharray: `${pct} 100` }}
					cx="10"
					cy="10"
					r="7"
					pathLength="100"
				/>
			</svg>
			<span className="narrow:hidden">
				{known ? fmtTokens(tokens) : "?"} / {fmtTokens(u.contextWindow)}
			</span>
		</span>
	);
}
