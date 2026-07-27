/**
 * Generate one or all publication artifacts in the TAK/GAID/TAK-JSI standards family.
 *
 * Usage:
 *   node docs/architecture/generate-agent-standard-docx.mjs tak
 *   node docs/architecture/generate-agent-standard-docx.mjs all
 */

import {
  publicationConfig,
  publicationKeys,
} from "./agent-standard-publications.mjs";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

const requested = process.argv[2] ?? "all";
const keys = requested === "all" ? publicationKeys() : [requested];

for (const key of keys) {
  console.log(`Generating agent-standard publication: ${key}`);
  await generateDocxFromMarkdown(publicationConfig(key));
}
