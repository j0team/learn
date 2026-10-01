/**
 * Shared helpers for the visual-tools authoring loops (mermaid_tools.ts,
 * svg_tools.ts): a subprocess runner and registerSourceTools, which registers
 * the write_/edit_/render_ trio around one per-session managed source file,
 * with pi-edit semantics for edits and publishing a chosen render into
 * <cwd>/viz with a unique filename.
 *
 * Each registerSourceTools call keeps its OWN session state, so mermaid and
 * svg never share a source file.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { spawn } from "node:child_process"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

// rsvg-convert lives under MacPorts (/opt/local/bin); magick/gs under
// /usr/local/bin; Homebrew under /opt/homebrew/bin. Augment PATH so the child
// pi process (which may have inherited a thin PATH) still resolves them.
const EXTRA_PATH = ["/opt/local/bin", "/usr/local/bin", "/opt/homebrew/bin"]

// Transient session/preview files live under the OS temp dir (NOT the vault),
// so only the PUBLISHED PNG ever lands inside the Obsidian vault (viz/).
const STAGING_ROOT = join(tmpdir(), "pi-visual-tools")
const FILES_DIRNAME = "viz"

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> },
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const augmentedPath = [...EXTRA_PATH, process.env.PATH ?? ""].join(delimiter)
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}), PATH: augmentedPath },
    })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, opts.timeoutMs)
    child.stdout.on("data", (d) => (stdout += d.toString()))
    child.stderr.on("data", (d) => (stderr += d.toString()))
    child.on("error", (err) => {
      clearTimeout(timer)
      resolveRun({ code: null, stdout, stderr: stderr + String(err), timedOut })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolveRun({ code, stdout, stderr, timedOut })
    })
  })
}

/** Per-session managed source file, one per child pi process (pid-keyed). */
interface Session {
  workDir: string
  bodyPath: string
}

/** Write the full source to the managed file, creating the session work dir. */
function writeBody(group: string, bodyFileName: string, source: string): Session {
  const workDir = join(STAGING_ROOT, `${group}-${process.pid}`)
  mkdirSync(workDir, { recursive: true })
  const bodyPath = join(workDir, bodyFileName)
  writeFileSync(bodyPath, source, "utf8")
  return { workDir, bodyPath }
}

/**
 * Exact-match single replacement on the current source, matching pi's built-in
 * edit: old_text must appear exactly once. Returns the updated content and the
 * match offset, or throws a precise error.
 */
function applyEdit(current: string, oldText: string, newText: string): { updated: string; index: number } {
  if (oldText === "") throw new Error("`old_text` must be non-empty.")
  if (oldText === newText) throw new Error("`old_text` and `new_text` are identical.")
  const first = current.indexOf(oldText)
  if (first === -1) {
    throw new Error("`old_text` not found in the current source — match it exactly.")
  }
  if (current.indexOf(oldText, first + 1) !== -1) {
    const n = current.split(oldText).length - 1
    throw new Error(`\`old_text\` appears ${n} times — add surrounding context to make it unique.`)
  }
  const updated = current.slice(0, first) + newText + current.slice(first + oldText.length)
  return { updated, index: first }
}

/** A small numbered window of `content` around char offset `index`. */
function snippetAround(content: string, index: number, contextLines = 3): string {
  const before = content.slice(0, index)
  const hitLine = before.split("\n").length - 1
  const lines = content.split("\n")
  const start = Math.max(0, hitLine - contextLines)
  const end = Math.min(lines.length - 1, hitLine + contextLines)
  const width = String(end + 1).length
  const out: string[] = []
  for (let i = start; i <= end; i++) out.push(`${String(i + 1).padStart(width)}  ${lines[i]}`)
  return out.join("\n")
}

/** Copy a rendered PNG into <cwd>/viz with a unique, slugified name. */
function publish(pngPath: string, slug: string): { filename: string; path: string } {
  const filesDir = join(process.cwd(), FILES_DIRNAME)
  mkdirSync(filesDir, { recursive: true })
  const clean =
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "viz"
  const filename = `viz-${clean}-${Date.now()}.png`
  const dest = join(filesDir, filename)
  copyFileSync(pngPath, dest)
  return { filename, path: dest }
}

/** The last lines of a failed render's output, for the error the model sees. */
export function renderError(res: RunResult): string {
  return (res.stderr || res.stdout || "unknown error").split("\n").slice(-30).join("\n")
}

export type RenderOutcome = { ok: true } | { ok: false; text: string }

type RenderDetails = { ok: boolean; path: string; filename?: string }

