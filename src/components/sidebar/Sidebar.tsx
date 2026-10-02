import { Fragment, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/ui/button";
import { archiveLesson, deleteLesson, goHome, newLesson, renameLesson, restoreLesson, setLessonMenu, setSettings, setSidebar, useStore } from "@/lib/store";
import { useShortcutHint } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { ago, countBranches, LessonButton, type LessonNode, lessonTree } from "./lessons";

const root = document.documentElement;

const navItem =
	"flex w-full items-center gap-2.5 rounded-[9px] border-0 bg-transparent px-2.5 py-2 text-left font-ui text-sm leading-[normal] font-medium text-ink-2 transition-[background,color] duration-150 hover:bg-sunken hover:text-ink aria-[current=page]:bg-sunken aria-[current=page]:text-ink";

export function Sidebar() {
	const open = useStore((s) => s.sidebarOpen);
	const home = useStore((s) => !s.blocks.length);
	const lessons = useStore((s) => s.lessons);
	const current = useStore((s) => s.session.file);
	const roots = lessonTree(lessons.sessions);
	const archived = lessonTree(lessons.archived);
	const newHint = useShortcutHint("new");
	const sidebarHint = useShortcutHint("sidebar");
	const settingsHint = useShortcutHint("settings");

	return (
		<aside
			id="sidebar"
			aria-label="Lessons"
			className={cn(
				"relative flex min-w-0 flex-col overflow-hidden border-r border-line bg-[color-mix(in_oklab,var(--panel)_62%,transparent)]",
				!open && "border-r-transparent",
				// Blurred only where it covers the lesson. Beside it there's just the ambient light
				// behind, and the blur there flickers while the lesson scrolls.
				"narrow:fixed narrow:inset-y-0 narrow:left-0 narrow:z-5 narrow:w-[260px] narrow:shadow-soft narrow:backdrop-blur-[28px] narrow:backdrop-saturate-150 narrow:transition-transform narrow:duration-220 narrow:ease-soft",
				!open && "narrow:-translate-x-full",
			)}
		>
			<div className="flex min-w-(--sidebar-w) items-center justify-between pt-3.5 pr-2.5 pb-2.5 pl-4 narrow:min-w-0">
				<span className="mascot-host inline-flex items-center gap-2 font-ui text-[17px] leading-none font-semibold tracking-[-0.02em] text-ink">
					<Mascot className="size-7" />
					learn
				</span>
				<Button variant="icon" aria-label="Hide lessons" title={`Hide lessons${sidebarHint}`} onClick={() => setSidebar(false)}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M12.5 5 7.5 10l5 5" />
					</svg>
				</Button>
			</div>
			<div className="flex min-w-(--sidebar-w) flex-col gap-px px-1.5 pt-0.5 narrow:min-w-0">
				<button className={navItem} type="button" aria-current={home ? "page" : undefined} onClick={goHome}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M3.5 9 10 3.5 16.5 9M5.5 7.5v8h9v-8M8.5 15.5v-4h3v4" />
					</svg>
					<span>Home</span>
				</button>
				<button className={navItem} type="button" title={newHint} onClick={newLesson}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M10 4.5v11M4.5 10h11" />
					</svg>
					<span>New lesson</span>
				</button>
			</div>
			<hr className="mx-4 mt-2.5 mb-0 min-w-0 border-0 border-t border-line" />
			<nav className="min-w-(--sidebar-w) flex-1 overflow-y-auto px-1.5 pb-4 narrow:min-w-0">
				<h3 className="mx-2.5 mt-3.5 mb-1.5 text-[12.5px] font-medium text-ink-3">Lessons</h3>
				{!roots.length && <div className="px-3 py-2 text-ink-3">Your lessons will show up here.</div>}
				<Tree nodes={roots} current={current} archived={false} />
				{!!archived.length && <Archived count={lessons.archived.length} nodes={archived} />}
			</nav>
			<button
				className="mx-2.5 mt-1.5 mb-3 flex min-w-(--sidebar-w) cursor-pointer items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left font-ui text-sm leading-[normal] font-medium text-ink-2 transition-[background,color] duration-150 hover:bg-ink/7 hover:text-ink narrow:min-w-0 [&_svg]:stroke-[1.5]"
				type="button"
				title={`Settings${settingsHint}`}
				aria-haspopup="dialog"
				aria-controls="settings"
				onClick={() => setSettings(true)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
				<span>Settings</span>
			</button>
			<ResizeGrip />
		</aside>
	);
}

function Archived({ count, nodes }: { count: number; nodes: LessonNode[] }) {
	const [open, setOpen] = useState(() => localStorage.getItem("learn-archived-open") === "1");
	// A menu opened on an archived row unfolds the box.
	const hasMenu = useStore((s) => !!s.lessonMenu && s.lessons.archived.some((l) => l.file === s.lessonMenu?.file));
	useEffect(() => {
		if (hasMenu) setOpen(true);
	}, [hasMenu]);
	return (
		<details
			className="group/arch mt-3.5"
			open={open}
			onToggle={(e) => {
				const o = e.currentTarget.open;
				setOpen(o);
				localStorage.setItem("learn-archived-open", o ? "1" : "0");
			}}
		>
			<summary className="mx-2.5 mb-1.5 cursor-pointer list-none text-[12.5px] font-medium text-ink-3 before:content-['▸_'] group-open/arch:before:content-['▾_'] [&::-webkit-details-marker]:hidden">
				Archived · {count}
			</summary>
			<Tree nodes={nodes} current={null} archived />
		</details>
	);
}

function Tree({ nodes, current, archived, depth = 0 }: { nodes: LessonNode[]; current: string | null; archived: boolean; depth?: number }) {
	return nodes.map((s) => (
		<Fragment key={s.file}>
			<LessonRow s={s} current={current} depth={depth} archived={archived} />
			<Tree nodes={s.kids} current={current} archived={archived} depth={depth + 1} />
		</Fragment>
	));
}

/** Row = open button + a ⋯ menu that shows on hover. Renaming swaps the title for a field. */
function LessonRow({ s, current, depth, archived }: { s: LessonNode; current: string | null; depth: number; archived: boolean }) {
	const menu = useStore((st) => (st.lessonMenu?.file === s.file ? st.lessonMenu : null));
	const [renaming, setRenaming] = useState(false);
	const row = useRef<HTMLDivElement>(null);
	const more = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (menu) row.current?.scrollIntoView({ block: "nearest" });
	}, [menu]);
	const rowCls = "my-px block w-full rounded-[9px] border-0 py-2 pr-[34px] pl-2.5 text-left";
	return (
		<div ref={row} className="group/row relative" data-menu-open={menu ? "" : undefined}>
			{renaming ? (
				<RenameField s={s} className={cn(rowCls, "bg-sunken pr-2.5 shadow-[inset_0_0_0_1px_var(--accent-line)]")} done={() => setRenaming(false)} />
			) : (
				<LessonButton
					s={s}
					current={current}
					depth={depth}
					// Opening an archived lesson brings it (and its branches) back first.
					open={archived ? () => restoreLesson(s.file, true) : undefined}
					className={cn(
						rowCls,
						"bg-transparent transition-[background,color] duration-150 hover:bg-sunken aria-[current=true]:bg-sunken aria-[current=true]:text-ink aria-[current=true]:shadow-[inset_0_0_0_1px_var(--line)]",
						archived ? "text-ink-3" : "text-ink-2 hover:text-ink",
						depth > 0 && "pl-[calc(10px+var(--depth,1)*14px)]",
					)}
					tClass="block overflow-hidden text-ellipsis whitespace-nowrap"
					dClass="mt-px block text-[12px] text-ink-3"
				/>
			)}
			{!renaming && (
				<Button
					ref={more}
					variant="icon"
					className={cn(
						"absolute top-[5px] right-1 size-[26px] opacity-0 transition-opacity duration-120 group-hover/row:opacity-100 focus-visible:opacity-100 no-hover:opacity-100 [&_svg]:size-4",
						menu && "opacity-100",
					)}
					aria-label="Lesson actions"
					aria-haspopup="menu"
					aria-expanded={!!menu}
					title={archived ? "Rename, restore or delete" : "Rename, archive or delete"}
					onClick={(e) => {
						e.stopPropagation();
						setLessonMenu(menu ? null : { file: s.file, confirm: false });
					}}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<circle cx="5" cy="10" r="1.2" className="fill" />
						<circle cx="10" cy="10" r="1.2" className="fill" />
						<circle cx="15" cy="10" r="1.2" className="fill" />
					</svg>
				</Button>
			)}
			{menu && (
				<LessonMenu
					key={String(menu.confirm)}
					anchor={more}
					file={s.file}
					archived={archived}
					confirm={menu.confirm}
					// Branches show their latest message rather than a name, so only whole lessons rename.
					rename={depth ? undefined : () => setRenaming(true)}
				/>
			)}
		</div>
	);
}

