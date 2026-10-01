import type { CSSProperties } from "react";
import { closeDrawerOnNarrow, post, useStore } from "@/lib/store";
import type { Lesson } from "@/lib/types";
import { cn } from "@/lib/utils";

export type LessonNode = Lesson & { kids: LessonNode[]; latest?: number };

export function ago(ms: number) {
	const s = (Date.now() - ms) / 1000;
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	const d = new Date(ms);
	return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

// Branches and forks nest under the lesson they came from; a lesson group
// sorts by its most recently touched branch.
export function lessonTree(sessions: Lesson[]): LessonNode[] {
	const byFile = new Map<string, LessonNode>(sessions.map((s) => [s.file, { ...s, kids: [] }]));
	const roots: LessonNode[] = [];
	for (const s of byFile.values()) {
		const parent = s.parent ? byFile.get(s.parent) : undefined;
		(parent && parent !== s ? parent.kids : roots).push(s);
	}
	const latest = (s: LessonNode): number => (s.latest ??= Math.max(s.updated, ...s.kids.map(latest)));
	const order = (list: LessonNode[]) => {
		list.sort((a, b) => latest(b) - latest(a));
		for (const s of list) order(s.kids);
	};
	order(roots);
	return roots;
}

export function countBranches(file: string, all: Lesson[]) {
	let n = 0;
	const walk = (f: string) => {
		for (const s of all) if (s.parent === f) n++, walk(s.file);
	};
	walk(file);
	return n;
}

const IconBranch = ({ className }: { className?: string }) => (
	<svg className={className} viewBox="0 0 20 20" aria-hidden="true">
		<circle cx="6.5" cy="5" r="1.6" />
		<circle cx="6.5" cy="15" r="1.6" />
		<circle cx="13.5" cy="6.5" r="1.6" />
		<path d="M6.5 6.6v6.8M13.5 8.1c0 3.2-3.8 3.4-6.3 5.2" />
	</svg>
);

// A lesson whose tutor is still at it, here or in the background.
const Working = () => (
	<span className="inline-flex items-center gap-1.5 text-primary">
		<span className="size-1.5 animate-pulse-dot rounded-full bg-current" aria-hidden="true" />
		Working
	</span>
);

/** One lesson: its title and when it was last touched. `tClass`/`dClass` style the two lines. */
export function LessonButton({
	s,
	current,
	depth,
	className,
	tClass,
	dClass,
	open = () => s.file !== current && post("/api/open", { file: s.file }),
}: {
	s: LessonNode;
	current: string | null;
	depth: number;
	className?: string;
	tClass?: string;
	dClass?: string;
	open?: () => unknown;
}) {
	const running = useStore((st) => st.running.includes(s.file));
	const onClick = () => {
		open();
		closeDrawerOnNarrow();
	};
	if (depth) {
		// A branch shares its lesson's title; its latest message is what tells them apart.
		return (
			<button
				type="button"
				className={className}
				style={{ "--depth": Math.min(depth, 3) } as CSSProperties}
				title={`Branch of ${s.title}`}
				aria-current={s.file === current ? "true" : undefined}
				onClick={onClick}
			>
				<span className={cn(tClass, "flex items-center gap-1.5 text-[13px]")}>
					<IconBranch className="size-[13px] flex-none text-ink-3" />
					<span className="overflow-hidden text-ellipsis">{s.last || s.title}</span>
				</span>
				<span className={cn(dClass, "pl-[19px]")}>{running ? <Working /> : ago(s.updated)}</span>
			</button>
		);
	}
	return (
		<button type="button" className={className} aria-current={s.file === current ? "true" : undefined} onClick={onClick}>
			<span className={tClass}>{s.title}</span>
			<span className={dClass}>{running ? <Working /> : ago(s.latest ?? s.updated)}</span>
		</button>
	);
}
