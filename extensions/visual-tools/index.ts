/**
 * visual-tools: the authoring tools of the diagram makers (agents/mermaid-maker.md,
 * agents/svg-maker.md). Learn's subagent tool (server/learn.ts) loads this into
 * a maker's own pi process:
 *   • write_mermaid / edit_mermaid / render_mermaid  (tools/mermaid_tools.ts)
 *   • write_svg / edit_svg / render_svg              (tools/svg_tools.ts)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import mermaidTools from "./tools/mermaid_tools"
import svgTools from "./tools/svg_tools"

export default function (pi: ExtensionAPI) {
	mermaidTools(pi)
	svgTools(pi)
}
