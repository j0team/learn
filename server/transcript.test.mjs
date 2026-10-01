import test from "node:test";
import assert from "node:assert/strict";
import { assistantParts, blocksFromMessages, clip, firstLine, isHiddenTool, toolBlock, toolLabel, userBlocks } from "./transcript.mjs";

test("toolBlock turns tool calls into tool rows with a label and input", () => {
	assert.deepEqual(toolBlock("c1", "read", { path: "notes/a.md" }, "running"), {
		id: "c1",
		kind: "tool",
		name: "read",
		label: "Read notes/a.md",
		input: "notes/a.md",
		status: "running",
	});
	assert.equal(toolBlock("c2", "bash", { command: "ls\npwd" }, "done").label, "ls");
	assert.equal(toolBlock("c3", "mystery", {}, "done").input, "");
	assert.match(toolBlock("c4", "mystery", { a: 1, b: "x" }, "done").input, /"a": 1/);
});

test("cards render as their own blocks, never as tool rows", () => {
	for (const name of ["quiz", "ask_user_question"]) {
		assert.equal(toolBlock("c", name, {}, "running"), null);
		assert.ok(isHiddenTool(name));
	}
	assert.ok(isHiddenTool("lesson_progress"));
	assert.ok(!isHiddenTool("read"));
});

test("lesson_progress becomes a stage marker with cleaned-up steps", () => {
	const b = toolBlock("p1", "lesson_progress", {
		phase: "plan",
		steps: [" Vectors ", "", 3, "Eigenvalues"],
		depends: [[], [0, 0, 1, 5]],
		goal: " Diagonalize ",
		current: 1,
	}, "running");
	assert.deepEqual(b, { id: "p1", kind: "progress", phase: "plan", steps: ["Vectors", "Eigenvalues"], depends: [[], [0]], goal: "Diagonalize", current: 1 });
	assert.equal(toolBlock("p2", "lesson_progress", { phase: "nap" }, "done"), null);
	const bare = toolBlock("p3", "lesson_progress", { phase: "teach", current: -1, goal: "ignored without steps" }, "done");
	assert.equal(bare.current, undefined);
	assert.equal(bare.goal, undefined);
});

test("userBlocks splits a /skill message into a note and the learner's words", () => {
	const text = '<skill name="teach" location="x">long skill body</skill>\n\nLinear algebra';
	assert.deepEqual(userBlocks([{ type: "text", text }], "u1"), [
		{ id: "u1-skill", kind: "note", icon: "skill", text: "Using the teach skill" },
		{ id: "u1", kind: "user", text: "Linear algebra" },
	]);
	assert.deepEqual(userBlocks("plain", "u2"), [{ id: "u2", kind: "user", text: "plain" }]);
});

test("assistantParts keeps text and hides what the tutor was thinking", () => {
	assert.deepEqual(
		assistantParts([
			{ type: "thinking", thinking: "answer is B" },
			{ type: "text", text: "Hello" },
			{ type: "text", text: "  " },
			{ type: "toolCall", id: "x" },
		]),
		[{ type: "thinking", text: "" }, { type: "text", text: "Hello" }],
	);
});

test("blocksFromMessages replays a saved lesson", () => {
	const card = { id: "q1", kind: "quiz", state: "answered" };
	const blocks = blocksFromMessages([
		{ role: "user", content: "Hi" },
		{ role: "assistant", content: [{ type: "text", text: "Let's look." }, { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.md" } }, { type: "toolCall", id: "q1", name: "quiz", arguments: {} }] },
		{ role: "toolResult", toolCallId: "t1", isError: true, content: [{ type: "text", text: "x".repeat(7000) }] },
		{ role: "toolResult", toolCallId: "q1", content: [], details: { learnBlock: card } },
		{ role: "compactionSummary" },
		{ role: "assistant", content: [], stopReason: "error", errorMessage: "rate limited" },
	]);
	assert.deepEqual(blocks.map((b) => b.kind), ["user", "assistant", "tool", "quiz", "note", "error"]);
	assert.equal(blocks[2].status, "error");
	assert.match(blocks[2].output, /\n… 1,000 more characters$/);
	assert.equal(blocks[3], card);
	assert.equal(blocks[5].text, "rate limited");
	assert.equal(new Set(blocks.map((b) => b.id)).size, blocks.length);
});

test("firstLine, clip and toolLabel keep labels short", () => {
	assert.equal(firstLine("a\nb"), "a");
	assert.equal(firstLine(undefined), "");
	assert.equal(firstLine("x".repeat(200)).length, 90);
	assert.equal(firstLine("abcdef", 3), "abc");
	assert.equal(clip(""), "");
	assert.equal(clip("short", 10), "short");
	assert.equal(clip("abcdef", 3), "abc\n… 3 more characters");
	assert.equal(toolLabel("subagent", { agent: "researcher", task: "find\nmore" }), "researcher: find");
	assert.equal(toolLabel("ls", {}), "Listed the vault");
	assert.equal(toolLabel("other"), "other");
});