/** The title as a text field: Enter or clicking away saves, Esc keeps the old name. */
function RenameField({ s, className, done }: { s: LessonNode; className: string; done: () => void }) {
	const [value, setValue] = useState(s.title);
	const settled = useRef(false);
	const finish = (save: boolean) => {
		if (settled.current) return;
		settled.current = true;
		if (save && value.trim() && value.trim() !== s.title) renameLesson(s.file, value);
		done();
	};
	return (
		<div className={className}>
			<input
				autoFocus
				// All selected, caret at the start so the beginning of a long title shows.
				onFocus={(e) => e.currentTarget.setSelectionRange(0, e.currentTarget.value.length, "backward")}
				value={value}
				maxLength={120}
				aria-label="Lesson name"
				className="block w-full border-0 bg-transparent p-0 font-ui text-sm leading-[1.45] text-ink outline-none focus-visible:outline-none"
				onChange={(e) => setValue(e.target.value)}
				onBlur={() => finish(true)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.nativeEvent.isComposing) {
						e.preventDefault();
						finish(true);
					} else if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						finish(false);
					}
				}}
			/>
			<span className="mt-px block text-[12px] text-ink-3">{ago(s.latest ?? s.updated)}</span>
		</div>
	);
}

const menuBtn =
	"cursor-pointer rounded-lg border-0 bg-transparent px-2.5 py-[7px] text-left font-ui text-[13px] leading-[normal] whitespace-nowrap text-ink-2 hover:bg-ink/9 hover:text-ink focus-visible:bg-ink/9 focus-visible:text-ink focus-visible:outline-none";
