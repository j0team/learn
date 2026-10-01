// Home: the page a new lesson opens on. The mascot, a greeting, and a few numbers
// drawn from every lesson on disk, then recent lessons.

import { type CSSProperties, useEffect, useState } from "react";
import { LivelyMascot } from "@/components/Mascot";
import { LessonButton, lessonTree } from "@/components/sidebar/lessons";
import { getJson, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Stats = { lessons: number; streak: number; answered: number; graded: number; correct: number; days: { day: string; count: number }[] };

function greeting() {
	const hr = new Date().getHours();
	return hr < 5 ? "Up late?" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
}

export function Home() {
	const [greet] = useState(greeting);
	const stats = useStats();
	const lessons = useStore((s) => s.lessons);
	const current = useStore((s) => s.session.file);
	const recent = lessonTree(lessons.sessions)
		.filter((s) => s.file !== current)
		.slice(0, 4);
	// Two columns once there's something to show on the right; a first visit stays centred.
	const split = !!stats?.lessons || recent.length > 0;

	return (
		<section
			className={cn(
				"mx-auto grid min-h-[calc(100%-var(--dock-h,140px))] content-center pt-[6vh] pb-12 narrow:w-[calc(100%-32px)]",
				split
					? "w-[min(1120px,100%-64px)] grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] items-center gap-x-[clamp(40px,6vw,96px)] gap-y-10 max-[1100px]:w-[min(var(--measure),100%-64px)] max-[1100px]:grid-cols-1"
					: "w-[min(var(--measure),100%-64px)]",
			)}
		>
			<div className={cn("flex flex-col", split ? "items-start text-left" : "items-center text-center")}>
				<LivelyMascot className="hero-mascot mb-5 rounded-[28px]" svgClassName={cn("inline align-baseline", split ? "size-28" : "size-32")} />
				<p className="mt-0 mb-2 font-ui text-[15px] leading-[normal] font-medium text-primary">{greet}</p>
				<h2
					className={cn(
						"mt-0 mb-4 font-ui leading-[1.06] font-medium tracking-[-0.03em]",
						split ? "max-w-[12ch] text-[clamp(34px,3.8vw,52px)]" : "text-[clamp(30px,3.6vw,42px)]",
					)}
				>
					What do you want to learn?
				</h2>
				<p className="m-0 font-ui text-[16.5px] leading-normal text-ink-2">Type your question in the box below and ask away.</p>
			</div>
			{split && (
				<div className="min-w-0">
					{!!stats?.lessons && <StatTiles s={stats} />}
					{!!recent.length && (
						<div>
							<h3 className="mt-0 mb-2 text-[12.5px] font-medium text-ink-3">Pick up where you left off</h3>
							{recent.map((s) => (
								<LessonButton
									key={s.file}
									s={s}
									current={null}
									depth={0}
									className="group/rec flex w-full justify-between gap-4 border-0 border-t border-line bg-transparent py-3 text-left text-[15px] text-ink last:border-b"
									tClass="min-w-0 truncate group-hover/rec:text-primary"
									dClass="flex-none text-[13px] text-ink-3"
								/>
							))}
						</div>
					)}
				</div>
			)}
		</section>
	);
}

const tile = "rounded-2xl border border-line bg-[color-mix(in_oklab,var(--surface)_55%,transparent)] px-4 py-3.5";
const label = "mt-1 block font-ui text-[12.5px] leading-[normal] font-medium text-ink-3";

/** Reloaded each time Home mounts. */
function useStats() {
	const [s, setS] = useState<Stats | null>(null);
	useEffect(() => {
		let live = true;
		getJson<Stats>("/api/stats").then((v) => live && setS(v));
		return () => void (live = false);
	}, []);
	return s;
}

function StatTiles({ s }: { s: Stats }) {

	const peak = Math.max(1, ...s.days.map((d) => d.count));
	const tiles: [string | number, string, boolean?][] = [
		[s.streak, s.streak === 1 ? "day streak" : "days in a row", !!s.streak],
		[s.lessons, s.lessons === 1 ? "lesson" : "lessons"],
		[s.answered, "questions answered"],
		[s.graded ? `${Math.round((100 * s.correct) / s.graded)}%` : "None yet", "multiple choice correct"],
	];
	return (
		<div className="mb-8 grid grid-cols-2 gap-2.5 max-[1100px]:grid-cols-4 max-[640px]:grid-cols-2">
			{tiles.map(([value, text, hot]) => (
				<div key={text} className={tile}>
					<b className={cn("block font-ui text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums", hot ? "text-primary" : "text-ink")}>{String(value)}</b>
					<span className={label}>{text}</span>
				</div>
			))}
			<div className={cn(tile, "col-span-full")}>
				<h3 className={cn(label, "mt-0 mb-2.5")}>Last 14 days</h3>
				<div className="grid h-11 grid-cols-[repeat(14,1fr)] items-end gap-1.5">
					{s.days.map((d, i) => (
						<i
							key={d.day}
							className={cn(
								"block h-[max(4px,calc(var(--v)*100%))] rounded-[4px] bg-[color-mix(in_oklab,var(--accent)_calc(18%+var(--v)*82%),var(--sunken))]",
								i === s.days.length - 1 && "outline-[1.5px] outline-offset-2 outline-primary-line outline-solid",
							)}
							style={{ "--v": (d.count / peak).toFixed(3) } as CSSProperties}
							title={`${d.count} message${d.count === 1 ? "" : "s"} on ${new Date(`${d.day}T12:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
