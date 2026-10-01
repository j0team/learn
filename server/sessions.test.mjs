import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { branchesOf, lessonStats, listSessions, moveLesson, renameOnDisk, sessionParent } from "./sessions.mjs";

const line = (o) => `${JSON.stringify(o)}\n`;
const header = (parentSession) => line({ type: "session", id: "s", timestamp: "2026-01-01T00:00:00Z", ...(parentSession && { parentSession }) });
const user = (id, text, timestamp = "2026-01-01T10:00:00Z") => line({ type: "message", id, parentId: null, timestamp, message: { role: "user", content: [{ type: "text", text }] } });
const quiz = (id, results) => line({ type: "message", id, parentId: null, timestamp: "2026-01-01T10:00:00Z", message: { role: "toolResult", content: [], details: { learnBlock: { kind: "quiz", results } } } });

function fixture(t) {
	const dir = mkdtempSync(path.join(os.tmpdir(), "learn-sessions-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const write = (name, text, mtime) => {
		const file = path.join(dir, name);
		writeFileSync(file, text);
		if (mtime) utimesSync(file, mtime, mtime);
		return file;
	};
	return { dir, write };
}

test("listSessions titles lessons and lists the newest first", (t) => {
	const { dir, write } = fixture(t);
	const a = write("a.jsonl", header() + user("1", "Eigenvalues\nmore") + user("2", "Next step") + line({ type: "session_info", id: "i", name: "Linear algebra" }), 1_000);
	const b = write("b.jsonl", header() + user("1", '<skill name="teach">body</skill>'), 2_000);
	write("empty.jsonl", header(), 3_000);
	write("notes.txt", "ignored");
	assert.deepEqual(listSessions(dir), [
		{ file: b, title: "/skill:teach", last: "/skill:teach", parent: null, updated: 2_000_000 },
		{ file: a, title: "Linear algebra", last: "Next step", parent: null, updated: 1_000_000 },
	]);
});

test("listSessions resolves parents inside the listed folder", (t) => {
	const { dir, write } = fixture(t);
	write("child.jsonl", header("/somewhere/else/parent.jsonl") + user("1", "Hi"));
	assert.equal(listSessions(dir)[0].parent, path.join(dir, "parent.jsonl"));
});

test("listSessions adds live lessons pi hasn't written yet, once", (t) => {
	const { dir, write } = fixture(t);
	const onDisk = write("a.jsonl", header() + user("1", "Hi"), 1_000);
	const live = { file: path.join(dir, "new.jsonl"), title: "New", last: "Hello", parent: null, updated: 5_000_000 };
	const rows = listSessions(dir, [live, { ...live, file: onDisk, title: "stale" }]);
	assert.deepEqual(rows.map((r) => r.title), ["New", "Hi"]);
});

test("listSessions sees changes to a file it already read", (t) => {
	const { dir, write } = fixture(t);
	const file = write("a.jsonl", header() + user("1", "First"));
	assert.equal(listSessions(dir)[0].last, "First");
	appendFileSync(file, user("2", "Second"));
	assert.equal(listSessions(dir)[0].last, "Second");
});

test("listSessions on a missing folder is empty", () => {
	assert.deepEqual(listSessions(path.join(os.tmpdir(), "learn-sessions-missing")), []);
});

test("renameOnDisk appends a session_info entry and keeps the file's time", (t) => {
	const { dir, write } = fixture(t);
	const file = write("a.jsonl", header() + user("leaf", "Hi"), 1_000);
	renameOnDisk(file, "Renamed");
	const entries = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
	const info = entries.at(-1);
	assert.equal(info.type, "session_info");
	assert.equal(info.parentId, "leaf");
	assert.equal(info.name, "Renamed");
	assert.match(info.id, /^[0-9a-f]{8}$/);
	assert.equal(statSync(file).mtimeMs, 1_000_000);
	assert.equal(listSessions(dir)[0].title, "Renamed");
});

test("renameOnDisk handles a file without a trailing newline", (t) => {
	const { write } = fixture(t);
	const file = write("a.jsonl", (header() + user("leaf", "Hi")).trimEnd());
	renameOnDisk(file, "X");
	const lines = readFileSync(file, "utf8").trim().split("\n");
	assert.equal(lines.length, 3);
	assert.equal(JSON.parse(lines[2]).parentId, "leaf");
});

test("branchesOf collects the whole family below a lesson", () => {
	const all = [
		{ file: "a", parent: null },
		{ file: "b", parent: "a" },
		{ file: "c", parent: "b" },
		{ file: "d", parent: "a" },
		{ file: "e", parent: "x" },
	];
	assert.deepEqual(branchesOf("a", all).sort(), ["b", "c", "d"]);
	assert.deepEqual(branchesOf("e", all), []);
});

test("sessionParent reads the header line", (t) => {
	const { write } = fixture(t);
	assert.equal(sessionParent(write("a.jsonl", header("/p.jsonl") + user("1", "Hi"))), "/p.jsonl");
	assert.equal(sessionParent(write("b.jsonl", header())), null);
	assert.equal(sessionParent(write("c.jsonl", "not json")), null);
	assert.equal(sessionParent(null), null);
	assert.equal(sessionParent("/no/such/file.jsonl"), null);
});

test("moveLesson moves into a folder it creates, and ignores missing files", (t) => {
	const { dir, write } = fixture(t);
	const file = write("a.jsonl", header());
	const to = path.join(dir, "archive");
	moveLesson(file, to);
	assert.ok(!existsSync(file));
	assert.ok(existsSync(path.join(to, "a.jsonl")));
	moveLesson(path.join(dir, "gone.jsonl"), to);
});

test("lessonStats counts lessons, answers and study days across folders", (t) => {
	const { dir, write } = fixture(t);
	const today = new Date();
	const daysAgo = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n, 12).toISOString();
	write("a.jsonl", header() + user("1", "Hi", daysAgo(1)) + user("2", "Again", daysAgo(1)) + quiz("3", [{ correct: true }, { correct: false }, { correct: null }]));
	const other = mkdtempSync(path.join(os.tmpdir(), "learn-sessions-"));
	t.after(() => rmSync(other, { recursive: true, force: true }));
	writeFileSync(path.join(other, "b.jsonl"), header() + user("1", "Hey", daysAgo(2)) + user("2", "Old", daysAgo(5)));
	writeFileSync(path.join(other, "c.jsonl"), header());
	const stats = lessonStats([dir, other, path.join(dir, "missing")]);
	assert.equal(stats.lessons, 2);
	assert.equal(stats.answered, 3);
	assert.equal(stats.graded, 2);
	assert.equal(stats.correct, 1);
	// Nothing today yet, so the streak counts back from yesterday.
	assert.equal(stats.streak, 2);
	assert.equal(stats.days.length, 14);
	assert.deepEqual(stats.days.slice(-3).map((d) => d.count), [1, 2, 0]);
});