const danger = "text-bad hover:bg-bad-soft hover:text-bad focus-visible:bg-bad-soft focus-visible:text-bad";
const GAP = 4;
const EDGE = 8;

/** A small menu under the ⋯ button, right edges lined up; it opens upward when
 *  there's no room below. Rendered on <body> so the lesson list can't clip it. */
function LessonMenu({
	anchor,
	file,
	archived,
	confirm: startConfirm,
	rename,
}: {
	anchor: RefObject<HTMLButtonElement | null>;
	file: string;
	archived: boolean;
	confirm: boolean;
	rename?: () => void;
}) {
	const [confirm, setConfirm] = useState(startConfirm);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const box = useRef<HTMLDivElement>(null);
	const all = useStore((s) => (archived ? s.lessons.archived : s.lessons.sessions));
	const branches = countBranches(file, all);
	const plural = `${branches} branch${branches > 1 ? "es" : ""}`;

	// Kept under its ⋯ button as the list scrolls (the row scrolls into view as the menu opens) or the window resizes.
	useLayoutEffect(() => {
		const place = () => {
			const a = anchor.current?.getBoundingClientRect();
			const m = box.current?.getBoundingClientRect();
			if (!a || !m) return;
			const below = a.bottom + GAP;
			const top = below + m.height > innerHeight - EDGE ? Math.max(EDGE, a.top - GAP - m.height) : below;
			setPos({ left: Math.max(EDGE, Math.min(a.right - m.width, innerWidth - EDGE - m.width)), top });
		};
		place();
		document.addEventListener("scroll", place, true);
		window.addEventListener("resize", place);
		return () => {
			document.removeEventListener("scroll", place, true);
			window.removeEventListener("resize", place);
		};
	}, [anchor, confirm]);
	useEffect(() => {
		box.current?.querySelector("button")?.focus({ preventScroll: true });
	}, [confirm]);
	useEffect(() => {
		const close = () => setLessonMenu(null);
		const down = (e: PointerEvent) => {
			if (!(e.target as Element).closest?.("[data-menu-open], [data-lesson-menu]")) close();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			close();
			anchor.current?.focus();
		};
		document.addEventListener("pointerdown", down);
		document.addEventListener("keydown", key);
		return () => {
			document.removeEventListener("pointerdown", down);
			document.removeEventListener("keydown", key);
		};
	}, [anchor]);

	return createPortal(
		<div
			ref={box}
			role="menu"
			data-lesson-menu=""
			style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
			className="glass fixed z-50 flex w-max max-w-[240px] min-w-[150px] animate-pop-in flex-col gap-0.5 rounded-xl p-1.5 [--tint-light:color-mix(in_oklab,white_82%,transparent)] [--tint:color-mix(in_oklab,var(--bg)_82%,transparent)]"
		>
			{confirm ? (
				<>
					<p className="mx-2 mt-1 mb-1.5 max-w-[200px] text-[12.5px] leading-[1.45] text-ink-2">Delete this lesson for good? This can't be undone.</p>
					{branches ? (
						<>
							<button type="button" role="menuitem" className={cn(menuBtn, danger)} onClick={() => deleteLesson(file, true)}>
								Delete it and its {plural}
							</button>
							<button type="button" role="menuitem" className={cn(menuBtn, danger)} onClick={() => deleteLesson(file, false)}>
								Delete it, keep the branches
							</button>
						</>
					) : (
						<button type="button" role="menuitem" className={cn(menuBtn, danger)} onClick={() => deleteLesson(file, false)}>
							Delete
						</button>
					)}
					<button type="button" role="menuitem" className={menuBtn} onClick={() => setConfirm(false)}>
						Cancel
					</button>
				</>
			) : (
				<>
					{rename && (
						<button
							type="button"
							role="menuitem"
							className={menuBtn}
							onClick={() => {
								setLessonMenu(null);
								rename();
							}}
						>
							Rename
						</button>
					)}
					{archived ? (
						<button type="button" role="menuitem" className={menuBtn} onClick={() => restoreLesson(file, false)}>
							Restore
						</button>
					) : (
						<button type="button" role="menuitem" className={menuBtn} onClick={() => archiveLesson(file)}>
							{branches ? `Archive with its ${plural}` : "Archive"}
						</button>
					)}
					<button type="button" role="menuitem" className={cn(menuBtn, danger)} onClick={() => setConfirm(true)}>
						Delete…
					</button>
				</>
			)}
		</div>,
		document.body,
	);
}

