/**
 * Mermaid authoring loop for the mermaid-maker subagent — three tools that
 * share one session-scoped source file:
 *
 *   write_mermaid   — write the full Mermaid source to the session's file
 *   edit_mermaid    — exact-match old_text→new_text on that file (pi-edit semantics)
 *   render_mermaid  — render whatever is in the file → PNG, returned inline;
 *                     with `save_as`, also publish it into <cwd>/viz
 *
 * Part of the visual-tools extension (see ../index.ts), which Learn's subagent
 * tool loads into the child pi of any agent whose `tools:` frontmatter names
 * these tools (mermaid-maker).
 *
 * Rendering shells out to @mermaid-js/mermaid-cli (`mmdc`, a Learn dependency)
 * with a puppeteer config pointing at an installed Chrome or Chromium when there
 * is one. Session state lives in this child process, so it is naturally isolated
 * from any parallel maker (different process).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { existsSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { registerSourceTools, renderError, run, type RenderOutcome } from "./_common.ts"

const RENDER_TIMEOUT_MS = 120_000

// Without one of these, mmdc falls back to puppeteer's own browser download.
const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]

function findChrome(): string | undefined {
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c
  return undefined
}

async function renderMermaid(bodyPath: string, outPath: string, workDir: string): Promise<RenderOutcome> {
  const chrome = findChrome()
  const cfgPath = join(workDir, "puppeteer.json")
  writeFileSync(
    cfgPath,
    JSON.stringify(chrome ? { executablePath: chrome, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] }),
    "utf8",
  )

  // The package's own CLI entry (src/cli.js, next to its src/index.js export),
  // not node_modules/.bin/mmdc: file sync flattens that symlink into a copy whose
  // relative import no longer resolves. Looked up here, not at load: Learn's Mac app
  // leaves the package out, and only this tool should fail for that.
  let bin: string
  try {
    bin = join(dirname(createRequire(import.meta.url).resolve("@mermaid-js/mermaid-cli")), "cli.js")
  } catch {
    return {
      ok: false,
      text: "Mermaid rendering isn't installed in this copy of Learn. No image produced; tell the caller to use the SVG maker instead.",
    }
  }
  const res = await run(
    bin,
    ["-i", bodyPath, "-o", outPath, "-p", cfgPath, "-s", "2", "-b", "white"],
    { cwd: workDir, timeoutMs: RENDER_TIMEOUT_MS, env: { PUPPETEER_SKIP_DOWNLOAD: "1" } },
  )
  if (res.code === 0 && existsSync(outPath)) return { ok: true }
  const note = res.timedOut ? "mmdc timed out.\n\n" : ""
  return {
    ok: false,
    text: `${note}Mermaid render FAILED — no image produced. Fix the source with edit_mermaid and call render_mermaid again.\n\nError:\n${renderError(res)}`,
  }
}

export default function mermaidToolsExtension(pi: ExtensionAPI) {
  registerSourceTools(pi, {
    kind: "mermaid",
    label: "Mermaid",
    bodyFile: "diagram.mmd",
    writeDescription:
      "Write the FULL Mermaid source to this session's managed file (your first " +
      "draft or a complete rewrite). You do NOT name the file — edit_mermaid and " +
      "render_mermaid act on the same one.\n\n" +
      "`source` is a complete Mermaid diagram, e.g. a `graph TD` / `graph LR` " +
      "flow, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`, " +
      "`mindmap`, or `timeline`. Writing does NOT render — call render_mermaid " +
      "when ready. For a small fix, prefer edit_mermaid over rewriting.",
    sourceDescription: "The complete Mermaid diagram source (starts with the diagram type, e.g. `graph TD`).",
    renderDescription:
      "Render the CURRENT session Mermaid source to a PNG and return it inline so " +
      "you can SEE the diagram and iterate. You do NOT pass the source here — it " +
      "comes from the managed file; call write_mermaid first.\n\n" +
      "Iterate freely with no `save_as` (preview only). When the diagram is " +
      "correct and clean, call once more with `save_as` set to a short kebab-case " +
      "topic slug: that publishes the PNG into <cwd>/viz with a unique " +
      "filename and returns the filename to embed. On a render error this returns " +
      "the error text instead of an image — fix with edit_mermaid and re-render.",
    slugExample: "internet-packets",
    publishedNote: "LOOK at the diagram below to confirm it is correct before returning it.",
    previewNote:
      "Preview render (not yet saved). LOOK: are arrows/relationships correct, labels right, nothing cramped? Fix with edit_mermaid, or re-render with `save_as` to publish.",
    render: renderMermaid,
  })
}
