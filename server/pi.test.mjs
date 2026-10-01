import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { readJsonLines } from "./pi.mjs";

test("readJsonLines joins records split across chunks and skips bad lines", async () => {
	const stream = new PassThrough();
	const records = [];
	readJsonLines(stream, (r) => records.push(r));
	stream.write('{"a":1}\n{"b":');
	stream.write('2}\nnot json\n{"c":"line sep"}\n{"partial":');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(records, [{ a: 1 }, { b: 2 }, { c: "line sep" }]);
});

test("readJsonLines decodes multi-byte characters split between chunks", async () => {
	const stream = new PassThrough();
	const records = [];
	readJsonLines(stream, (r) => records.push(r));
	const bytes = Buffer.from('{"t":"é"}\n');
	stream.write(bytes.subarray(0, 7));
	stream.write(bytes.subarray(7));
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(records, [{ t: "é" }]);
});

test("readJsonLines keeps a long record whole across many newline-free chunks", async () => {
	const stream = new PassThrough();
	const records = [];
	readJsonLines(stream, (r) => records.push(r));
	const text = "x".repeat(10_000);
	const line = JSON.stringify({ text }) + "\n";
	for (let i = 0; i < line.length; i += 1000) stream.write(line.slice(i, i + 1000));
	stream.write('{"after":" "}\n');
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(records, [{ text }, { after: " " }]);
});
