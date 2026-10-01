/**
 * SVG authoring loop for the svg-maker subagent — three tools that share one
 * session-scoped source file:
 *
 *   write_svg   — write the full SVG source to the session's file
 *   edit_svg    — exact-match old_text→new_text on that file (pi-edit semantics)
 *   render_svg  — render whatever is in the file → PNG, returned inline; with
 *                 `save_as`, also publish it into <cwd>/viz
 *
 * Part of the visual-tools extension (see ../index.ts), which Learn's subagent
 * tool loads into the child pi of any agent whose `tools:` frontmatter names
 * these tools (svg-maker).
 *
 * Rendering shells out to rsvg-convert (librsvg — good system-font handling),
 * falling back to ImageMagick's `magick` if rsvg-convert is absent. Both are
 * system binaries; no node render deps. Session state lives in this child
 * process, isolated from any parallel maker.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { existsSync } from "node:fs"
import { registerSourceTools, renderError, run, type RenderOutcome } from "./_common.ts"

const RENDER_TIMEOUT_MS = 60_000

/** Render an SVG file to PNG via rsvg-convert, falling back to magick. */
async function renderSvg(svgPath: string, outPath: string, workDir: string): Promise<RenderOutcome> {
  const opts = { cwd: workDir, timeoutMs: RENDER_TIMEOUT_MS }
  // rsvg-convert renders at the SVG's intrinsic size; -z 2 doubles it for crispness.
  const rsvg = await run("rsvg-convert", ["-z", "2", svgPath, "-o", outPath], opts)
  if (rsvg.code === 0 && existsSync(outPath)) return { ok: true }
  // Fallback: ImageMagick. -density 192 (~2x of 96dpi) for a crisp raster.
  const magick = await run("magick", ["-density", "192", "-background", "white", svgPath, outPath], opts)
  if (magick.code === 0 && existsSync(outPath)) return { ok: true }
  const res = rsvg.code !== null ? rsvg : magick
  const note = res.timedOut ? "SVG render timed out.\n\n" : ""
  return {
    ok: false,
    text: `${note}SVG render FAILED — no image produced (tried rsvg-convert then magick). Fix the source with edit_svg and call render_svg again.\n\nError:\n${renderError(res)}`,
  }
}

export default function svgToolsExtension(pi: ExtensionAPI) {
  registerSourceTools(pi, {
    kind: "svg",
    label: "SVG",
    bodyFile: "diagram.svg",
    writeDescription:
      "Write the FULL SVG source to this session's managed file (your first draft " +
      "or a complete rewrite). You do NOT name the file — edit_svg and render_svg " +
      "act on the same one.\n\n" +
      "`source` is a complete `<svg ...>…</svg>` document with an explicit width/" +
      "height (or viewBox), readable font sizes, and a light or transparent " +
      "background. Writing does NOT render — call render_svg when ready. For a " +
      "small fix, prefer edit_svg over rewriting.",
    sourceDescription: "The complete SVG document, from `<svg` to `</svg>`.",
    validate(source) {
      if (!source.includes("<svg")) throw new Error("`write_svg`: source must be a complete <svg>…</svg> document.")
    },
    renderDescription:
      "Render the CURRENT session SVG source to a PNG and return it inline so you " +
      "can SEE the picture and iterate. You do NOT pass the source here — it comes " +
      "from the managed file; call write_svg first.\n\n" +
      "Iterate freely with no `save_as` (preview only). When the picture is " +
      "correct and clean, call once more with `save_as` set to a short kebab-case " +
      "topic slug: that publishes the PNG into <cwd>/viz with a unique " +
      "filename and returns the filename to embed. On a render error this returns " +
      "the error text instead of an image — fix with edit_svg and re-render.",
    slugExample: "number-line",
    publishedNote: "LOOK at the picture below to confirm the geometry is correct before returning it.",
    previewNote:
      "Preview render (not yet saved). LOOK: are coordinates, angles, directions, and proportions correct? Labels clear and unclipped? Fix with edit_svg, or re-render with `save_as` to publish.",
    render: renderSvg,
  })
}
