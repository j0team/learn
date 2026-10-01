// What the server sends: transcript blocks and the ops that change them.
// Mirrors server/server.mjs; the browser never sees answer keys.

export type Part = { type: "text" | "thinking"; text: string };

export type UserBlock = { id: string; kind: "user"; text: string; entryId?: string };
export type AssistantBlock = {
	id: string;
	kind: "assistant";
	parts: Part[];
	done: boolean;
	outTokens?: number;
	/** A tool call being written out (e.g. "worksheet"), for the status line. */
	drafting?: string;
};
export type ToolBlock = {
	id: string;
	kind: "tool";
	name: string;
	label: string;
	input?: string;
	output?: string;
	status: "running" | "done" | "error";
};
export type NoteBlock = { id: string; kind: "note"; icon: "file" | "skill"; text: string };
export type OutputBlock = { id: string; kind: "output"; text: string };
export type ErrorBlock = { id: string; kind: "error"; text: string };
export type Phase = "probe" | "plan" | "teach";
export type ProgressBlock = { id: string; kind: "progress"; phase: Phase; steps?: string[]; depends?: number[][]; goal?: string; current?: number };

export type ChoiceOption = { value: string; label: string };
export type QuizQuestion =
	| { kind: "choice"; question: string; details: string; multi: boolean; options: ChoiceOption[] }
	| { kind: "free"; question: string; details: string };
export type QuizResult = {
	idk: boolean;
	note: string;
	explanation: string;
	correct: boolean | null;
	/** free response */
	text?: string;
	referenceAnswer?: string;
	/** multiple choice */
	picked?: string[];
	correctValues?: string[];
};
export type CardState = "pending" | "answered" | "cancelled";
export type QuizBlock = { id: string; kind: "quiz"; title: string; questions: QuizQuestion[]; state: CardState; results?: QuizResult[] };
export type AskBlock = {
	id: string;
	kind: "ask";
	question: string;
	details: string;
	multi: boolean;
	options: { label: string; description: string }[];
	state: CardState;
	answer?: { picked: string[]; text: string };
};

export type Block = UserBlock | AssistantBlock | ToolBlock | NoteBlock | OutputBlock | ErrorBlock | ProgressBlock | QuizBlock | AskBlock;

export type SideBlock =
	| { id: string; kind: "user"; text: string }
	| { id: string; kind: "assistant"; text: string; thinking: boolean; done: boolean }
	| { id: string; kind: "tool"; label: string; status: "running" | "done" | "error" }
	| { id: string; kind: "error"; text: string };

export type Model = { provider: string; id: string; name: string };
export type Tuning = { model: Model | null; thinking: string; levels: string[] };
export type Usage = { tokens?: number | null; contextWindow?: number; percent?: number | null; cost: number } | null;
export type Command = { name: string; description: string; hint: string; source: "builtin" | "skill" | "prompt" | "extension" | "app" };
export type Session = { file: string | null; title: string; parent?: string | null };

export type Lesson = { file: string; title: string; last?: string; parent?: string | null; updated: number };
export type Lessons = { sessions: Lesson[]; archived: Lesson[] };

export type Op =
	| {
			op: "snapshot";
			blocks: Block[];
			busy: boolean;
			busySince?: number;
			session: Session;
			tuning?: Tuning;
			usage: Usage;
			commands?: Command[];
			running?: string[];
			side?: { thread: SideBlock[]; busy: boolean };
			vault?: string;
	  }
	| { op: "add"; block: Block }
	| { op: "patch"; block: Block }
	| { op: "part"; id: string; index: number; part: Part }
	| { op: "delta"; id: string; index: number; text: string }
	| { op: "tuning"; tuning: Tuning }
	| { op: "usage"; usage: Usage }
	| { op: "commands"; commands: Command[] }
	| { op: "tokens"; id: string; n: number }
	| { op: "drafting"; id: string; what: string }
	| { op: "sideBlock"; block: SideBlock }
	| { op: "sideDelta"; id: string; text: string }
	| { op: "sideBusy"; busy: boolean }
	| { op: "sideReset" }
	| { op: "busy"; busy: boolean; since?: number }
	| { op: "session"; session: Session }
	| { op: "running"; files: string[] };
