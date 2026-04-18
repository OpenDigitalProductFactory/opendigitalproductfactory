/**
 * GAID Markdown -> DOCX generator.
 *
 * Renders Mermaid diagrams to SVG + high-resolution PNG and assembles
 * the publication DOCX from the Markdown source of truth.
 *
 * Usage: node docs/architecture/generate-gaid-docx.mjs
 */

import { join, resolve } from "node:path";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

const ARCH_DIR = resolve(import.meta.dirname);

await generateDocxFromMarkdown({
  markdownPath: join(ARCH_DIR, "GAID.md"),
  outputPath: join(ARCH_DIR, "GAID.docx"),
  title: "Global AI Agent Identification and Governance",
  subtitle: "Normative Identity, Badging, and Chain-of-Custody Standard",
  headerTitle: "Global AI Agent Identification and Governance (GAID)",
  diagramsDir: join(ARCH_DIR, "gaid-diagrams"),
});
