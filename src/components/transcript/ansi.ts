import { escapeHtml } from "@/lib/markdown";

// Terminal colors for command output (SGR only; other escapes are dropped).
// Bold/dim/italic/underline come out as classes styled by `.ansi` in index.css.
const ANSI_BASIC = ["ink-3", "bad", "good", "warn", "syn-attr", "accent", "syn-teal", "ink-2"];
type Sty = { fg: string; b: boolean; d: boolean; i: boolean; u: boolean };

export function ansiToHtml(text: string) {
	const clean = text.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[\d;?]*[A-La-lN-Zn-z]/g, "");
	let out = "";
	let sty: Sty = { fg: "", b: false, d: false, i: false, u: false };
	let open = false;
	const openSpan = () => {
		const cls = (["b", "d", "i", "u"] as const).filter((k) => sty[k]).join(" ");
		if (!cls && !sty.fg) return;
		out += `<span${cls ? ` class="${cls}"` : ""}${sty.fg ? ` style="color:${sty.fg}"` : ""}>`;
		open = true;
	};
	for (const part of clean.split(/(\x1b\[[\d;]*m)/)) {
		const m = /^\x1b\[([\d;]*)m$/.exec(part);
		if (!m) {
			out += escapeHtml(part);
			continue;
		}
		const codes = (m[1] || "0").split(";").map(Number);
		for (let k = 0; k < codes.length; k++) {
			const c = codes[k];
			if (c === 0) sty = { fg: "", b: false, d: false, i: false, u: false };
			else if (c === 1) sty.b = true;
			else if (c === 2) sty.d = true;
			else if (c === 3) sty.i = true;
			else if (c === 4) sty.u = true;
			else if (c === 22) sty.b = sty.d = false;
			else if (c === 23) sty.i = false;
			else if (c === 24) sty.u = false;
			else if (c === 39) sty.fg = "";
			else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) sty.fg = `var(--${ANSI_BASIC[c % 10]})`;
			else if (c === 38 && codes[k + 1] === 2) {
				sty.fg = `rgb(${codes[k + 2]},${codes[k + 3]},${codes[k + 4]})`;
				k += 4;
			} else if (c === 38 && codes[k + 1] === 5) k += 2;
			else if (c === 48) k += codes[k + 1] === 2 ? 4 : 2;
		}
		if (open) out += "</span>";
		open = false;
		openSpan();
	}
	return open ? `${out}</span>` : out;
}
