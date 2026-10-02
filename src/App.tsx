import { useEffect, useRef } from "react";
import { Composer } from "@/components/composer/Composer";
import { Home } from "@/components/home/Home";
import { Outline } from "@/components/outline/Outline";
import { PlanDialog } from "@/components/plan/PlanMap";
import { Onboarding } from "@/components/settings/Onboarding";
import { Settings } from "@/components/settings/Settings";
import { SideChat } from "@/components/side/SideChat";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Topbar } from "@/components/Topbar";
import { installRewindKeys, Transcript } from "@/components/transcript/Transcript";
import { installShortcuts } from "@/lib/shortcuts";
import { QuizPane } from "@/components/transcript/cards/QuizBeside";
import { connect, layout, useOpenQuiz, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function App() {
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const quizBeside = !!useOpenQuiz();
	const hasContent = useStore((s) => s.blocks.length > 0);
	const title = useStore((s) => s.session.title);
	const scroller = useRef<HTMLDivElement>(null);

	useEffect(() => {
		layout.scroller = scroller.current;
		return () => void (layout.scroller = null);
	}, []);
	useEffect(connect, []);
	useEffect(installShortcuts, []);
	useEffect(installRewindKeys, []);
	useEffect(() => {
		document.title = title && hasContent ? `${title} · Learn` : "Learn";
	}, [title, hasContent]);

	return (
		<div
			className={cn(
				"grid h-full transition-[grid-template-columns] duration-220 ease-soft in-data-resizing:transition-none",
				// Sidebar, lesson, and the open worksheet when it's beside the lesson.
				"grid-cols-[var(--sidebar-col)_minmax(0,1fr)_var(--quiz-col)]",
				sidebarOpen ? "[--sidebar-col:var(--sidebar-w)]" : "[--sidebar-col:0px]",
				quizBeside ? "[--quiz-col:var(--quiz-w)]" : "[--quiz-col:0px]",
				"narrow:[--sidebar-col:0px]",
			)}
		>
			<Sidebar />
			{/* minmax(0, 1fr): a long lesson title must not widen the column. col-start-2: on narrow
			    screens the sidebar is fixed (out of the grid), which would otherwise pull this into its 0px column. */}
			<div className="relative col-start-2 grid h-screen min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
				<Topbar />
				{/* --outline-pad: room the outline keeps on the right (set by Outline). */}
				<div ref={scroller} className="overflow-x-hidden overflow-y-auto pr-(--outline-pad,0px)">
					{hasContent ? <Transcript /> : <Home />}
				</div>
				<Outline />
				<Composer />
			</div>
			<QuizPane />
			<SideChat />
			<Settings />
			<Onboarding />
			<PlanDialog />
		</div>
	);
}
