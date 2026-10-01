// Loaded into the tutor by the Learn server (pi -e). Gives the tutor what the
// browser app needs:
//   quiz, ask_user_question  cards the learner answers in the page. The tool
//                            hands its arguments to the server through an RPC
//                            dialog and waits for the learner; the server keeps
//                            the answer keys and does the grading.
//   lesson_progress          where the lesson is (probe, plan, teach and the
//                            planned steps); the server draws it as the outline
//                            beside the chat.
//   subagent                 runs one of Learn's agents (agents/*.md)
//                            in its own pi process: the researcher and the
//                            diagram makers the teach and visualize skills use.
//   /learn-rewind <id>       moves the lesson back to just before a message, in
//                            the same session file (what /tree does).
import { AGENT_DIR, PI_BASE_ARGS, readJsonLines, spawnPi } from "./pi.mjs";
import { textOf } from "./transcript.mjs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENTS = path.resolve(HERE, "../agents");
const VISUAL_TOOLS = path.resolve(HERE, "../extensions/visual-tools");
const PI_PACKAGES = path.join(AGENT_DIR, "npm/node_modules");
const WEB_ACCESS = path.join(PI_PACKAGES, "pi-web-access");

const QUESTION = {
	type: "object",
	additionalProperties: false,
	properties: {
		question: { type: "string", description: "The question. Markdown and LaTeX ($…$, $$…$$) render." },
		details: { type: "string", description: "Optional context shown under the question (e.g. a formula or data table)." },
		options: {
			type: "array",
			minItems: 2,
			description: "Answer options for a multiple-choice question. OMIT for a free-response question.",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					value: { type: "string", description: "Stable id you reference in correctAnswer." },
					label: { type: "string", description: "Option text. Markdown and LaTeX render." },
				},
				required: ["value", "label"],
			},
		},
		correctAnswer: {
			description: "Multiple choice only: the correct option value, or an array of values when multiSelect is true.",
			anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
		},
		multiSelect: { type: "boolean", description: "Multiple choice only: learner must select exactly the set in correctAnswer." },
		shuffle: { type: "boolean", description: "Multiple choice only. Default true. Set false when option order is meaningful." },
		referenceAnswer: {
			type: "string",
			description: "Free response only: your model answer, committed before the learner answers. Hidden until they submit.",
		},
		explanation: { type: "string", description: "Revealed after the learner submits. Why the correct answer is correct." },
	},
	required: ["question", "explanation"],
};

const QUIZ = {
	type: "object",
	additionalProperties: false,
	properties: {
		title: { type: "string", description: "Optional short heading for the set, e.g. 'Where are you with variance?'" },
		questions: { type: "array", minItems: 1, maxItems: 8, items: QUESTION },
	},
	required: ["questions"],
};

const ASK = {
	type: "object",
	additionalProperties: false,
	properties: {
		question: { type: "string" },
		details: { type: "string" },
		options: {
			type: "array",
			minItems: 1,
			items: {
				type: "object",
				additionalProperties: false,
				properties: { label: { type: "string" }, description: { type: "string" } },
				required: ["label"],
			},
		},
		multiSelect: { type: "boolean" },
	},
	required: ["question", "options"],
};

const PROGRESS = {
	type: "object",
	additionalProperties: false,
	properties: {
		phase: { type: "string", enum: ["probe", "plan", "teach"], description: "The teach skill's phase the lesson is in now." },
		steps: {
			type: "array",
			minItems: 1,
			maxItems: 12,
			items: { type: "string" },
			description: "The plan's nodes in teaching order, as short labels (2 to 5 words). Give them when you present the plan, and again only if the plan changes.",
		},
		depends: {
			type: "array",
			maxItems: 12,
			items: { type: "array", items: { type: "integer", minimum: 0 } },
			description:
				"The dependency map, with `steps`: one entry per step listing the indices of the EARLIER steps it builds on. [] for a root (an unconditional truth the lesson starts from). E.g. steps A, B, C where C needs both A and B: [[], [], [0, 1]]. Learn draws this as the plan map.",
		},
		goal: { type: "string", description: "With `steps`: the learner's goal, the map's sink (2 to 6 words), e.g. 'Solve A2 question 1'." },
		current: { type: "integer", minimum: 0, description: "Teach phase: the index in steps of the node you are teaching now. steps.length means every step is done." },
	},
	required: ["phase"],
};

