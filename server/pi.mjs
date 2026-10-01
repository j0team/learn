import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// pi's own folder: credentials, models, installed packages.
export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");

const require = createRequire(import.meta.url);
const bun = require.resolve("bun/bin/bun.exe");
// Via the bundle's own export: Learn.app ships only pi's dist/bundle.
const cli = path.join(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"))), "cli.js");

// Every pi Learn starts loads only Learn's own provider extension, so it behaves
// the same on every machine; callers add what else they need.
export const PI_BASE_ARGS = ["--no-extensions", "-e", fileURLToPath(new URL("../extensions/claude-subscription.mjs", import.meta.url))];

export function spawnPi(args, options) {
	return process.env.LEARN_PI
		? spawn(process.env.LEARN_PI, args, options)
		: spawn(bun, [cli, ...args], options);
}

// pi's JSON output, one record per line. Split on LF only: JSON strings may hold
// U+2028/U+2029, which Node's readline would also treat as line breaks.
export function readJsonLines(stream, onRecord) {
	let parts = [];
	stream.setEncoding("utf8");
	stream.on("data", (chunk) => {
		// A long line arrives in many chunks; join them only once it ends.
		if (!chunk.includes("\n")) return void parts.push(chunk);
		const buf = parts.join("") + chunk;
		let start = 0;
		for (let end; (end = buf.indexOf("\n", start)) >= 0; start = end + 1) {
			let record;
			try {
				record = JSON.parse(buf.slice(start, end));
			} catch {
				continue;
			}
			onRecord(record);
		}
		parts = start < buf.length ? [buf.slice(start)] : [];
	});
}
