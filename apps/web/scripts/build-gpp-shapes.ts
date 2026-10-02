/**
 * GPP shape generator — the one home for every artifact generated from GPP
 * shape documents (docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md,
 * BI-6DA17863). Later phases extend this script; they do not add a second one.
 *
 * PR-3a-1 scope: the schema step only. Regenerates the published JSON Schema
 * 2020-12 for the shape document from its Zod definition
 * (apps/web/lib/gpp/shape-language/gpp-shape-schema.ts).
 *
 * Deterministic: no timestamps, LF only, key order fixed by the Zod definition.
 * Static — no DB, no network.
 *
 * Usage:
 *   pnpm --filter web build:gpp-shapes           # write
 *   pnpm --filter web check:gpp-shapes           # fail if the committed file is stale
 */

import { gppShapeJsonSchema } from "../lib/gpp/shape-language/gpp-shape-schema";
import { findRepoRoot, writeOrCheckGeneratedJson } from "./registry-generator-support";

export const GPP_SHAPE_SCHEMA_REL = "apps/web/lib/gpp/shape-language/gpp-shape.schema.json";
const LABEL = "gpp-shapes";
const BUILD_COMMAND = "pnpm --filter web build:gpp-shapes";

/** Write (or, with `check`, verify) every generated GPP shape artifact under `root`. Throws when stale. */
export function runGppShapesGenerator(options: { root: string; check: boolean }): void {
  writeOrCheckGeneratedJson({
    root: options.root,
    relativePath: GPP_SHAPE_SCHEMA_REL,
    value: gppShapeJsonSchema(),
    check: options.check,
    label: LABEL,
    buildCommand: BUILD_COMMAND,
  });
}

function main(): void {
  const check = process.argv.includes("--check");
  try {
    runGppShapesGenerator({ root: findRepoRoot(), check });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  console.error(`[${LABEL}] ${check ? "up to date" : "wrote"}: ${GPP_SHAPE_SCHEMA_REL}`);
}

if (process.argv[1] && /build-gpp-shapes\.[cm]?ts$/.test(process.argv[1])) main();
