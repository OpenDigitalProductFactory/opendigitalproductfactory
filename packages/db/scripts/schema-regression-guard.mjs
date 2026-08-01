#!/usr/bin/env node
//
// schema-regression-guard.mjs — detect genuine schema regressions in
// packages/db/prisma/schema.prisma between a base ref and HEAD.
//
// What counts as a regression:
//   - A model removed entirely
//   - A field removed from an existing model
//   - An attribute (@-decoration or @@-block) removed from a model
//   - An enum removed entirely
//   - An enum value removed from an existing enum
//
// What does NOT count (tolerated):
//   - Within-model reorder of fields or attributes (prisma format reshuffles
//     @@index/@@unique ordering across formatter versions; the line is still
//     present, just at a different position)
//   - Whitespace / column-alignment changes (formatter quirks)
//   - Trailing-comment changes that don't alter the declared item
//
// Algorithm: parse each schema into models/enums, normalize each line, then
// compare sets per model/enum. Set diff ignores position.
//
// Usage:
//   node packages/db/scripts/schema-regression-guard.mjs <base-ref>
//   node packages/db/scripts/schema-regression-guard.mjs origin/main
//
// Exit codes:
//   0  — no regressions
//   1  — at least one regression detected (details on stderr)
//   2  — invocation error (missing base ref, git failure, etc.)
//
// Wired into:
//   - .github/workflows/schema-regression-guard.yml (CI)
//   - .githooks/pre-commit Guard 5 (local, when schema.prisma is staged)
//   - packages/db/scripts/schema-regression-guard.test.ts (vitest)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_REPO_PATH = "packages/db/prisma/schema.prisma";

// ─── Parser ──────────────────────────────────────────────────────────────────
//
// Parse a Prisma schema source into a structured representation:
//
//   {
//     models: Map<modelName, Set<normalizedLine>>,
//     enums:  Map<enumName, Set<normalizedValueLine>>,
//   }
//
// Only model/enum BODIES are tracked. Top-level (datasource/generator) is
// skipped — it changes via different review channels and isn't subject to
// the same regression rule.
//
// Each body line is normalized by:
//   1. Stripping leading/trailing whitespace
//   2. Collapsing internal whitespace runs to a single space (so column
//      alignment changes don't register as content changes)
//   3. Stripping trailing line comments (`//` to end of line)
//   4. Dropping the line if it's empty after normalization, or if it was a
//      pure-comment line to begin with
//
// The normalized line is what enters the Set. Two schemas that differ only
// by formatter whitespace produce identical sets.
export function parseSchema(source) {
  const models = new Map();
  const enums = new Map();

  let currentKind = null; // "model" | "enum" | null
  let currentName = null;
  let currentSet = null;

  for (const rawLine of source.split("\n")) {
    const openMatch = /^(model|enum)\s+(\w+)\s*\{/.exec(rawLine);
    if (openMatch && currentKind === null) {
      currentKind = openMatch[1];
      currentName = openMatch[2];
      currentSet = new Set();
      (currentKind === "model" ? models : enums).set(currentName, currentSet);
      continue;
    }

    if (currentKind !== null && /^\s*\}\s*$/.test(rawLine)) {
      currentKind = null;
      currentName = null;
      currentSet = null;
      continue;
    }

    if (currentSet === null) continue;

    // Drop trailing line comment (but keep the content before it).
    // We don't try to be smart about strings — Prisma schema doesn't have
    // `//` inside strings in practice.
    //
    // CRLF guard: working trees on Windows / autocrlf=true have lines
    // ending in `\r`. JavaScript regex `.` does NOT match `\r` (it's a
    // line terminator), so `\/\/.*$` would refuse to match comments on
    // CRLF lines — the comment text leaked into the normalized line and
    // set comparison flagged every CRLF line as "missing" from the
    // base (which is read via `git show` and is always LF-terminated).
    // Strip the trailing `\r` before stripping comments.
    let line = rawLine.replace(/\r$/, "").replace(/\/\/.*$/, "");

    // Normalize whitespace.
    line = line.trim().replace(/\s+/g, " ");

    if (line === "") continue;

    currentSet.add(line);
  }

  return { models, enums };
}