// The card goes to the Learn server as an RPC `input` dialog titled
// "learn:<tool>"; the reply is JSON: { text, block } or { error }.
async function askLearner(name: string, toolCallId: string, args: unknown, signal: AbortSignal | undefined, ctx: ExtensionContext) {
	if (ctx.mode !== "rpc") throw new Error(`${name} only works inside the Learn app. Ask in your reply instead.`);
	const reply = await ctx.ui.input(`learn:${name}`, JSON.stringify({ toolCallId, args }), { signal });
	if (reply === undefined) throw new Error("The card was closed before the learner answered.");
	const r = JSON.parse(reply);
	if (r.error) throw new Error(r.error);
	return { content: [{ type: "text" as const, text: r.text }], details: { learnBlock: r.block } };
}

// ─── Subagents ──────────────────────────────────────────────────────────────

type Agent = { name: string; description: string; tools: string[]; model?: string; thinking?: string; prompt: string };

function loadAgent(name: string): Agent | null {
	const file = path.join(AGENTS, `${name}.md`);
	if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) return null;
	const text = readFileSync(file, "utf8");
	const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
	const meta: Record<string, string> = {};
	for (const line of (m?.[1] ?? "").split("\n")) {
		const kv = /^([\w-]+):\s*(.*)$/.exec(line);
		if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
	}
	return {
		name,
		description: meta.description ?? "",
		tools: (meta.tools ?? "read").split(",").map((t) => t.trim()).filter(Boolean),
		model: meta.model,
		thinking: meta.thinking,
		prompt: (m?.[2] ?? text).trim(),
	};
}

function agentList() {
	if (!existsSync(AGENTS)) return "";
	const agents = readdirSync(AGENTS).filter((f) => f.endsWith(".md")).map((f) => loadAgent(f.slice(0, -3))).filter(Boolean) as Agent[];
	return agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
}

// Tools that live in extensions rather than in pi itself, and where to load them from.
const EXTENSION_TOOLS: Record<string, string> = {
	web_search: WEB_ACCESS,
	fetch_content: WEB_ACCESS,
	write_mermaid: VISUAL_TOOLS,
	edit_mermaid: VISUAL_TOOLS,
	render_mermaid: VISUAL_TOOLS,
	write_svg: VISUAL_TOOLS,
	edit_svg: VISUAL_TOOLS,
	render_svg: VISUAL_TOOLS,
};

// The agent's own model when it's usable here, otherwise the tutor's.
function agentModel(agent: Agent, ctx: ExtensionContext) {
	const [provider, ...rest] = (agent.model ?? "").split("/");
	const own = rest.length ? ctx.modelRegistry.find(provider, rest.join("/")) : undefined;
	const m = own && ctx.modelRegistry.hasConfiguredAuth(own) ? own : ctx.model;
	return m ? `${m.provider}/${m.id}` : undefined;
}

