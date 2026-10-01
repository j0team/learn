// Settings: appearance, providers and keyboard shortcuts, in a native modal
// <dialog> (top layer, ::backdrop, Esc to cancel, and the composer's Esc handler
// skips events from inside a dialog, as before).

import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { stopCapture } from "@/lib/shortcuts";
import { focusComposer, setSettings, toggleTheme, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Keys } from "./Keys";
import { FONTS, setPref, usePrefs, type PrefKey } from "./prefs";
import { Providers } from "./Providers";
import { fieldCls, h3Cls, rowCls, sectionCls, selectCls } from "./styles";

function Seg({ label, items, value, onPick }: { label: string; items: [value: string, label: string][]; value: string; onPick: (v: string) => void }) {
	return (
		<div className="inline-flex gap-0.5 rounded-[11px] bg-ink/7 p-[3px]" role="radiogroup" aria-label={label}>
			{items.map(([v, text]) => (
				<button
					key={v}
					type="button"
					role="radio"
					aria-checked={v === value}
					onClick={() => onPick(v)}
					className="h-7 cursor-pointer rounded-lg border-0 bg-transparent px-3 font-ui text-[13px] leading-[normal] font-medium text-ink-2 aria-checked:bg-raised aria-checked:text-ink aria-checked:shadow-[inset_0_0_0_1px_var(--line-strong),0_1px_2px_color-mix(in_srgb,var(--shade)_25%,transparent)]"
				>
					{text}
				</button>
			))}
		</div>
	);
}

function FontSelect({ pref, label }: { pref: PrefKey; label: string }) {
	const value = usePrefs((s) => s[pref]);
	return (
		<label className={rowCls}>
			<span>{label}</span>
			<select className={cn(fieldCls, selectCls, "min-w-[170px]")} value={value} onChange={(e) => setPref(pref, e.target.value)}>
				{FONTS.map(([id, name]) => (
					<option key={id} value={id}>
						{name}
					</option>
				))}
			</select>
		</label>
	);
}

function Appearance() {
	const theme = useStore((s) => s.theme);
	const width = usePrefs((s) => s.width);
	return (
		<section className={sectionCls}>
			<h3 className={h3Cls}>Appearance</h3>
			<div className={rowCls}>
				<span>Theme</span>
				<Seg
					label="Theme"
					items={[
						["dark", "Dark"],
						["light", "Light"],
					]}
					value={theme}
					onPick={(v) => v !== theme && toggleTheme()}
				/>
			</div>
			<FontSelect pref="uiFont" label="Interface font" />
			<FontSelect pref="readFont" label="Lesson font" />
			<div className={rowCls}>
				<span>Lesson width</span>
				<Seg
					label="Lesson width"
					items={[
						["narrow", "Narrow"],
						["", "Normal"],
						["wide", "Wide"],
					]}
					value={width}
					onPick={(v) => setPref("width", v)}
				/>
			</div>
		</section>
	);
}

export function Settings() {
	const open = useStore((s) => s.settingsOpen);
	const ref = useRef<HTMLDialogElement>(null);

	// A layout effect, so the dialog is showing before the sections' effects run
	// (Providers focuses the key field when opened from "Set up a provider").
	useLayoutEffect(() => {
		const d = ref.current;
		if (!d) return;
		if (open && !d.open) {
			stopCapture();
			d.showModal();
		} else if (!open && d.open) d.close();
	}, [open]);

	// Clicking the dimmed area outside the panel closes it (the backdrop reports the
	// dialog itself as the target; the rect check skips its own padding).
	const onClick = (e: MouseEvent<HTMLDialogElement>) => {
		const d = e.currentTarget;
		if (e.target !== d || e.detail === 0) return;
		const r = d.getBoundingClientRect();
		if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
	};

	return (
		<dialog
			ref={ref}
			id="settings"
			aria-labelledby="settings-title"
			onClick={onClick}
			onClose={() => {
				stopCapture();
				setSettings(false);
				focusComposer();
			}}
			className={cn(
				// The header stays put and only the body scrolls. The box clips, so the
				// glass rim sits inside it, as on the side chat.
				"glass m-auto max-h-[min(720px,calc(100vh_-_48px))] w-[min(560px,calc(100vw_-_32px))] overflow-hidden rounded-[24px] p-0 text-ink before:inset-0",
				"[--tint-light:color-mix(in_oklab,white_82%,transparent)] [--tint:color-mix(in_oklab,var(--bg)_82%,transparent)]",
				"open:flex open:animate-[pop-in_280ms_var(--spring)_both] open:flex-col",
				"backdrop:bg-[color-mix(in_srgb,var(--shade)_45%,transparent)] backdrop:backdrop-blur-[3px] light:backdrop:bg-[color-mix(in_srgb,var(--shade)_18%,transparent)]",
			)}
		>
			<header className="flex items-center justify-between pt-4.5 pr-3.5 pb-1.5 pl-6">
				<h2 id="settings-title" className="m-0 font-ui text-[18px]/[1.3] font-semibold">
					Settings
				</h2>
				<Button variant="icon" aria-label="Close settings" title="Close settings" onClick={() => ref.current?.close()}>
					<svg viewBox="0 0 20 20" aria-hidden="true">
						<path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
					</svg>
				</Button>
			</header>
			<div className="min-h-0 overflow-y-auto overscroll-contain">
				<Appearance />
				<Providers />
				<Keys />
			</div>
		</dialog>
	);
}
