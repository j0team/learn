// Quiz worksheet: numbered questions, multiple choice or free response. Pending,
// the learner answers (or says "I don't know", or adds a note) and submits;
// answered, each question shows its verdict, the right option and the why.

import { useEffect, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/store";
import type { QuizBlock, QuizQuestion, QuizResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { drafts, draftFor, Field, Option, QuestionRow, QuestionText, Reveal, Sheet, SheetFoot, SheetHead, type OptTone } from "./sheet";

type Draft = { picked: string[]; text: string; idk: boolean; note: string; noteOpen: boolean };

function answered(q: QuizQuestion, d: Draft) {
	if (d.idk) return true;
	return q.kind === "free" ? d.text.trim().length > 0 : d.picked.length > 0;
}

export function QuizCard({ block: b, className }: { block: QuizBlock; className?: string }) {
	const locked = b.state !== "pending";
	const draft = locked ? null : draftFor<Draft[]>(b.id, () => b.questions.map(() => ({ picked: [], text: "", idk: false, note: "", noteOpen: false })));
	const [, rerender] = useReducer((n: number) => n + 1, 0);
	const [sending, setSending] = useState(false);
	// The note field to focus once it has rendered ("Add a note").
	const focusNote = useRef<number | null>(null);
	const noteRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
	useEffect(() => {
		if (focusNote.current === null) return;
		noteRefs.current[focusNote.current]?.focus();
		focusNote.current = null;
	});

	const update = (n: number, fn: (d: Draft) => void) => {
		if (!draft) return;
		fn(draft[n]);
		rerender();
	};

	async function submit() {
		if (!draft) return;
		setSending(true);
		const answers = draft.map((d) => ({ picked: d.picked, text: d.text, idk: d.idk, note: d.noteOpen ? d.note : "" }));
		const ok = await post("/api/quiz", { id: b.id, answers });
		if (ok) drafts.delete(b.id);
		else setSending(false);
	}

	let footer;
	if (b.state === "answered") {
		const results = b.results ?? [];
		const graded = results.filter((r) => r.correct !== null);
		const right = graded.filter((r) => r.correct).length;
		const free = results.length - graded.length;
		const bits = [];
		if (graded.length) bits.push(`${right} of ${graded.length} correct`);
		if (free) bits.push(`${free} written answer${free > 1 ? "s" : ""} for the tutor to grade`);
		footer = <SheetFoot score status={bits.join(", ")} />;
	} else if (b.state === "cancelled") {
		footer = <SheetFoot status="This check-in was skipped." />;
	} else {
		const done = b.questions.filter((q, n) => draft && answered(q, draft[n])).length;
		footer = (
			<SheetFoot status={`${done} of ${b.questions.length} answered`}>
				<Button variant="primary" disabled={sending || done < b.questions.length} onClick={submit}>
					Submit answers
				</Button>
			</SheetFoot>
		);
	}

	return (
		<Sheet id={b.id} cancelled={b.state === "cancelled"} className={className}>
			<SheetHead kicker={b.state === "answered" ? "Checked" : "Check-in"} title={b.title} />
			{b.questions.map((q, n) => {
				const r = b.results?.[n];
				const d = draft?.[n];
				return (
					<QuestionRow
						key={n}
						first={n === 0}
						num={
							<div className={cn("pt-px font-ui text-[22px] leading-[1.2] font-medium text-ink-3 tabular-nums", r?.correct === true && "text-good", r?.correct === false && "text-bad")}>
								{n + 1}
							</div>
						}
					>
						<QuestionText question={q.question} details={q.details} />
						{r && <Verdict r={r} />}
						{q.kind === "choice" ? (
							<div className="mt-3 grid gap-1.5">
								{q.options.map((o, i) => {
									let tone: OptTone = null;
									let mark = "";
									if (d) {
										if (d.picked.includes(o.value)) tone = "checked";
									} else {
										const picked = r?.picked?.includes(o.value);
										if (r?.correctValues?.includes(o.value)) {
											tone = "correct";
											mark = picked ? "Your answer" : "Correct answer";
										} else if (picked) {
											tone = "wrong";
											mark = "Your answer";
										} else if (r) tone = "dim";
									}
									return (
										<Option
											key={o.value}
											type={q.multi ? "checkbox" : "radio"}
											name={`${b.id}-${n}`}
											value={o.value}
											index={i}
											label={o.label}
											mark={mark}
											tone={tone}
											locked={!d}
											checked={!!d?.picked.includes(o.value)}
											onChange={(on) =>
												update(n, (d) => {
													if (q.multi) d.picked = q.options.filter((x) => (x.value === o.value ? on : d.picked.includes(x.value))).map((x) => x.value);
													else d.picked = [o.value];
													d.idk = false;
												})
											}
										/>
									);
								})}
							</div>
						) : (
							d && (
								<Field
									kind="free"
									placeholder="Write your answer in your own words. LaTeX like $x^2$ is fine."
									value={d.text}
									disabled={d.idk}
									onChange={(v) => update(n, (d) => (d.text = v))}
								/>
							)
						)}
						{d && (
							<div>
								<div className="mt-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
									<LinkButton
										pressed={d.idk}
										onClick={() =>
											update(n, (d) => {
												d.idk = !d.idk;
												if (d.idk) d.picked = [];
											})
										}
									>
										I don't know
									</LinkButton>
									<LinkButton
										onClick={() => {
											if (!d.noteOpen) focusNote.current = n;
											update(n, (d) => {
												d.noteOpen = !d.noteOpen;
												if (!d.noteOpen) d.note = "";
											});
										}}
									>
										{d.noteOpen ? "Remove note" : "Add a note"}
									</LinkButton>
								</div>
								{d.noteOpen && (
									<Field
										kind="note"
										ref={(el) => {
											noteRefs.current[n] = el;
										}}
										placeholder="Anything the tutor should know, e.g. what you were unsure about"
										value={d.note}
										onChange={(v) => update(n, (d) => (d.note = v))}
									/>
								)}
							</div>
						)}
						{r && <RevealFor q={q} r={r} />}
					</QuestionRow>
				);
			})}
			{footer}
		</Sheet>
	);
}

function Verdict({ r }: { r: QuizResult }) {
	const [cls, text] = r.idk
		? ["text-ink-3", "You said you don't know"]
		: r.correct === true
			? ["text-good", "Correct"]
			: r.correct === false
				? ["text-bad", "Not quite"]
				: ["text-ink-3", "Graded in the reply below"];
	return <div className={cn("mt-0.5 inline-flex items-center gap-[5px] text-[12px] font-semibold tracking-[0.02em]", cls)}>{text}</div>;
}

function RevealFor({ q, r }: { q: QuizQuestion; r: QuizResult }) {
	return (
		<>
			{q.kind === "free" && (
				<>
					{r.text && <Reveal title="Your answer" text={r.text} yours />}
					<Reveal title="Reference answer" text={r.referenceAnswer ?? ""} />
				</>
			)}
			<Reveal title="Why" text={r.explanation} />
			{r.note && (
				<div className="mt-2 text-[13px] text-ink-3">
					<b className="font-semibold text-ink-2">Your note: </b>
					{r.note}
				</div>
			)}
		</>
	);
}

function LinkButton({ pressed, onClick, children }: { pressed?: boolean; onClick: () => void; children: string }) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			className={cn(
				"border-0 bg-transparent px-0 py-1 text-[13px] text-ink-3 underline decoration-line-strong underline-offset-3",
				pressed ? "font-semibold text-primary decoration-primary" : "hover:text-ink",
			)}
			onClick={onClick}
		>
			{children}
		</button>
	);
}
