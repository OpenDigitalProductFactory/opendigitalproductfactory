#!/usr/bin/env node
// scripts/check-authoring-cost-dimensions.mjs
//
// BI-7CE5E772. The authoring guide hand-listed the cost dimensions and drifted:
// it named three while the registry defined five, so an author following it
// treated `operator_effort` and `business_disruption` as benefits and signed
// them positive — the exact inversion the cost list exists to prevent.
//
// That inversion has real history. `never-wipe-db-for-code-fixes` once carried
// `blast_radius: 1.0` and the scorer ranked "wipe the db" as its best-aligned
// option. The sign-convention guard in seed-wiki-kernel.test.ts catches the
// result; nothing caught the guidance that produced it.
//
// So: the registry is the authority, the guide is a convenience, and this guard
// keeps the convenience honest. Every cost dimension defined in code must be
// named in the guide, and the guide must name nothing that is not a cost.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isEntryModule } from "./lib/entry-module.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");

const AUTHORING_PATH = join(REPO_ROOT, "docs", "founder-kernel", "AUTHORING.md");
const TAXONOMY_PATH = join(REPO_ROOT, "packages", "db", "src", "wiki-taxonomy.ts");

/**
 * Read the cost dimensions the code actually enforces. Parsed from source
 * rather than imported so this guard runs with no build step and no TypeScript
 * loader — the same reason the other policy guards read files directly.
 */
export function parseCostDimensionsFromTaxonomy(source) {
  const start = source.indexOf("PRINCIPLE_COST_DIMENSIONS = [");
  if (start === -1) throw new Error("PRINCIPLE_COST_DIMENSIONS not found in wiki-taxonomy.ts");
  const end = source.indexOf("]", start);
  if (end === -1) throw new Error("PRINCIPLE_COST_DIMENSIONS is not terminated");
  const body = source.slice(start, end);
  // Strip line comments first: the block is heavily annotated, and a comment
  // mentioning another dimension by name must not be read as a member.
  const withoutComments = body
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  return [...withoutComments.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
}

/** The dimension names the authoring guide presents to an author as costs. */
export function parseCostDimensionsFromAuthoring(source) {
  const marker = "**Cost axes must be negative.**";
  const start = source.indexOf(marker);
  if (start === -1) throw new Error("the cost-axis paragraph is missing from AUTHORING.md");
  // Bounded to the sentence that enumerates the set, so a later mention of one
  // dimension in prose is not mistaken for the list itself.
  const end = source.indexOf("Read the registry rather than trusting this list", start);
  if (end === -1) {
    throw new Error(
      "the cost-axis paragraph no longer points at the registry as the authority — "
        + "keep that pointer, or this guard cannot tell a list from a mention",
    );
  }
  const segment = source.slice(start, end);
  return [...segment.matchAll(/`([a-z_]+)`/g)]
    .map((match) => match[1])
    .filter((name) => name !== "PRINCIPLE_COST_DIMENSIONS");
}

export function compareCostDimensions({ code, doc }) {
  const missing = code.filter((name) => !doc.includes(name));
  const extra = doc.filter((name) => !code.includes(name));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

function main() {
  const code = parseCostDimensionsFromTaxonomy(readFileSync(TAXONOMY_PATH, "utf8"));
  const doc = parseCostDimensionsFromAuthoring(readFileSync(AUTHORING_PATH, "utf8"));
  const result = compareCostDimensions({ code, doc });

  if (result.ok) {
    console.log(
      `[authoring-cost-dimensions] OK — AUTHORING.md names all ${code.length} cost dimension(s) `
        + "the registry enforces.",
    );
    return 0;
  }

  console.error("[authoring-cost-dimensions] AUTHORING.md and PRINCIPLE_COST_DIMENSIONS disagree.");
  if (result.missing.length) {
    console.error(
      `  missing from the guide: ${result.missing.join(", ")}\n`
        + "    An author following the guide will treat these as benefit axes and sign them POSITIVE,\n"
        + "    which makes the scorer reward the cost the principle exists to prevent.",
    );
  }
  if (result.extra.length) {
    console.error(
      `  named by the guide but not a cost in code: ${result.extra.join(", ")}\n`
        + "    Either the registry lost one, or the guide is inventing them.",
    );
  }
  console.error(
    "  Fix the guide, or the registry, so they agree. The registry is the authority "
      + "(packages/db/src/wiki-taxonomy.ts).",
  );
  return 1;
}

if (isEntryModule(import.meta.url)) {
  process.exit(main());
}
