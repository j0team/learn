import { Button } from "@/components/ui/button";
import { FIXED_KEYS, keyLabel, resetKeymap, SHORTCUTS, toggleCapture, useKeymap } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { h3Cls, noteCls, rowCls, sectionCls, titleRowCls } from "./styles";

const unsetCls = "text-[12.5px] text-ink-3";

// One <kbd> per key; "Escape Escape" is a sequence, "Shift+Enter" a chord.
function Keycaps({ combo, className }: { combo: string; className?: string }) {
	return (
		<span className={cn("inline-flex items-center gap-1", className)}>
			{combo ? (
				combo.split(" ").map((chord, i) => [
					i > 0 && (
						<span key={`then${i}`} className="text-[11.5px] text-ink-3">
							then
						</span>
					),
					...chord.split("+").map((part, j) => (
						<kbd key={`${i}.${j}`} className="min-w-[22px] rounded-[5px] border border-line-strong bg-surface px-1.5 py-px text-center font-mono text-[12px] leading-[normal] font-medium text-ink-2">
							{keyLabel(part)}
						</kbd>
					)),
				])
			) : (
				<span className={unsetCls}>Not set</span>
			)}
		</span>
	);
}

export function Keys() {
	const { keymap, capturing, note } = useKeymap();
	return (
		<section className={sectionCls}>
			<div className={titleRowCls}>
				<h3 className={h3Cls}>Keyboard shortcuts</h3>
				<Button variant="chip" onClick={resetKeymap}>
					Reset to defaults
				</Button>
			</div>
			<p className={cn(noteCls, note && "text-warn")}>{note || "Click a shortcut, then press the new keys. Backspace clears it, Esc cancels."}</p>
			<div>
				{SHORTCUTS.map((s) => {
					const listening = capturing === s.id;
					return (
						<div key={s.id} className={rowCls}>
							<span className="text-[14px] text-ink-2">{s.label}</span>
							<button
								type="button"
								aria-label={`Change shortcut for ${s.label}`}
								onClick={(e) => {
									toggleCapture(s.id);
									e.currentTarget.focus();
								}}
								className={cn(
									"inline-flex min-h-[30px] min-w-[110px] cursor-pointer justify-end rounded-[9px] border border-transparent bg-transparent px-2 py-[3px] transition-[background,border-color] duration-150 ease-[ease]",
									listening ? "border-primary-line bg-primary-soft" : "hover:bg-ink/7",
								)}
							>
								{listening ? <span className={cn(unsetCls, "text-primary")}>Press keys…</span> : <Keycaps combo={keymap[s.id]} />}
							</button>
						</div>
					);
				})}
			</div>
			<h4 className="mt-[18px] mb-1.5 font-ui text-[12px] leading-[normal] font-semibold text-ink-3">Built in</h4>
			<div>
				{FIXED_KEYS.map(([label, keys]) => (
					<div key={label} className={rowCls}>
						<span className="text-[14px] text-ink-2">{label}</span>
						<Keycaps combo={keys} className="pr-[9px]" />
					</div>
				))}
			</div>
		</section>
	);
}
