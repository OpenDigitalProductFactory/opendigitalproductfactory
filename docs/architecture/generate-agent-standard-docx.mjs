/**
 * Generate one or all publication artifacts in the TAK/GAID/TAK-JSI/GPP standards family.
 *
 * Usage:
 *   pnpm exec tsx docs/architecture/generate-agent-standard-docx.mjs tak
 *   pnpm exec tsx docs/architecture/generate-agent-standard-docx.mjs all
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { isEntryModule } from "../../scripts/lib/entry-module.mjs";
import {
  publicationConfig,
  publicationKeys,
} from "./agent-standard-publications.mjs";
import { generateDocxFromMarkdown } from "./generate-docx-from-markdown.mjs";

const NORMATIVE_LAYOUT_KEYS = new Set(["tak", "gaid", "jsi", "gpp"]);

/** Generate a canonical publication; only the four normative editions opt in. */
export async function generateAgentStandardDocx(key, {
  config = publicationConfig(key),
  generate = generateDocxFromMarkdown,
} = {}) {
  if (key === "white-paper") {
    // Preserve the generic CLI's prior behavior. The dedicated white-paper
    // wrapper separately owns its existing image-only post-processing.
    return generate(config);
  }
  publicationConfig(key);
  if (!NORMATIVE_LAYOUT_KEYS.has(key)) {
    throw new Error(`Publication "${key}" has no explicit normative layout profile`);
  }
  const directory = mkdtempSync(join(dirname(config.outputPath), ".dpf-publication-"));
  const outputPath = join(directory, basename(config.outputPath));
  try {
    await generate({ ...config, outputPath });
    const fitted = spawnSync(process.env.DPF_PUBLICATION_PYTHON || "python3", [
      join(import.meta.dirname, "fit-white-paper-docx-images.py"), outputPath, "--tables",
    ], { encoding: "utf8" });
    if (fitted.error) throw fitted.error;
    if (fitted.status !== 0) throw new Error(`Publication layout fit failed: ${fitted.stderr}`);
    // Candidate and target share a filesystem, including on Windows/external
    // volumes. Failed generation or fitting never replaces the prior edition.
    renameSync(outputPath, config.outputPath);
    process.stdout.write(fitted.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (isEntryModule(import.meta.url)) {
  const requested = process.argv[2] ?? "all";
  const keys = requested === "all" ? publicationKeys() : [requested];
  for (const key of keys) {
    console.log(`Generating agent-standard publication: ${key}`);
    await generateAgentStandardDocx(key);
  }
}
