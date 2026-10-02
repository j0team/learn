// On wide windows a worksheet shows in the lesson as a one-line bar; Open puts it in a
// column beside the lesson, so the learner can scroll back through the lesson while
// answering. Narrower windows show the whole worksheet in the lesson.

import { Button } from "@/components/ui/button";
import { Markdown } from "@/lib/markdown";
import { setQuizOpen, useOpenQuiz, useStore, useWide } from "@/lib/store";
import type { QuizBlock } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QuizCard, QuizStatus } from "./QuizCard";

// Colour says where the worksheet stands: waiting on the learner, checked, or skipped.
const TONE = {
	pending: { bar: "border-primary-line bg-primary-soft", icon: "bg-primary text-primary-ink", sub: "text-primary", ring: "ring-primary-line" },
	answered: { bar: "border-good-line bg-good-soft", icon: "bg-good text-bg", sub: "text-good", ring: "ring-good-line" },
	cancelled: { bar: "border-line bg-raised opacity-70", icon: "bg-surface text-ink-3", sub: "text-ink-3", ring: "ring-line" },
};

/** A worksheet's place in the transcript. */
export function QuizSlot({ block: b, cls }: { block: QuizBlock; cls: string }) {
	const wide = useWide();
	const open = useStore((s) => s.quizOpen === b.id);
	if (!wide) return <QuizCard block={b} className={cls} />;
	const tone = TONE[b.state];
	return (
		<div
			data-block-id={b.id}
			className={cn(
				cls,
				"flex items-center gap-3 rounded-[14px] border py-2.5 pr-3 pl-3.5 font-ui shadow-[0_1px_2px_rgb(0_0_0/0.04)]",
				tone.bar,
				open && ["ring-2", tone.ring],
			)}
		>
			<span className={cn("grid size-9 flex-none place-items-center rounded-[10px]", tone.icon)}>
				<svg viewBox="0 0 20 20" aria-hidden="true" className="size-[18px] fill-none stroke-current stroke-[1.6] [stroke-linecap:round] [stroke-linejoin:round]">
					<path d={b.state === "answered" ? "m5 10.5 3.25 3.25L15 7" : "M6 3.5h8a1.5 1.5 0 0 1 1.5 1.5v10A1.5 1.5 0 0 1 14 16.5H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5ZM7.5 7.5h5M7.5 10.5h5M7.5 13.5h3"} />
				</svg>
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate text-[14px] leading-[1.35] font-medium text-ink">{b.title ? <Markdown inline text={b.title} /> : "Check-in"}</span>
				<span className={cn("truncate text-[12.5px] leading-[1.35]", tone.sub)}>
					{b.title ? "Check-in · " : ""}
					<QuizStatus block={b} />
				</span>
			</span>
			<Button variant={open ? "quiet" : b.state === "pending" ? "primary" : "chip"} onClick={() => setQuizOpen(open ? null : b.id)}>
				{open ? "Close" : "Open"}
			</Button>
		</div>
	);
}

/** The column beside the lesson; empty (and zero wide) unless a worksheet is open there. */
export function QuizPane() {
	const b = useOpenQuiz();
	return (
		<aside
			aria-label="Open check-in"
			className={cn("col-start-3 row-start-1 h-screen min-w-0 overflow-hidden border-l bg-bg", b ? "border-line" : "border-transparent")}
		>
			{b && <QuizCard key={b.id} block={b} onClose={() => setQuizOpen(null)} />}
		</aside>
	);
}