async function runAgent(agent: Agent, task: string, signal: AbortSignal | undefined, ctx: ExtensionContext) {
	// Researchers search the web; without the package they only have the files.
	const tools = agent.tools.flatMap((t) => (t === "web_search" ? ["web_search", "fetch_content"] : [t]));
	const extensions = [...new Set(tools.map((t) => EXTENSION_TOOLS[t]).filter(Boolean))];
	const missing = extensions.filter((p) => !existsSync(p));
	if (missing.includes(WEB_ACCESS)) throw new Error("The researcher needs web search: run `pi install npm:pi-web-access`, then restart Learn.");
	if (missing.length) throw new Error(`Missing extension: ${missing.join(", ")}`);
	const args = ["--mode", "json", "-p", "--no-session", ...PI_BASE_ARGS, "--no-skills", "--no-prompt-templates", "--no-context-files"];
	for (const e of extensions) args.push("-e", e);
	args.push("--tools", tools.join(","));
	const model = agentModel(agent, ctx);
	if (model) args.push("--model", model);
	if (agent.thinking) args.push("--thinking", agent.thinking);
	args.push("--append-system-prompt", agent.prompt, "--", `Task: ${task}`);

	return new Promise<{ text: string; usage: Record<string, number> }>((resolve, reject) => {
		const child = spawnPi(args, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
		const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
		let last = "";
		let error = "";
		let stderr = "";
		const onAbort = () => child.kill();
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
		readJsonLines(child.stdout, (f) => {
			if (f.type !== "message_end" || f.message?.role !== "assistant") return;
			const m = f.message;
			for (const k of ["input", "output", "cacheRead", "cacheWrite"] as const) usage[k] += m.usage?.[k] ?? 0;
			usage.cost += m.usage?.cost?.total ?? 0;
			const text = textOf(m.content).trim();
			if (text) last = text;
			if (m.stopReason === "error") error = m.errorMessage || "the model returned an error";
		});
		child.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			if (signal?.aborted) return reject(new Error("Cancelled."));
			if (error) return reject(new Error(`${agent.name} failed: ${error}`));
			if (!last) return reject(new Error(`${agent.name} returned nothing (exit ${code}). ${stderr.trim()}`));
			resolve({ text: last, usage });
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "quiz",
		label: "Quiz",
		description:
			"Ask the learner one or more GRADED questions, shown as an inline worksheet in the Learn app. Batch related questions (1 to 8) into ONE call; the learner answers all of them, then submits once. Each question is either multiple choice (give `options` + `correctAnswer`) or free response (omit `options`, give `referenceAnswer`). Answer keys, reference answers and explanations are hidden from the learner until they submit. Every question also offers an 'I don't know' choice and an optional note. The result tells you exactly what the learner chose or wrote; free-response answers are for YOU to grade in your next reply.",
		parameters: QUIZ as never,
		executionMode: "sequential",
		execute: (id, params, signal, _update, ctx) => askLearner("quiz", id, params, signal, ctx),
	});

	pi.registerTool({
		name: "ask_user_question",
		label: "Ask",
		description:
			"Ask the learner ONE question that has no right answer (goals, preferences, direction, pacing). Renders as an inline card with your options plus a free-text 'something else' field. For anything with a correct answer, use `quiz` instead.",
		parameters: ASK as never,
		executionMode: "sequential",
		execute: (id, params, signal, _update, ctx) => askLearner("ask_user_question", id, params, signal, ctx),
	});

	pi.registerTool({
		name: "lesson_progress",
		label: "Progress",
		description:
			"Update the lesson outline and plan map the learner sees: which phase the lesson is in and, while teaching, which planned step. Call it when the lesson enters a phase (probe at the start, plan with `steps`, `depends` and `goal` when you present the plan, teach once they okay it) and each time you move on to the next step. Learn draws the plan as an interactive dependency map in the chat and beside it, colored by what's done, current and next. It returns immediately.",
		parameters: PROGRESS as never,
		async execute() {
			return { content: [{ type: "text" as const, text: "Outline updated." }], details: {} };
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: `Hand one self-contained task to a specialist agent that runs in its own context and returns its final answer. It knows nothing about this lesson, so put everything it needs in \`task\`. Agents:\n${agentList()}`,
		parameters: {
			type: "object",
			additionalProperties: false,
			properties: {
				agent: { type: "string", description: "Agent name, e.g. researcher, mermaid-maker, svg-maker." },
				task: { type: "string", description: "The complete brief." },
			},
			required: ["agent", "task"],
		} as never,
		async execute(_id, params: { agent: string; task: string }, signal, _update, ctx) {
			const agent = loadAgent(params.agent);
			if (!agent) throw new Error(`No agent named "${params.agent}". Agents:\n${agentList()}`);
			const r = await runAgent(agent, params.task, signal, ctx);
			return { content: [{ type: "text" as const, text: r.text }], details: { agent: agent.name, usage: r.usage } };
		},
	});

	pi.registerCommand("learn-rewind", {
		description: "Learn app: move the lesson back to just before a message (in place)",
		handler: async (args, ctx) => {
			const entryId = args.trim();
			if (!entryId) throw new Error("learn-rewind needs an entry id");
			await ctx.waitForIdle();
			const r = await ctx.navigateTree(entryId, { summarize: false });
			if (r?.cancelled) throw new Error("Rewind was cancelled");
			// The prompt command can answer before the handler finishes; this tells the server it's done.
			ctx.ui.notify(`learn-rewind:${entryId}`, "info");
		},
	});
}
