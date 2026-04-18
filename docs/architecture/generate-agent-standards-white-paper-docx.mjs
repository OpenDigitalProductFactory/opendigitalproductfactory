/**
 * Trusted AI Agent Governance white paper generator.
 *
 * Uses the Markdown source of truth and embeds high-resolution diagram assets.
 *
 * Usage: node docs/architecture/generate-agent-standards-white-paper-docx.mjs
 */

import { join, resolve } from "node:path";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

const ARCH_DIR = resolve(import.meta.dirname);

await generateDocxFromMarkdown({
  markdownPath: join(ARCH_DIR, "2026-04-18-trusted-ai-agent-governance-white-paper.md"),
  outputPath: join(ARCH_DIR, "Trusted-AI-Agent-Governance-White-Paper.docx"),
  title: "Trusted AI Agent Governance",
  subtitle: "Why TAK and GAID Are Needed Now",
  headerTitle: "Trusted AI Agent Governance White Paper",
  diagramsDir: join(ARCH_DIR, "gaid-diagrams"),
});
