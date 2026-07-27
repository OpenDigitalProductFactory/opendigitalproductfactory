/**
 * TAK Markdown -> DOCX generator.
 *
 * Renders Mermaid diagrams to SVG + high-resolution PNG and assembles
 * the publication DOCX from the Markdown source of truth.
 *
 * Usage: node docs/architecture/generate-tak-docx.mjs
 */

import { publicationConfig } from "./agent-standard-publications.mjs";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

await generateDocxFromMarkdown(publicationConfig("tak"));
