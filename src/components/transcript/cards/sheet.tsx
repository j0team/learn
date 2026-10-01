// Shared pieces of the worksheet (quiz) and question card (ask): the sheet frame,
// option rows, answer fields, reveal boxes and the footer.

import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Markdown, renderInline } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/** In-progress answers per block id, kept for the session so they survive the
 *  card being re-rendered or patched. Dropped once the server takes them. */
export const drafts = new Map<string, unknown>();

export function draftFor<T>(id: string, init: () => T): T {
	if (!drafts.has(id)) drafts.set(id, init());
	return drafts.get(id) as T;
}

/** The card's root is the transcript block itself; the transcript passes the
 *  block spacing, entry animation and dimming in `className`. */
export function Sheet({ id, cancelled, className, children }: { id: string; cancelled: boolean; className?: string; children: ReactNode }) {
	return (
		<section
			data-block-id={id}
			className={cn(
				"overflow-hidden rounded-[18px] border border-line bg-raised shadow-[0_1px_2px_color-mix(in_srgb,var(--shade)_18%,transparent)]",
				cancelled && "opacity-60 shadow-none",
				className,
			)}
		>
			{children}
		</section>
	);
}

export function SheetHead({ kicker, title }: { kicker: string; title?: string }) {
	return (
		<div className="flex items-center gap-2.5 px-[22px] pt-[18px]">
			<span className="rounded-[999px] bg-primary-soft px-[9px] py-[3px] font-ui text-[12px] leading-[1.3] font-medium text-primary">{kicker}</span>
			{title && <Markdown inline className="font-ui text-[16px] leading-[1.3] font-semibold tracking-[-0.01em] text-ink" text={title} />}
		</div>
	);
}

export function SheetFoot({ status, score, children }: { status: string; score?: boolean; children?: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-3 border-t border-line bg-surface py-3 pr-4 pl-[22px]">
			<span className={cn("text-[13px] text-ink-3", score && "font-semibold text-ink-2")}>{status}</span>
			{children}
		</div>
	);
}

/** One question row: the number column (quiz only) and the body. */
export function QuestionRow({ first, num, children }: { first: boolean; num?: ReactNode; children: ReactNode }) {
	return (
		<div className={cn("grid gap-x-2.5 px-[22px] pt-[18px] pb-5", num ? "grid-cols-[34px_1fr]" : "grid-cols-[1fr]", !first && "border-t border-line")}>
			{num}
			<div className="min-w-0">{children}</div>
		</div>
	);
}

export function QuestionText({ question, details }: { question: string; details: string }) {
	return (
		<>
			<Md className="mb-1 text-[18px]! leading-[1.5]!" text={question} />
			{details && <Md className="mt-1.5 text-[16px]! text-ink-2!" text={details} />}
		</>
	);
}

/** Generated markdown in a `.prose` box. `.prose` is unlayered CSS, so size and
 *  colour overrides here carry `!`. */
export function Md({ text, className }: { text: string; className?: string }) {
	return <Markdown className={cn("prose", className)} text={text} />;
}

export type OptTone = "checked" | "correct" | "wrong" | "dim" | null;

// The option description, appended to the label's HTML (`!` beats `.prose > :first-child`).
const DESC = "mt-[3px]! block font-ui text-[13px] leading-[1.4] text-ink-3";

export function Option({
	type,
	name,
	value,
	index,
	label,
	description,
	mark,
	tone,
	locked,
	checked,
	onChange,
}: {
	type: "radio" | "checkbox";
	name: string;
	value: string;
	index: number;
	label: string;
	description?: string;
	mark?: string;
	tone: OptTone;
	locked: boolean;
	checked: boolean;
	onChange?: (checked: boolean) => void;
}) {
	return (
		<label
			className={cn(
				"relative grid cursor-pointer grid-cols-[26px_1fr_auto] items-start gap-3 rounded-[10px] border border-line bg-bg px-3 py-2.5 transition-[background,border-color] duration-150 ease-[ease]",
				"has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-primary",
				locked ? "cursor-default hover:border-line" : tone !== "checked" && "hover:border-line-strong",
				tone === "checked" && "border-primary-line bg-primary-soft",
				tone === "correct" && "border-good-line bg-good-soft",
				tone === "wrong" && "border-bad-line bg-bad-soft",
				tone === "dim" && "opacity-55",
			)}
		>
			<input
				className="pointer-events-none absolute opacity-0"
				type={type}
				name={name}
				value={value}
				disabled={locked}
				checked={checked}
				onChange={(e) => onChange?.(e.target.checked)}
			/>
			<span
				className={cn(
					"grid size-[26px] place-items-center rounded-[7px] border border-line-strong font-ui text-[12px] leading-none font-semibold text-ink-2 transition-[background,color,border-color] duration-150 ease-[ease]",
					type === "checkbox" && "rounded-[50%]",
					tone === "checked" && "border-primary bg-primary text-primary-ink",
					tone === "correct" && "border-good bg-good text-bg",
					tone === "wrong" && "border-bad bg-bad text-bg",
				)}
			>
				{String.fromCharCode(65 + index)}
			</span>
			{/* The label's markdown and the option's description share one span, as before. */}
			<span
				className="prose pt-0.5 font-read text-[16.5px]! leading-[1.45]!"
				dangerouslySetInnerHTML={{
					__html: renderInline(label) + (description ? `<span class="${DESC}">${renderInline(description)}</span>` : ""),
				}}
			/>
			<span className={cn("self-center text-[12px] font-semibold whitespace-nowrap", tone === "correct" && "text-good", tone === "wrong" && "text-bad")}>{mark}</span>
		</label>
	);
}

export function Field({
	kind,
	value,
	placeholder,
	disabled,
	onChange,
	onKeyDown,
	ref,
}: {
	kind: "free" | "note";
	value: string;
	placeholder: string;
	disabled?: boolean;
	onChange: (value: string) => void;
	onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
	ref?: Ref<HTMLTextAreaElement>;
}) {
	return (
		<textarea
			ref={ref}
			className={cn(
				"w-full resize-y rounded-[10px] border border-line bg-bg px-3 py-2.5 text-ink transition-[border-color] duration-150 ease-[ease] placeholder:text-ink-3 focus:border-primary-line focus:outline-none",
				// Note fields are a flex row with 24px below.
				kind === "free" ? "mt-3 min-h-[92px] font-read text-[16px] leading-[1.5]" : "mt-2 mb-6 flex min-h-[38px] font-ui text-[14px] leading-[1.45]",
			)}
			placeholder={placeholder}
			value={value}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value)}
			onKeyDown={onKeyDown}
		/>
	);
}

export function Reveal({ title, text, yours }: { title: string; text: string; yours?: boolean }) {
	return (
		<div className="reveal mt-3.5 rounded-[10px] bg-sunken px-4 py-3 [.reveal+&]:mt-2">
			<h4 className="m-0 mb-1 font-ui text-[12.5px] leading-[1.4] font-medium text-ink-3">{title}</h4>
			<Md className={cn("text-[16.5px]! leading-[1.55]!", yours && "text-ink-2!")} text={text} />
		</div>
	);
}
