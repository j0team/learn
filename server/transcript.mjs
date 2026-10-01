// pi messages and events → the blocks the page renders. Pure: no server state.

// Cards and stage markers render as their own blocks, never as tool rows.
const HIDDEN_TOOLS = new Set(["quiz", "ask_user_question", "lesson_progress"]);

// The tutor's lesson_progress calls (learn.ts) become stage markers: where the
// lesson is in probe → plan → teach, and which planned step it's on.
const PHASES = ["probe", "plan", "teach"];
function progressBlock(id, args = {}) {
	if (!PHASES.includes(args.phase)) return null;
	const steps = Array.isArray(args.steps) ? args.steps.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().slice(0, 80)) : undefined;
	const current = Number.isInteger(args.current) && args.current >= 0 ? args.current : undefined;
	// Each step may only build on earlier steps, so the map stays a DAG in teaching order.
	const depends = steps && Array.isArray(args.depends) && args.depends.length === steps.length
		? args.depends.map((d, i) => (Array.isArray(d) ? [...new Set(d.filter((j) => Number.isInteger(j) && j >= 0 && j < i))] : []))
		: undefined;
	const goal = steps && typeof args.goal === "string" && args.goal.trim() ? args.goal.trim().slice(0, 80) : undefined;
	return { id, kind: "progress", phase: args.phase, steps, depends, goal, current };
}

// The block a tool call shows as: a stage marker, nothing (cards), or a tool row.
export function toolBlock(id, name, args, status) {
	if (name === "lesson_progress") return progressBlock(id, args);
	if (HIDDEN_TOOLS.has(name)) return null;
	return { id, kind: "tool", name, label: toolLabel(name, args), input: toolInput(args), status };
}

export const isHiddenTool = (name) => HIDDEN_TOOLS.has(name);

export function textOf(content) {
	if (typeof content === "string") return content;
	return (content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

// A /skill:name message arrives with the whole skill pasted in front of what the
// learner typed; show that as a note plus their own words.
export const SKILL_MESSAGE = /^<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*/;
export function userBlocks(content, id) {
	const text = textOf(content);
	const skill = SKILL_MESSAGE.exec(text);
	const own = skill ? text.slice(skill[0].length).trim() : text;
	const out = [];
	if (skill) out.push({ id: `${id}-skill`, kind: "note", icon: "skill", text: `Using the ${skill[1]} skill` });
	if (own) out.push({ id, kind: "user", text: own });
	return out;
}

export const firstLine = (s = "", max = 90) => String(s).split("\n")[0].slice(0, max);

export function toolLabel(name, args = {}) {
	switch (name) {
		case "read":
			return `Read ${args.path}`;
		case "bash":
			return firstLine(args.command) || "Ran a command";
		case "grep":
			return `Searched for ${args.pattern}`;
		case "find":
			return `Looked for ${args.pattern}`;
		case "ls":
			return `Listed ${args.path || "the vault"}`;
		case "edit":
			return `Edited ${args.path}`;
		case "write":
			return `Wrote ${args.path}`;
		case "subagent":
			return `${args.agent}: ${firstLine(args.task)}`;
	}
	return name;
}

// What a tool was asked to do and what it said back, shown when the learner opens
// the tool row. Capped: file reads and searches can be huge.
export function clip(text, max = 6000) {
	if (!text) return "";
	return text.length > max ? `${text.slice(0, max)}\n… ${(text.length - max).toLocaleString()} more characters` : text;
}

function toolInput(args) {
	const a = args || {};
	if (typeof a.command === "string") return clip(a.command, 2000);
	if (typeof a.task === "string") return clip(a.task, 2000);
	const keys = Object.keys(a);
	if (keys.length === 1 && typeof a[keys[0]] === "string") return clip(a[keys[0]], 2000);
	return keys.length ? clip(JSON.stringify(a, null, 2), 2000) : "";
}

// Thinking is never shown (it routinely holds the answer key of the quiz being
// written); the page only learns that it happened.
export function assistantParts(content) {
	const parts = [];
	for (const c of content || []) {
		if (c.type === "text" && c.text.trim()) parts.push({ type: "text", text: c.text });
		else if (c.type === "thinking" && c.thinking.trim()) parts.push({ type: "thinking", text: "" });
	}
	return parts;
}

// A saved lesson's messages, replayed as blocks.
export function blocksFromMessages(messages) {
	const out = [];
	const tools = new Map();
	let n = 0;
	for (const m of messages) {
		if (m.role === "user") {
			out.push(...userBlocks(m.content, `h${n++}`));
		} else if (m.role === "assistant") {
			const parts = assistantParts(m.content);
			if (parts.length) out.push({ id: `h${n++}`, kind: "assistant", parts, done: true });
			for (const c of m.content || []) {
				if (c.type !== "toolCall") continue;
				const b = toolBlock(c.id, c.name, c.arguments, "done");
				if (!b) continue;
				if (b.kind === "tool") tools.set(c.id, b);
				out.push(b);
			}
		} else if (m.role === "toolResult") {
			if (m.details?.learnBlock) out.push(m.details.learnBlock);
			else if (tools.has(m.toolCallId)) {
				const b = tools.get(m.toolCallId);
				if (m.isError) b.status = "error";
				b.output = clip(textOf(m.content));
			}
		} else if (m.role === "compactionSummary") {
			out.push({ id: `h${n++}`, kind: "note", icon: "file", text: "Earlier parts of the lesson were summarized to save room" });
		}
		if (m.stopReason === "error" && m.errorMessage) out.push({ id: `h${n++}`, kind: "error", text: m.errorMessage });
	}
	return out;
}
