/**
 * TAK-JSI Markdown -> DOCX generator.
 *
 * Usage: pnpm exec tsx docs/architecture/generate-jsi-docx.mjs
 */

import { generateAgentStandardDocx } from "./generate-agent-standard-docx.mjs";

await generateAgentStandardDocx("jsi");
