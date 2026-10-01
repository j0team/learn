// Ask card: the tutor asks the learner to choose (ask_user_question). Pick one
// or more options, or say it in your own words; Enter sends.

import { useReducer, useState } from "react";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/store";
import type { AskBlock } from "@/lib/types";
import { drafts, draftFor, Field, Option, QuestionRow, QuestionText, Reveal, Sheet, SheetFoot, SheetHead } from "./sheet";

type Draft = { picked: string[]; text: string };

export function AskCard({ block: b, className }: { block: AskBlock; className?: string }) {
	const locked = b.state !== "pending";
	const d = draftFor<Draft>(b.id, () => ({ picked: [], text: "" }));
	const [, rerender] = useReducer((n: number) => n + 1, 0);
	const [sending, setSending] = useState(false);
	const canSend = !sending && (d.picked.length > 0 || d.text.trim().length > 0);

	async function send() {
		setSending(true);
		const ok = await post("/api/ask", { id: b.id, picked: d.picked, text: d.text });
		if (ok) drafts.delete(b.id);
		else setSending(false);
	}

	return (
		<Sheet id={b.id} cancelled={b.state === "cancelled"} className={className}>
			<SheetHead kicker="Your call" />
			<QuestionRow first>
				<QuestionText question={b.question} details={b.details} />
				<div className="mt-3 grid gap-1.5">
					{b.options.map((o, i) => {
						const checked = locked ? !!b.answer?.picked.includes(o.label) : d.picked.includes(o.label);
						return (
							<Option
								key={o.label}
								type={b.multi ? "checkbox" : "radio"}
								name={b.id}
								value="on"
								index={i}
								label={o.label}
								description={o.description}
								tone={checked ? "checked" : locked && b.answer ? "dim" : null}
								locked={locked}
								checked={checked}
								onChange={(on) => {
									d.picked = b.multi ? b.options.filter((x) => (x.label === o.label ? on : d.picked.includes(x.label))).map((x) => x.label) : [o.label];
									rerender();
								}}
							/>
						);
					})}
				</div>
				{!locked ? (
					<Field
						kind="note"
						placeholder="Or say it in your own words"
						value={d.text}
						onChange={(v) => {
							d.text = v;
							rerender();
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								if (canSend) send();
							}
						}}
					/>
				) : (
					b.answer?.text && <Reveal title="You wrote" text={b.answer.text} yours />
				)}
			</QuestionRow>
			{b.state === "pending" ? (
				<SheetFoot status="">
					<Button variant="primary" disabled={!canSend} onClick={send}>
						Send
					</Button>
				</SheetFoot>
			) : (
				<SheetFoot status={b.state === "cancelled" ? "Skipped." : "Answered."} />
			)}
		</Sheet>
	);
}
