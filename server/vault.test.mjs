import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVault, vaultFolder } from "./vault.mjs";

function fixture(t, files) {
	const root = mkdtempSync(path.join(os.tmpdir(), "learn-vault-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const add = (rel, when) => {
		const file = path.join(root, rel);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, rel);
		if (when) utimesSync(file, when, when);
	};
	for (const [rel, when] of Object.entries(files)) add(rel, when);
	return { root, add, vault: createVault(root) };
}

test("vaultFolder normalizes a typed folder and rejects unsafe ones", () => {
	assert.equal(vaultFolder(" stat / 341\\lessons/ "), "stat/341/lessons");
	for (const bad of ["", "/", null, undefined, ".obsidian", "a/../b", "a/.hidden"]) assert.equal(vaultFolder(bad), null);
});

test("search needs every term and ranks file-name hits over folder hits", (t) => {
	const { vault } = fixture(t, { "linear/notes.md": 0, "misc/linear-maps.md": 0, "linear/eigen/vectors.md": 0, "other.md": 0 });
	const hits = vault.search("linear");
	assert.equal(hits[0], "misc/linear-maps.md");
	assert.deepEqual(hits.slice(1).sort(), ["linear/eigen/vectors.md", "linear/notes.md"]);
	assert.deepEqual(vault.search("linear vectors"), ["linear/eigen/vectors.md"]);
	assert.deepEqual(vault.search("nothing here"), []);
});

test("a single term also matches as a subsequence", (t) => {
	const { vault } = fixture(t, { "linear/eigen/vectors.md": 0 });
	assert.deepEqual(vault.search("lnvec"), ["linear/eigen/vectors.md"]);
});

test("an empty query lists the most recently changed files", (t) => {
	const { vault } = fixture(t, { "old.md": 1_000, "new.md": 3_000, "mid.md": 2_000 });
	assert.deepEqual(vault.search("  "), ["new.md", "mid.md", "old.md"]);
});

test("hidden folders and node_modules stay out of the index", (t) => {
	const { vault } = fixture(t, { ".obsidian/app.md": 0, "node_modules/x/app.md": 0, "a/app.md": 0, "b/.app.md": 0 });
	assert.deepEqual(vault.search("app"), ["a/app.md"]);
	assert.deepEqual(vault.dirs(), ["a", "b"]);
});

test("find resolves embeds from viz/ first, then by name anywhere", (t) => {
	const { root, add, vault } = fixture(t, { "viz/plot.png": 0, "deep/er/plot.png": 0, "deep/pic.png": 0 });
	assert.equal(vault.find("plot.png"), path.join(root, "viz", "plot.png"));
	assert.equal(vault.find("pic.png"), path.join(root, "deep", "pic.png"));
	assert.equal(vault.find("missing.png"), null);
	// A file written after the index was built is still found.
	add("later/new.png");
	assert.equal(vault.find("new.png"), path.join(root, "later", "new.png"));
});

test("a missing vault yields an empty index instead of failing", () => {
	const vault = createVault(path.join(os.tmpdir(), "learn-vault-does-not-exist"));
	assert.deepEqual(vault.search("x"), []);
	assert.deepEqual(vault.dirs(), []);
	assert.equal(vault.find("x.png"), null);
});
