/**
 * TAK-JSI Markdown -> DOCX generator.
 *
 * Usage: pnpm exec tsx docs/architecture/generate-jsi-docx.mjs
 */

import { publicationConfig } from "./agent-standard-publications.mjs";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

await generateDocxFromMarkdown(publicationConfig("jsi"));