// ─── Diff ────────────────────────────────────────────────────────────────────
//
// Compare two parsed schemas. Returns an array of human-readable regression
// strings. An empty array means no regressions.
function parseModelFieldLine(line) {
  if (line.startsWith("@")) return null;
  const match = /^(\w+)\s+([^\s]+)(.*)$/.exec(line);
  if (!match) return null;
  return {
    name: match[1],
    type: match[2],
    suffix: match[3].trim(),
  };
}

function isOptionalityWidening(baseLine, headLine) {
  const base = parseModelFieldLine(baseLine);
  const head = parseModelFieldLine(headLine);
  if (!base || !head) return false;
  if (base.name !== head.name) return false;
  if (base.type.endsWith("?")) return false;
  if (head.type !== `${base.type}?`) return false;
  return base.suffix === head.suffix;
}

// A change to a column's `@default(...)` value is NOT a regression: it only
// affects new inserts, never existing rows, and the field/type/other attributes
// are unchanged. Tolerate it the same way optionality-widening is tolerated, so
// a legitimate default change (e.g. GBP -> USD to retire a locale bias) isn't
// misread as a field removal. Same field name + type, and the suffixes are
// identical once each side's `@default(...)` argument is normalized away.
function normalizeDefaultArg(suffix) {
  return suffix.replace(/@default\([^)]*\)/, "@default()").trim();
}
function isDefaultValueChange(baseLine, headLine) {
  const base = parseModelFieldLine(baseLine);
  const head = parseModelFieldLine(headLine);
  if (!base || !head) return false;
  if (base.name !== head.name || base.type !== head.type) return false;
  if (!/@default\(/.test(base.suffix) || !/@default\(/.test(head.suffix)) return false;
  return normalizeDefaultArg(base.suffix) === normalizeDefaultArg(head.suffix);
}

// Fields intentionally removed via a steward-reviewed migration (AGENTS.md §11).
// Each entry is "Model.field". The guard skips these specific removals so an
// approved schema-convergence migration can land, while still blocking every
// OTHER (accidental) field drop. Add an entry ONLY alongside the migration that
// drops the column, in a PR reviewed by the schema steward; prune entries once
// they have shipped to every environment.
export const INTENTIONAL_FIELD_REMOVALS = new Set([
  // 2026-07-31 EP-LIFECYCLE: refinementLevel becomes required after the
  // reconcile migration normalizes every existing row and installs a default.
  // The parser represents optionality tightening as removal of the nullable
  // field signature. Prune once the migration has shipped fleet-wide.
  "EaElement.refinementLevel",
  // 2026-06-19 architecture-convergence: vestigial ModelProvider score columns.
  // Compiler-oracle-verified zero references — ModelProfile is the live per-model
  // scoring source. (The ModelProvider score columns still read by the provider
  // UI are intentionally KEPT until that data layer is migrated to ModelProfile.)
  "ModelProvider.customScores",
  "ModelProvider.evalCount",
  "ModelProvider.lastCallAt",
  "ModelProvider.lastEvalAt",
  "ModelProvider.profileConfidence",
  "ModelProvider.supportedModalities",
  // 2026-06-19: deprecated duplicate of the canonical StorefrontConfig.archetypeId.
  "BusinessContext.archetypeId",
  // 2026-07-16 BI-PIR-7d69a445 (part 2): drop the `@unique` on
  // InventoryRelationship.relationshipKey — the COLUMN is KEPT (still written for
  // provenance/back-compat), only its source-scoped uniqueness is removed so the
  // discovery-sync upsert can target the canonical
  // @@unique([fromEntityId, toEntityId, relationshipType]) tuple and stop the
  // cross-run P2002. Migration:
  // 20260716230000_inventoryrelationship_tuple_canonical. Prune once shipped to
  // every environment. (This guard keys the skip by field name; the field itself
  // is not dropped, so no other line for it can regress.)
  "InventoryRelationship.relationshipKey",
]);

export function diffSchemas(base, head, allowlist = INTENTIONAL_FIELD_REMOVALS) {
  const regressions = [];

  // Models
  for (const [name, baseLines] of base.models) {
    if (!head.models.has(name)) {
      regressions.push(`model ${name} removed entirely`);
      continue;
    }
    const headLines = head.models.get(name);
    for (const line of baseLines) {
      if (!headLines.has(line)) {
        const equivalentWidening = [...headLines].some((headLine) =>
          isOptionalityWidening(line, headLine),
        );
        if (equivalentWidening) continue;
        // A default-value-only change is not a removal (new-insert default only).
        const defaultOnlyChange = [...headLines].some((headLine) =>
          isDefaultValueChange(line, headLine),
        );
        if (defaultOnlyChange) continue;
        // Sanctioned, steward-reviewed removals are skipped; everything else
        // (accidental drops) still regresses.
        const parsed = parseModelFieldLine(line);
        if (parsed && allowlist.has(`${name}.${parsed.name}`)) continue;
        regressions.push(`model ${name}: removed \`${line}\``);
      }
    }
  }

  // Enums
  for (const [name, baseValues] of base.enums) {
    if (!head.enums.has(name)) {
      regressions.push(`enum ${name} removed entirely`);
      continue;
    }
    const headValues = head.enums.get(name);
    for (const value of baseValues) {
      if (!headValues.has(value)) {
        regressions.push(`enum ${name}: removed value \`${value}\``);
      }
    }
  }

  return regressions;
}

// ─── CLI entry point ─────────────────────────────────────────────────────────
//
// Only runs the CLI when invoked directly. When imported (by tests) the
// functions above are exposed and the CLI block is skipped.
const __filename = fileURLToPath(import.meta.url);
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(__filename);

if (invokedDirectly) {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error(
      "Usage: node packages/db/scripts/schema-regression-guard.mjs <base-ref>",
    );
    console.error("       e.g. node packages/db/scripts/schema-regression-guard.mjs origin/main");
    process.exit(2);
  }

  // Resolve repo root: this file lives at <repo>/packages/db/scripts/...
  // so two `dirname` calls up from `packages/db/scripts` give us the repo
  // root regardless of where the script was invoked from.
  const repoRoot = resolve(dirname(__filename), "..", "..", "..");

  let baseSource;
  let headSource;
  try {
    baseSource = execFileSync(
      "git",
      ["show", `${baseRef}:${SCHEMA_REPO_PATH}`],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    console.error(
      `❌ Could not read ${SCHEMA_REPO_PATH} at ${baseRef}: ${err.message.split("\n")[0]}`,
    );
    console.error("   The base ref may not be fetched. Try: git fetch origin main --depth=50");
    process.exit(2);
  }

  try {
    headSource = readFileSync(resolve(repoRoot, SCHEMA_REPO_PATH), "utf8");
  } catch (err) {
    console.error(`❌ Could not read ${SCHEMA_REPO_PATH} from working tree: ${err.message}`);
    process.exit(2);
  }

  const base = parseSchema(baseSource);
  const head = parseSchema(headSource);
  const regressions = diffSchemas(base, head);

  if (regressions.length === 0) {
    console.log("✅ No schema regressions detected.");
    process.exit(0);
  }

  console.error("❌ Schema regression detected.");
  console.error("");
  console.error(
    `The following items were removed from ${SCHEMA_REPO_PATH} since ${baseRef}:`,
  );
  for (const r of regressions) {
    console.error(`  - ${r}`);
  }
  console.error("");
  console.error(
    "Existing model fields, attributes, and enum values must never be removed",
  );
  console.error("in a feature PR. If this came from a stale Build Studio sandbox image,");
  console.error(
    "rebuild the sandbox from a fresh portal image and re-run the build.",
  );
  console.error("");
  console.error(
    "If the regression is intentional (a deliberate field drop), it requires",
  );
  console.error(
    "an explicit migration plan reviewed with the schema steward (AGENTS.md §11).",
  );
  process.exit(1);
}
