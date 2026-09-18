// scripts/check-model-metadata-tags.mjs
//
// EP-A33A5C61 slice 4 (BI-D9F158AF) — the ONE stewardship gate for model
// metadata. Every persistent Prisma model must carry a `/// @dpf` tag
// (lifecycle class + retention disposition, closed vocabularies — see
// packages/db/src/model-metadata.ts) OR be named in the shrink-only baseline
// below. A tag that fails validation is always a hard failure.
//
// Replaces, for the metadata concern, the name-suffix heuristic in
// scripts/check-retention-enrollment.mjs (a model is enrolled because it is
// DECLARED, not because its name ends in "Log") and the classification half of
// scripts/check-stewardship-scope.mjs. Those guards keep running until slice 4d
// retires the registries they read.
//
//   node scripts/check-model-metadata-tags.mjs           # check (CI)
//   node scripts/check-model-metadata-tags.mjs --update  # rewrite the baseline (only ever shrinks)
//
// The parser is TypeScript (single source, shared with the boot-time applier
// and the web app); it is loaded here through tsx's programmatic API so this
// guard still runs as `node scripts/...` like every other guard.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const SCHEMA_DIR = join(REPO_ROOT, "packages", "db", "prisma", "schema");
export const BASELINE_PATH = join(REPO_ROOT, "scripts", "model-metadata-baseline.txt");

async function loadParser() {
  const { tsImport } = await import("tsx/esm/api");
  const modulePath = join(REPO_ROOT, "packages", "db", "src", "model-metadata.ts");
  return tsImport(pathToFileURL(modulePath).href, import.meta.url);
}

export function readBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return new Set();
  return new Set(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

export function readSchemaSources(dir = SCHEMA_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".prisma"))
    .sort()
    .map((file) => ({ file, source: readFileSync(join(dir, file), "utf8") }));
}

/**
 * Pure evaluation. `parsed` is the parser output; `baseline` the grandfathered
 * set. Returns failures (hard) and the ratchet state.
 */
export function evaluate(parsed, baseline) {
  const failures = [];
  for (const issue of parsed.issues) {
    failures.push(`${issue.file}:${issue.line} ${issue.model ?? ""}: ${issue.message}`);
  }
  const tagged = new Set(parsed.entries.map((e) => e.model));
  const untagged = parsed.untagged.map((u) => u.model);
  const newGaps = untagged.filter((m) => !baseline.has(m));
  for (const m of newGaps) {
    failures.push(
      `${m}: persistent model carries no /// @dpf tag. Declare lifecycle=<class> retention=<Nd|retained|domain|reference|config|projection> above the model (packages/db/src/model-metadata.ts lists the vocabularies).`,
    );
  }
  const nowTagged = [...baseline].filter((m) => tagged.has(m));
  const vanished = [...baseline].filter((m) => !tagged.has(m) && !untagged.includes(m));
  return { failures, newGaps, nowTagged, vanished, untagged, taggedCount: tagged.size };
}

async function main() {
  const { parseModelMetadataSources } = await loadParser();
  const parsed = parseModelMetadataSources(readSchemaSources());
  const baseline = readBaseline();
  const update = process.argv.includes("--update");

  if (update) {
    const keep = parsed.untagged.map((u) => u.model).filter((m) => baseline.has(m) || baseline.size === 0);
    const body =
      "# owner: platform-architecture\n" +
      "# expiry: 2026-12-01\n" +
      "# scripts/model-metadata-baseline.txt — models that carry NO /// @dpf tag yet (BI-D9F158AF).\n" +
      "# Shrink-only ratchet: a model leaves this file when it gains a tag; a new model can never enter it.\n" +
      "# Regenerate with: node scripts/check-model-metadata-tags.mjs --update\n" +
      keep.sort().join("\n") +
      "\n";
    writeFileSync(BASELINE_PATH, body, "utf8");
    console.log(`Wrote model-metadata baseline: ${keep.length} untagged model(s) grandfathered.`);
    return;
  }

  const result = evaluate(parsed, baseline);
  if (result.vanished.length > 0) {
    result.failures.push(`baseline names model(s) that no longer exist: ${result.vanished.join(", ")} — run --update`);
  }
  if (result.failures.length > 0) {
    console.error("Model metadata gate FAILED:");
    for (const f of result.failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  const grandfathered = result.untagged.length;
  console.log(
    `Model metadata OK — ${result.taggedCount} tagged, ${grandfathered} grandfathered (ratcheting down)` +
      (result.nowTagged.length > 0 ? `. Ratchet available: ${result.nowTagged.length} baselined model(s) now tagged — run --update to remove them.` : "."),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Model metadata gate could not run: ${err instanceof Error ? err.message : err}`);
    process.exit(2);
  });
}
