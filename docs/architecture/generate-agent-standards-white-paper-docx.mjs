/**
 * Trusted AI Agent Governance white paper generator.
 *
 * Uses the Markdown source of truth and embeds high-resolution diagram assets.
 *
 * Usage: node docs/architecture/generate-agent-standards-white-paper-docx.mjs
 */

import { publicationConfig } from "./agent-standard-publications.mjs";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

await generateDocxFromMarkdown(publicationConfig("white-paper"));