export interface SourceToolsSpec {
  /** Tool-name suffix: "mermaid" registers write_mermaid, edit_mermaid, render_mermaid. */
  kind: string
  /** Human name used in labels and messages, e.g. "Mermaid". */
  label: string
  bodyFile: string
  writeDescription: string
  sourceDescription: string
  /** Throws when `source` isn't usable; it is already trimmed and non-empty. */
  validate?: (source: string) => void
  renderDescription: string
  slugExample: string
  /** Shown above a published image. */
  publishedNote: string
  /** Shown above a preview image. */
  previewNote: string
  /** Render the source at `bodyPath` to a PNG at `outPath`. */
  render: (bodyPath: string, outPath: string, workDir: string) => Promise<RenderOutcome>
}

/** Register write_<kind>, edit_<kind> and render_<kind> around one managed source file. */
export function registerSourceTools(pi: ExtensionAPI, spec: SourceToolsSpec) {
  const { kind, label } = spec
  const write = `write_${kind}`
  const edit = `edit_${kind}`
  const render = `render_${kind}`
  let session: Session | null = null

  const current = (tool: string): Session => {
    if (!session || !existsSync(session.bodyPath)) {
      throw new Error(`${tool}: no source yet — call ${write} first.`)
    }
    return session
  }

  pi.registerTool({
    name: write,
    label: `Write ${label}`,
    description: spec.writeDescription,
    parameters: Type.Object({
      source: Type.String({ description: spec.sourceDescription }),
    }),
    async execute(_id, params) {
      const source = (params.source ?? "").trim()
      if (!source) throw new Error(`\`${write}\` requires a non-empty \`source\`.`)
      spec.validate?.(source)
      session = writeBody(kind, spec.bodyFile, source)
      const lines = source.split("\n").length
      return {
        content: [
          { type: "text", text: `Wrote ${lines}-line ${label} source.\nCall ${render} to render it, or ${edit} to tweak it.` },
        ],
        details: { ok: true, path: session.bodyPath, lines },
      }
    },
  })

  pi.registerTool({
    name: edit,
    label: `Edit ${label}`,
    description:
      `Make a single exact-match replacement in this session's ${label} source — ` +
      "the same contract as pi's built-in edit, locked to the one managed file. " +
      "`old_text` must appear EXACTLY ONCE (include surrounding context for " +
      "uniqueness); on 0 or >1 matches the call fails and nothing changes. Call " +
      `${write} first. Editing does NOT render.`,
    parameters: Type.Object({
      old_text: Type.String({ description: "Exact substring of the current source to replace (must match once)." }),
      new_text: Type.String({ description: "Replacement text for `old_text`." }),
    }),
    async execute(_id, params) {
      const { bodyPath } = current(edit)
      const { updated, index } = applyEdit(
        readFileSync(bodyPath, "utf8"),
        String(params.old_text ?? ""),
        String(params.new_text ?? ""),
      )
      writeFileSync(bodyPath, updated, "utf8")
      return {
        content: [
          { type: "text", text: "Applied edit. Updated region:\n```\n" + snippetAround(updated, index) + `\n\`\`\`\nCall ${render} to see it.` },
        ],
        details: { ok: true, path: bodyPath },
      }
    },
  })

  pi.registerTool({
    name: render,
    label: `Render ${label}`,
    description: spec.renderDescription,
    parameters: Type.Object({
      save_as: Type.Optional(
        Type.String({
          description:
            `Short kebab-case topic slug (e.g. '${spec.slugExample}'). When set, the ` +
            "rendered PNG is published to <cwd>/viz as viz-<slug>-<timestamp>.png " +
            "and the filename is returned. Omit for a preview-only render.",
        }),
      ),
    }),
    async execute(_id, params) {
      const { workDir, bodyPath } = current(render)
      mkdirSync(workDir, { recursive: true })
      const outPath = join(workDir, `render-${Date.now()}.png`)
      const outcome = await spec.render(bodyPath, outPath, workDir)
      if (!outcome.ok) {
        return { content: [{ type: "text", text: outcome.text }], details: { ok: false, path: "" } as RenderDetails }
      }
      const image = { type: "image" as const, data: readFileSync(outPath).toString("base64"), mimeType: "image/png" }
      if (!params.save_as) {
        return {
          content: [{ type: "text", text: spec.previewNote }, image],
          details: { ok: true, path: outPath } as RenderDetails,
        }
      }
      const { filename, path } = publish(outPath, String(params.save_as))
      return {
        content: [
          { type: "text", text: `Published to viz/.\nfilename: ${filename}\npath: ${path}\n\n${spec.publishedNote}` },
          image,
        ],
        details: { ok: true, path, filename } as RenderDetails,
      }
    },
  })
}
