/**
 * TAK Markdown -> DOCX generator.
 *
 * Renders Mermaid diagrams to SVG + high-resolution PNG and assembles
 * the publication DOCX from the Markdown source of truth.
 *
 * Usage: node docs/architecture/generate-tak-docx.mjs
 */

import { join, resolve } from "node:path";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

const ARCH_DIR = resolve(import.meta.dirname);

await generateDocxFromMarkdown({
  markdownPath: join(ARCH_DIR, "trusted-ai-kernel.md"),
  outputPath: join(ARCH_DIR, "Trusted-AI-Kernel-Architecture.docx"),
  title: "Trusted AI Kernel",
  subtitle: "Normative Runtime Governance Standard",
  headerTitle: "Trusted AI Kernel (TAK)",
  diagramsDir: join(ARCH_DIR, "tak-diagrams"),
});
