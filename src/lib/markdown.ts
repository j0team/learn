// Markdown + math for everything the tutor writes: marked with math ($…$, $$…$$,
// \(…\), \[…\]), Obsidian wikilinks and embeds, highlight.js code, mermaid
// diagrams; DOMPurify on the way out. Mermaid loads on first use.

import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import { Marked, type Tokens } from "marked";
import type { Mermaid } from "mermaid";
import { createElement, useEffect, useMemo, useRef } from "react";
import { useStore } from "./store";

// ─── Markdown + math ────────────────────────────────────────────────────────

export function escapeHtml(s: string) {
	return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function tex(src: string, display: boolean) {
	try {
		const html = katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore", output: "htmlAndMathml" });
		return display ? `<div class="math-display">${html}</div>` : html;
	} catch {
		return `<code class="math-error">${escapeHtml(src)}</code>`;
	}
}

type MathToken = { type: string; raw: string; text: string; display?: boolean };
type EmbedToken = { type: string; raw: string; file: string; width?: string };
type LinkToken = { type: string; raw: string; target: string; alias: string };

const md = new Marked({ gfm: true, breaks: false });
md.use({
	extensions: [
		{
			name: "mathBlock",
			level: "block",
			start: (src) => src.match(/\$\$|\\\[/)?.index,
			tokenizer(src) {
				const m = /^\$\$([\s\S]+?)\$\$[^\S\n]*(?:\n|$)/.exec(src) || /^\\\[([\s\S]+?)\\\][^\S\n]*(?:\n|$)/.exec(src);
				if (m) return { type: "mathBlock", raw: m[0], text: m[1].trim() };
			},
			renderer: (t) => tex((t as MathToken).text, true),
		},
		{
			name: "mathInline",
			level: "inline",
			start: (src) => src.match(/\$|\\\(|\\\[/)?.index,
			tokenizer(src) {
				let m = /^\$\$([\s\S]+?)\$\$/.exec(src) || /^\\\[([\s\S]+?)\\\]/.exec(src);
				if (m) return { type: "mathInline", raw: m[0], text: m[1], display: true };
				// $…$ with no space just inside the delimiters and no digit right after
				// the closing one, so prices like "$5 and $10" stay text.
				m = /^\\\(([\s\S]+?)\\\)/.exec(src) || /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
				if (m) return { type: "mathInline", raw: m[0], text: m[1], display: false };
			},
			renderer: (t) => tex((t as MathToken).text, !!(t as MathToken).display),
		},
		{
			name: "wikiEmbed",
			level: "inline",
			start: (src) => (src.indexOf("![[") >= 0 ? src.indexOf("![[") : undefined),
			tokenizer(src) {
				const m = /^!\[\[([^\]|#]+)(?:\|(\d+))?\]\]/.exec(src);
				if (m) return { type: "wikiEmbed", raw: m[0], file: m[1].trim(), width: m[2] };
			},
			renderer: (tok) => {
				const t = tok as EmbedToken;
				return `<img class="embed" src="/vault/${encodeURIComponent(t.file)}" alt="${escapeHtml(t.file)}"${t.width ? ` width="${t.width}"` : ""} loading="lazy">`;
			},
		},
		{
			name: "wikiLink",
			level: "inline",
			start: (src) => (src.indexOf("[[") >= 0 ? src.indexOf("[[") : undefined),
			tokenizer(src) {
				const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(src);
				if (m) return { type: "wikiLink", raw: m[0], target: m[1].trim(), alias: (m[2] || m[1]).trim() };
			},
			renderer: (tok) => {
				const t = tok as LinkToken;
				const vault = useStore.getState().vault;
				return `<a class="wikilink" href="obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(t.target)}">${escapeHtml(t.alias)}</a>`;
			},
		},
	],
	renderer: {
		code({ text, lang }: Tokens.Code) {
			const language = (lang || "").trim().split(/\s/)[0];
			// URI-encoded: DOMPurify drops attribute values containing "-->", which
			// is exactly mermaid's arrow syntax.
			if (language === "mermaid") return `<div class="diagram pending" data-mermaid="${encodeURIComponent(text)}">Drawing diagram…</div>`;
			const html = language && hljs.getLanguage(language) ? hljs.highlight(text, { language }).value : escapeHtml(text);
			return `<pre><code class="hljs">${html}</code></pre>`;
		},
		link({ href, title, tokens }: Tokens.Link) {
			const text = this.parser.parseInline(tokens);
			return `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""} target="_blank" rel="noreferrer">${text}</a>`;
		},
	},
});

const PURIFY = {
	ADD_ATTR: ["target"],
	ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|obsidian):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

/** Block markdown as sanitized HTML. */
export function renderMarkdown(text: string) {
	return DOMPurify.sanitize(md.parse(text || "", { async: false }), PURIFY);
}

/** Inline markdown (no paragraphs) as sanitized HTML. */
export function renderInline(text: string) {
	return DOMPurify.sanitize(md.parseInline(text || "", { async: false }), PURIFY);
}

// ─── Mermaid ────────────────────────────────────────────────────────────────

let mermaidLoad: Promise<Mermaid> | null = null;
let mermaidSeq = 0;
// Diagrams being drawn right now, so overlapping draws don't render one twice.
const drawing = new WeakSet<Element>();

function configureMermaid(mermaid: Mermaid) {
	const dark = useStore.getState().theme !== "light";
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: "base",
		fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--ui"),
		themeCSS: ".node rect, .node polygon, .node circle, .cluster rect { filter: none !important; rx: 8px; ry: 8px; } .edgeLabel { background: transparent; }",
		// Mermaid's color math needs hex; these match the app's dark and light neutrals.
		themeVariables: dark
			? { background: "#121112", primaryColor: "#1f1e1f", primaryBorderColor: "#4a4749", primaryTextColor: "#f3f1f2", lineColor: "#8e898c", secondaryColor: "#2a282a", tertiaryColor: "#171617", textColor: "#f3f1f2", noteBkgColor: "#2a282a", noteTextColor: "#f3f1f2", clusterBkg: "#171617", clusterBorder: "#3a3739" }
			: { background: "#f6f4f5", primaryColor: "#fdfcfd", primaryBorderColor: "#bdb8bb", primaryTextColor: "#232022", lineColor: "#777177", secondaryColor: "#ece9eb", tertiaryColor: "#faf8f9", textColor: "#232022", noteBkgColor: "#ece9eb", noteTextColor: "#232022", clusterBkg: "#faf8f9", clusterBorder: "#cdc8cb" },
	});
}

/** Draw the `.diagram.pending` placeholders inside `root`. */
export async function drawDiagrams(root: ParentNode) {
	if (!root.querySelector(".diagram.pending")) return;
	mermaidLoad ??= import("mermaid").then((m) => m.default);
	const mermaid = await mermaidLoad;
	const pending = [...root.querySelectorAll<HTMLElement>(".diagram.pending")].filter((el) => !drawing.has(el));
	if (!pending.length) return;
	configureMermaid(mermaid);
	for (const el of pending) {
		const src = decodeURIComponent(el.dataset.mermaid || "");
		drawing.add(el);
		el.classList.remove("pending");
		try {
			const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, src);
			el.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"], HTML_INTEGRATION_POINTS: { foreignobject: true } });
		} catch {
			el.classList.add("failed");
			el.innerHTML = `<pre><code>${escapeHtml(src)}</code></pre>`;
		}
		drawing.delete(el);
	}
}

function redrawAllDiagrams() {
	for (const el of document.querySelectorAll(".diagram[data-mermaid]")) {
		el.classList.remove("failed");
		el.classList.add("pending");
	}
	drawDiagrams(document);
}

// Diagrams take the theme's colours, so a theme switch redraws them.
useStore.subscribe((s, prev) => s.theme !== prev.theme && redrawAllDiagrams());

// ─── React ──────────────────────────────────────────────────────────────────

/** Rendered markdown (a div, or a span when `inline`); draws its diagrams after
 *  render unless `diagrams` is false. */
export function Markdown({ text, inline = false, className, diagrams = true }: { text: string; inline?: boolean; className?: string; diagrams?: boolean }) {
	const html = useMemo(() => (inline ? renderInline(text) : renderMarkdown(text)), [text, inline]);
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		if (diagrams && ref.current) drawDiagrams(ref.current);
	}, [html, diagrams]);
	return createElement(inline ? "span" : "div", { ref, className, dangerouslySetInnerHTML: { __html: html } });
}
