import { useRef } from "react";
import { SaveMenu } from "@/components/SaveMenu";
import { Button } from "@/components/ui/button";
import { closeSave, saveLesson, setSidebar, toggleSide, toggleTheme, useStore } from "@/lib/store";
import { useShortcutHint } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

export function Topbar() {
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const title = useStore((s) => (s.blocks.length ? s.session.title || "Untitled lesson" : ""));
	const connected = useStore((s) => s.connected);
	const canSave = useStore((s) => !s.busy && s.blocks.some((b) => b.kind === "assistant"));
	const sideOpen = useStore((s) => s.sideOpen);
	const saveOpen = useStore((s) => s.saveOpen);
	const saveBtn = useRef<HTMLButtonElement>(null);
	const sideHint = useShortcutHint("side");
	const themeHint = useShortcutHint("theme");

	return (
		<header className="flex min-h-[52px] items-center gap-2 px-4 py-2.5">
			<Button variant="icon" className={cn(sidebarOpen && "hidden narrow:grid")} aria-label="Show lessons" title="Show lessons" onClick={() => setSidebar(true)}>
				<svg viewBox="0 0 20 20" aria-hidden="true">
					<path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
				</svg>
			</Button>
			<h1 className="m-0 min-w-0 flex-1 overflow-hidden font-ui text-sm leading-[1.3] font-medium text-ellipsis whitespace-nowrap text-ink-2">{title}</h1>
			<div className="flex flex-none items-center gap-1">
				{!connected && <span className="mr-2 text-[12px] text-bad">Reconnecting…</span>}
				<Button
					ref={saveBtn}
					variant="quiet"
					className={cn(saveOpen && "bg-sunken text-ink")}
					disabled={!canSave}
					aria-haspopup="dialog"
					aria-expanded={saveOpen}
					title="Ask the tutor to write this lesson up as a note in your vault"
					onClick={saveOpen ? closeSave : saveLesson}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M5.5 3.5h9v13l-4.5-3-4.5 3z" />
					</svg>
					<span className="narrow:hidden">Save to vault</span>
				</Button>
				{saveOpen && <SaveMenu anchor={saveBtn} />}
				<Button
					variant="quiet"
					className={cn(sideOpen && "bg-sunken text-ink")}
					aria-controls="side"
					aria-expanded={sideOpen}
					title={`Side chat: quick questions that stay out of the lesson${sideHint}`}
					onClick={toggleSide}
				>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3h0A1.5 1.5 0 0 1 4 11.5z" />
					</svg>
					<span className="narrow:hidden">Side chat</span>
				</Button>
				<Button variant="icon" aria-label="Switch between dark and light" title={`Switch between dark and light${themeHint}`} onClick={toggleTheme}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<circle cx="10" cy="10" r="6" />
						<path d="M10 4a6 6 0 0 1 0 12z" className="fill" />
					</svg>
				</Button>
			</div>
		</header>
	);
}
