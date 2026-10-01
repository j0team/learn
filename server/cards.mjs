// Worksheets (quiz) and questions (ask_user_question): checking what the tutor
// sent, what the learner may see, and grading. Answer keys never leave the server.

function shuffled(list) {
	const a = [...list];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export function validateQuiz(args) {
	const qs = args?.questions;
	if (!Array.isArray(qs) || qs.length === 0) return "questions must be a non-empty array";
	for (const [n, q] of qs.entries()) {
		const at = `questions[${n}]`;
		if (!q.question?.trim()) return `${at}.question is empty`;
		if (!q.explanation?.trim()) return `${at}.explanation is required`;
		if (q.options) {
			const values = q.options.map((o) => o.value);
			if (new Set(values).size !== values.length) return `${at}: option values must be unique`;
			const keys = [q.correctAnswer ?? []].flat();
			if (keys.length === 0) return `${at}: multiple choice needs correctAnswer`;
			if (!q.multiSelect && keys.length !== 1) return `${at}: single-select needs exactly one correctAnswer (or set multiSelect)`;
			const bad = keys.find((k) => !values.includes(k));
			if (bad) return `${at}: correctAnswer "${bad}" is not one of the option values ${JSON.stringify(values)}`;
		} else if (!q.referenceAnswer?.trim()) {
			return `${at}: free-response questions need referenceAnswer`;
		}
	}
	return null;
}

// The questions as the learner sees them: no keys, options shuffled unless told not to.
export function shownQuestions(args) {
	return args.questions.map((q) => {
		const base = { question: q.question, details: q.details || "" };
		if (!q.options) return { ...base, kind: "free" };
		const opts = q.shuffle === false ? q.options : shuffled(q.options);
		return { ...base, kind: "choice", multi: !!q.multiSelect, options: opts.map(({ value, label }) => ({ value, label })) };
	});
}

// Report options back in the model's own vocabulary (its values), since the
// learner saw them shuffled under different letters.
function labelFor(q, value) {
	const o = q.options.find((opt) => opt.value === value);
	return `"${value}" (${o?.label ?? "?"})`;
}

// `p` is the pending card: the tutor's args (with keys) and the questions shown.
export function gradeQuiz(p, answers) {
	const lines = [];
	const results = p.args.questions.map((src, n) => {
		const shown = p.questions[n];
		const a = answers[n] || {};
		const note = a.note?.trim() || "";
		const r = { idk: !!a.idk, note, explanation: src.explanation };
		let line;
		if (shown.kind === "free") {
			r.text = a.idk ? "" : (a.text || "").trim();
			r.referenceAnswer = src.referenceAnswer;
			r.correct = null;
			line = a.idk
				? `Q${n + 1} (free response): learner said "I don't know".`
				: `Q${n + 1} (free response): learner wrote: """${r.text}"""\n   Your reference answer: """${src.referenceAnswer}"""\n   Grade this yourself in your reply.`;
		} else {
			const key = [src.correctAnswer].flat();
			const picked = a.idk ? [] : [a.picked || []].flat().filter((v) => shown.options.some((o) => o.value === v));
			r.picked = picked;
			r.correctValues = key;
			r.correct = !a.idk && picked.length === key.length && picked.every((v) => key.includes(v));
			const shownPick = picked.map((v) => labelFor(shown, v)).join("; ");
			const shownKey = key.map((v) => labelFor(shown, v)).join("; ");
			line = a.idk
				? `Q${n + 1}: learner said "I don't know" (correct: ${shownKey}).`
				: `Q${n + 1}: learner chose ${shownPick} → ${r.correct ? "CORRECT" : `WRONG (correct: ${shownKey})`}.`;
		}
		if (note) line += `\n   Learner's note: """${note}"""`;
		lines.push(line);
		return r;
	});
	const choice = results.filter((r) => r.correct !== null);
	const score = choice.length ? `${choice.filter((r) => r.correct).length}/${choice.length} multiple-choice correct.\n` : "";
	return { results, text: `The learner submitted the worksheet.\n${score}${lines.join("\n")}` };
}