// Drag the sidebar's right edge (or focus it and use the arrow keys) to resize;
// double-click resets. The width lives in --sidebar-w and survives reloads.
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 440;
function setSidebarWidth(w: number) {
	w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
	root.style.setProperty("--sidebar-w", `${w}px`);
	localStorage.setItem("learn-sidebar-w", String(w));
}

function ResizeGrip() {
	const downAt = useRef(-1e9);
	const sidebarRight = (el: HTMLElement) => el.parentElement!.getBoundingClientRect().right;
	return (
		<div
			className="absolute top-[18px] right-0 bottom-[18px] w-2.5 min-w-0 cursor-col-resize touch-none after:absolute after:inset-y-0 after:right-[3px] after:w-0.5 after:rounded-[2px] after:bg-primary after:opacity-0 after:transition-opacity after:duration-150 after:content-[''] hover:after:opacity-70 focus-visible:outline-none focus-visible:after:opacity-70 in-data-resizing:after:opacity-70 narrow:hidden"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize lessons list"
			title="Drag to resize, double-click to reset"
			tabIndex={0}
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				// preventDefault swallows dblclick, so spot the second press of a double-click here.
				if (e.timeStamp - downAt.current < 350) {
					downAt.current = -1e9;
					root.style.removeProperty("--sidebar-w");
					localStorage.removeItem("learn-sidebar-w");
					return;
				}
				downAt.current = e.timeStamp;
				const grip = e.currentTarget;
				grip.setPointerCapture(e.pointerId);
				const startX = e.clientX;
				const startW = sidebarRight(grip);
				root.dataset.resizing = "";
				const move = (ev: PointerEvent) => setSidebarWidth(startW + ev.clientX - startX);
				const end = () => {
					delete root.dataset.resizing;
					grip.removeEventListener("pointermove", move);
					grip.removeEventListener("pointerup", end);
					grip.removeEventListener("pointercancel", end);
				};
				grip.addEventListener("pointermove", move);
				grip.addEventListener("pointerup", end);
				grip.addEventListener("pointercancel", end);
			}}
			onKeyDown={(e) => {
				const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
				if (!step) return;
				e.preventDefault();
				setSidebarWidth(sidebarRight(e.currentTarget) + step);
			}}
		/>
	);
}
