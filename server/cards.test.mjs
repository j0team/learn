import test from "node:test";
import assert from "node:assert/strict";
import { gradeQuiz, shownQuestions, validateQuiz } from "./cards.mjs";

const choice = (extra = {}) => ({
	question: "2 + 2?",
	explanation: "Counting.",
	options: [
		{ value: "three", label: "3" },
		{ value: "four", label: "4" },
		{ value: "five", label: "5" },
	],
	correctAnswer: "four",
	...extra,
});
const free = { question: "Why?", explanation: "Because.", referenceAnswer: "It follows." };

test("validateQuiz accepts well-formed choice and free questions", () => {
	assert.equal(validateQuiz({ questions: [choice(), free] }), null);
	assert.equal(validateQuiz({ questions: [choice({ multiSelect: true, correctAnswer: ["three", "four"] })] }), null);
});

test("validateQuiz names the first problem", () => {
	const cases = [
		[undefined, /non-empty array/],
		[{ questions: [] }, /non-empty array/],
		[{ questions: [choice({ question: " " })] }, /questions\[0\]\.question is empty/],
		[{ questions: [choice({ explanation: "" })] }, /explanation is required/],
		[{ questions: [choice({ options: [{ value: "a" }, { value: "a" }] })] }, /must be unique/],
		[{ questions: [choice({ correctAnswer: undefined })] }, /needs correctAnswer/],
		[{ questions: [choice({ correctAnswer: ["three", "four"] })] }, /exactly one correctAnswer/],
		[{ questions: [choice({ correctAnswer: "six" })] }, /"six" is not one of/],
		[{ questions: [free, { ...free, referenceAnswer: "" }] }, /questions\[1\]: free-response questions need referenceAnswer/],
	];
	for (const [args, expected] of cases) assert.match(validateQuiz(args), expected);
});

test("shownQuestions hides answer keys and keeps order when shuffle is off", () => {
	const shown = shownQuestions({ questions: [choice({ shuffle: false, details: "Show work" }), free] });
	assert.deepEqual(shown[0], {
		question: "2 + 2?",
		details: "Show work",
		kind: "choice",
		multi: false,
		options: [
			{ value: "three", label: "3" },
			{ value: "four", label: "4" },
			{ value: "five", label: "5" },
		],
	});
	assert.deepEqual(shown[1], { question: "Why?", details: "", kind: "free" });
	assert.ok(!JSON.stringify(shown).includes("explanation"));
	assert.ok(!JSON.stringify(shown).includes("It follows"));
});

test("shownQuestions shuffles options by default without losing any", () => {
	const options = Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `L${i}` }));
	const q = { question: "?", explanation: "!", options, correctAnswer: "v0" };
	const orders = new Set(Array.from({ length: 20 }, () => shownQuestions({ questions: [q] })[0].options.map((o) => o.value).join()));
	assert.ok(orders.size > 1);
	for (const order of orders) assert.deepEqual(order.split(",").sort(), options.map((o) => o.value).sort());
});

function pending(questions) {
	const args = { questions };
	return { args, questions: shownQuestions({ questions: questions.map((q) => ({ ...q, shuffle: false })) }) };
}

test("gradeQuiz grades choices, passes free answers to the tutor and scores", () => {
	const p = pending([choice(), choice({ multiSelect: true, correctAnswer: ["three", "four"] }), free]);
	const { results, text } = gradeQuiz(p, [{ picked: "four", note: " easy " }, { picked: ["four"] }, { text: " my answer " }]);
	assert.equal(results[0].correct, true);
	assert.equal(results[0].note, "easy");
	assert.equal(results[1].correct, false);
	assert.deepEqual(results[1].correctValues, ["three", "four"]);
	assert.equal(results[2].correct, null);
	assert.equal(results[2].text, "my answer");
	assert.equal(results[2].referenceAnswer, "It follows.");
	assert.match(text, /^The learner submitted the worksheet\.\n1\/2 multiple-choice correct\./);
	assert.match(text, /Q1: learner chose "four" \(4\) → CORRECT/);
	assert.match(text, /Q2: learner chose "four" \(4\) → WRONG \(correct: "three" \(3\); "four" \(4\)\)/);
	assert.match(text, /Learner's note: """easy"""/);
	assert.match(text, /Q3 \(free response\): learner wrote: """my answer"""/);
});

test("gradeQuiz treats I don't know, missing and unknown picks as wrong", () => {
	const p = pending([choice(), choice(), free]);
	const { results, text } = gradeQuiz(p, [{ idk: true, picked: "four" }, { picked: ["nope"] }]);
	assert.equal(results[0].correct, false);
	assert.deepEqual(results[0].picked, []);
	assert.deepEqual(results[1].picked, []);
	assert.equal(results[1].correct, false);
	assert.equal(results[2].text, "");
	assert.match(text, /Q1: learner said "I don't know" \(correct: "four" \(4\)\)/);
	assert.match(text, /0\/2 multiple-choice correct/);
});

test("gradeQuiz omits the score line when every question is free response", () => {
	const { text } = gradeQuiz(pending([free]), [{ idk: true }]);
	assert.equal(text, 'The learner submitted the worksheet.\nQ1 (free response): learner said "I don\'t know".');
});
