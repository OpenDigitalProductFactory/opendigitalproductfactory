/**
 * GAID Markdown -> DOCX generator.
 *
 * Renders Mermaid diagrams to SVG + high-resolution PNG and assembles
 * the publication DOCX from the Markdown source of truth.
 *
 * Usage: pnpm exec tsx docs/architecture/generate-gaid-docx.mjs
 */

import { generateAgentStandardDocx } from "./generate-agent-standard-docx.mjs";

await generateAgentStandardDocx("gaid");
