/**
 * White-paper Markdown -> portal HTML -> pinned dpf-doctools -> page-fit figures.
 *
 * Usage: pnpm exec tsx docs/architecture/generate-agent-standards-white-paper-docx.mjs
 * Requires Python 3 (standard library only); DPF_PUBLICATION_PYTHON can select it.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { publicationConfig } from "./agent-standard-publications.mjs";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

const config = publicationConfig("white-paper");
// Inline fences are derived here; linked committed figures still resolve from
// the Markdown directory. Never re-render the other publications' diagrams.
const diagramsDir = mkdtempSync(join(tmpdir(), "dpf-white-paper-diagrams-"));
try {
  await generateDocxFromMarkdown({ ...config, diagramsDir });
  const result = spawnSync(process.env.DPF_PUBLICATION_PYTHON || "python3", [
    join(import.meta.dirname, "fit-white-paper-docx-images.py"), config.outputPath,
  ], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`White-paper figure fit failed: ${result.stderr}`);
  process.stdout.write(result.stdout);
} finally {
  rmSync(diagramsDir, { recursive: true, force: true });
}
