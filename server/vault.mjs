// The vault's files: @-mention search, save folders and embedded images.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// A folder inside the vault, as typed or picked ("stat/341/lessons"): slashes
// either way, no hidden or parent segments. Null when it isn't one.
export function vaultFolder(input) {
	const parts = String(input ?? "").replace(/\\/g, "/").split("/").map((p) => p.trim()).filter(Boolean);
	if (!parts.length || parts.some((p) => p.startsWith("."))) return null;
	return parts.join("/");
}

function isSubsequence(hay, needle) {
	let i = 0;
	for (const ch of hay) if (ch === needle[i] && ++i === needle.length) return true;
	return false;
}

export function createVault(root) {
	let cache = { at: 0, files: [], dirs: [], byName: new Map() };

	// Every file and folder, skipping hidden ones and node_modules; kept for 30s.
	function index(fresh = false) {
		if (!fresh && Date.now() - cache.at < 30_000) return cache;
		const files = [];
		const dirs = [];
		const byName = new Map();
		const stack = [""];
		while (stack.length) {
			const rel = stack.pop();
			let entries;
			try {
				entries = readdirSync(path.join(root, rel), { withFileTypes: true });
			} catch {
				continue;
			}
			for (const e of entries) {
				if (e.name.startsWith(".") || e.name === "node_modules") continue;
				const p = rel ? `${rel}/${e.name}` : e.name;
				if (e.isDirectory()) {
					stack.push(p);
					dirs.push(p);
				} else if (e.isFile()) {
					files.push({ path: p, lower: p.toLowerCase() });
					if (!byName.has(e.name)) byName.set(e.name, p);
				}
			}
		}
		cache = { at: Date.now(), files, dirs: dirs.sort((a, b) => a.localeCompare(b)), byName };
		return cache;
	}

	// The 30 newest files. Stats every file, so only when asked, once per index.
	function recent(current) {
		current.recent ??= current.files
			.map((f) => [statSync(path.join(root, f.path), { throwIfNoEntry: false })?.mtimeMs ?? 0, f.path])
			.sort((a, b) => b[0] - a[0])
			.slice(0, 30)
			.map((f) => f[1]);
		return current.recent;
	}

	// Every term must hit the path; name hits beat folder hits. No query: recent files.
	function search(q) {
		const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
		const current = index();
		if (!terms.length) return recent(current);
		const { files } = current;
		const scored = [];
		for (const f of files) {
			const base = f.lower.slice(f.lower.lastIndexOf("/") + 1);
			let score = 0;
			for (const t of terms) {
				if (base.startsWith(t)) score += 40;
				else if (base.includes(t)) score += 30;
				else if (f.lower.includes(t)) score += 15;
				else if (terms.length === 1 && isSubsequence(f.lower, t)) score += 1;
				else {
					score = -1;
					break;
				}
			}
			if (score >= 0) scored.push([score - f.path.length / 200, f.path]);
		}
		return scored.sort((a, b) => b[0] - a[0]).slice(0, 30).map((s) => s[1]);
	}

	// Images referenced as Obsidian embeds (![[name.png]]) resolve by file name
	// anywhere in the vault, like Obsidian itself. Makers publish into viz/. A
	// miss re-reads the vault once, for a file written since the last index.
	function find(name) {
		const direct = path.join(root, "viz", name);
		if (existsSync(direct)) return direct;
		const rel = index().byName.get(name) ?? index(true).byName.get(name);
		return rel ? path.join(root, rel) : null;
	}

	return { dirs: () => index().dirs, search, find };
}
