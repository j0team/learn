// Lessons on disk: pi's session files (JSONL), listed, renamed, moved and counted.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, utimesSync } from "node:fs";
import path from "node:path";
import { SKILL_MESSAGE, firstLine, textOf } from "./transcript.mjs";

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// What the lesson list and the home stats need from one file, parsed once per
// change (files hold bulky tool output, and both are asked for often).
const summaries = new Map(); // file -> { mtimeMs, size, summary }

function summarize(file) {
	const s = { title: "", first: "", last: "", parent: null, hasUser: false, days: {}, answered: 0, graded: 0, correct: 0 };
	for (const line of readFileSync(file, "utf8").split("\n")) {
		// Only a few kinds of line matter; skip parsing the rest.
		if (!(line.startsWith('{"type":"session') || line.includes('"role":"user"') || line.includes('"learnBlock"'))) continue;
		let e;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.type === "session_info") s.title = e.name || "";
		if (e.type === "session") s.parent = e.parentSession || null;
		if (e.type !== "message") continue;
		if (e.message?.role === "user") {
			s.hasUser = true;
			const text = textOf(e.message.content);
			// A lesson opened with /skill:name and nothing else is named after the skill.
			s.last = firstLine(text.replace(SKILL_MESSAGE, "").trim() || `/skill:${SKILL_MESSAGE.exec(text)?.[1]}`, 80);
			s.first ||= s.last;
			const when = new Date(e.timestamp || e.message.timestamp);
			if (!Number.isNaN(when.getTime())) s.days[dayKey(when)] = (s.days[dayKey(when)] || 0) + 1;
		}
		const b = e.message?.details?.learnBlock;
		if (b?.kind !== "quiz" || !Array.isArray(b.results)) continue;
		s.answered += b.results.length;
		for (const r of b.results) {
			if (typeof r.correct !== "boolean") continue; // free response: the tutor grades it in prose
			s.graded++;
			if (r.correct) s.correct++;
		}
	}
	return s;
}

// Every session file in `dir` with its summary and modification time.
function scan(dir) {
	if (!existsSync(dir)) return [];
	const out = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(".jsonl")) continue;
		const file = path.join(dir, name);
		const { mtimeMs, size } = statSync(file);
		let hit = summaries.get(file);
		if (hit?.mtimeMs !== mtimeMs || hit.size !== size) summaries.set(file, (hit = { mtimeMs, size, summary: summarize(file) }));
		out.push({ file, updated: mtimeMs, ...hit.summary });
	}
	return out;
}

// The lessons in `dir`, newest first. `live` adds lessons pi hasn't written yet
// (it writes a new session only once the first reply is done).
export function listSessions(dir, live = []) {
	const out = scan(dir)
		.filter((s) => s.hasUser)
		// Parents resolve by file name, so a lesson archived with its branches keeps its shape.
		.map((s) => ({ file: s.file, title: s.title || s.first || "Untitled lesson", last: s.last, parent: s.parent && path.join(dir, path.basename(s.parent)), updated: s.updated }));
	for (const s of live) if (!out.some((o) => o.file === s.file)) out.push(s);
	return out.sort((a, b) => b.updated - a.updated);
}

// A branch's parent is stored as a path, so archiving moves the whole family.
export function branchesOf(file, all) {
	const out = [];
	const walk = (f) => {
		for (const s of all) {
			if (s.parent !== f || out.includes(s.file)) continue;
			out.push(s.file);
			walk(s.file);
		}
	};
	walk(file);
	return out;
}

// The session a branch or fork came from, read from the file's header line.
export function sessionParent(file) {
	if (!file || !existsSync(file)) return null;
	const fd = openSync(file, "r");
	const buf = Buffer.alloc(16384);
	const n = readSync(fd, buf, 0, buf.length, 0);
	closeSync(fd);
	try {
		return JSON.parse(buf.toString("utf8", 0, n).split("\n")[0]).parentSession || null;
	} catch {
		return null;
	}
}

// Rename a lesson that isn't open: append the session_info entry pi itself
// would write, as a child of the file's last entry.
export function renameOnDisk(file, name) {
	const text = readFileSync(file, "utf8");
	const lines = text.split("\n").filter(Boolean);
	let leaf = null;
	for (let i = lines.length - 1; i >= 0 && !leaf; i--) {
		try {
			leaf = JSON.parse(lines[i]).id || null;
		} catch {}
	}
	let id;
	do id = Math.random().toString(16).slice(2, 10).padEnd(8, "0");
	while (text.includes(`"id":"${id}"`));
	// A new name isn't activity: keep the file's time so the lesson keeps its place in the list.
	const { atime, mtime } = statSync(file);
	const entry = { type: "session_info", id, parentId: leaf, timestamp: new Date().toISOString(), name };
	appendFileSync(file, `${text.endsWith("\n") ? "" : "\n"}${JSON.stringify(entry)}\n`);
	utimesSync(file, atime, mtime);
}

export function moveLesson(file, toDir) {
	mkdirSync(toDir, { recursive: true });
	if (existsSync(file)) renameSync(file, path.join(toDir, path.basename(file)));
}

// Lessons started, worksheet answers, and which days you studied (any message
// sent), across `dirs`.
export function lessonStats(dirs) {
	const perDay = new Map();
	let lessons = 0;
	let answered = 0;
	let graded = 0;
	let correct = 0;
	for (const s of dirs.flatMap(scan)) {
		if (s.hasUser) lessons++;
		answered += s.answered;
		graded += s.graded;
		correct += s.correct;
		for (const [day, n] of Object.entries(s.days)) perDay.set(day, (perDay.get(day) || 0) + n);
	}
	const day = new Date();
	const days = [];
	for (let i = 13; i >= 0; i--) {
		const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() - i);
		days.push({ day: dayKey(d), count: perDay.get(dayKey(d)) || 0 });
	}
	// A streak survives until the end of today, so start from yesterday if today is blank.
	let streak = 0;
	const cursor = new Date(day.getFullYear(), day.getMonth(), day.getDate() - (perDay.has(dayKey(day)) ? 0 : 1));
	while (perDay.has(dayKey(cursor))) {
		streak++;
		cursor.setDate(cursor.getDate() - 1);
	}
	return { lessons, answered, graded, correct, streak, days };
}
