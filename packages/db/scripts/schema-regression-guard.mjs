#!/usr/bin/env node
//
// schema-regression-guard.mjs — detect genuine schema regressions in
// the Prisma schema (packages/db/prisma/schema/ folder, or the legacy
// schema.prisma monolith at older refs) between a base ref and HEAD.
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
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// The canonical schema is a FOLDER of domain files since the B5 Seam C split
// (BI-134DD02F); the monolith path remains readable so the guard can diff a
// base ref that predates the split (transition PRs included).
const SCHEMA_REPO_DIR = "packages/db/prisma/schema";
const LEGACY_SCHEMA_REPO_PATH = "packages/db/prisma/schema.prisma";

/**
 * Read the full schema text at a git ref: the concatenated domain files when
 * the ref has the schema folder, else the legacy schema.prisma monolith.
 */
function readSchemaAtRef(baseRef, { repoRoot, exec = execFileSync }) {
  const opts = { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  let fileList = null;
  try {
    fileList = exec("git", ["ls-tree", "--name-only", `${baseRef}:${SCHEMA_REPO_DIR}`], opts);
  } catch {
    // No schema folder at this ref — fall through to the legacy monolith.
  }
  if (fileList !== null) {
    const names = fileList
      .split("\n")
      .map((name) => name.trim())
      .filter((name) => name.endsWith(".prisma"))
      .sort();
    return names
      .map((name) => exec("git", ["show", `${baseRef}:${SCHEMA_REPO_DIR}/${name}`], opts))
      .join("\n");
  }
  return exec("git", ["show", `${baseRef}:${LEGACY_SCHEMA_REPO_PATH}`], opts);
}

/** Read the full schema text from the working tree (concatenated domain files). */
function readSchemaFromWorkingTree(repoRoot) {
  const dir = resolve(repoRoot, SCHEMA_REPO_DIR);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".prisma"))
    .sort()
    .map((name) => readFileSync(resolve(dir, name), "utf8"))
    .join("\n");
}

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
  // 2026-08-26 BI-947F8703 / DI-31F2D7D10E25: TaxObligationPeriod's sales-shaped
  // component totals move into TaxObligationPeriodComponent rows keyed by a
  // typed TaxPeriodComponentKind, so payroll's employee-withheld and
  // employer-contribution totals share one shape instead of adding two more
  // columns (and the next tax family two more again).
  //
  // DATA SAFETY: the migration INSERTs a component row for every existing
  // period's salesTaxAmount and inputTaxAmount BEFORE the DROP, including
  // recorded zeros, so no filed or draft period loses a figure. netTaxAmount is
  // untouched, so no period's bottom line moves. Migration:
  // 20260826054627_normalize_tax_period_components_and_deposit_schedule.
  // Record: docs/architecture/tax-period-component-migration.md
  // Prune once shipped fleet-wide.
  "TaxObligationPeriod.salesTaxAmount",
  "TaxObligationPeriod.inputTaxAmount",
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
  // 2026-08-07 BI-CC8021CE: FederatedRecordMirror.version / acknowledgedVersion
  // WIDEN Int -> BigInt (the field is KEPT, only its storage type grows). A demand
  // originVersion is a millisecond epoch (~1.7e12) that overflows int4, so demand
  // mirrors never wrote (P2020). The guard keys removals by field name+type, so a
  // type change reads as a removal of the Int-typed signature. Migration:
  // 20260807220000_federated_record_mirror_version_bigint. Prune once shipped
  // fleet-wide.
  "FederatedRecordMirror.version",
  "FederatedRecordMirror.acknowledgedVersion",
  // 2026-08-16 BI-817ED2D4 (Simplify & Strengthen W4, §3.2-a): ten closed-set
  // columns CONVERT String -> typed enum (the field is KEPT, only its type
  // strengthens; same shape as the FederatedRecordMirror widening above — the
  // guard keys removals by field name+type, so a type change reads as a
  // removal of the String-typed signature). Values are preserved byte-for-byte
  // by `USING (col::"Enum")`; per-column data-safety arguments live in
  // migration 20260816110000_closed_set_enum_types_and_direct_conversions.
  // Prune once shipped fleet-wide.
  "BacklogItem.sensitivity",
  "BacklogItem.estimateSource",
  "BacklogItem.demandStage",
  "BacklogItem.demandScoreFramework",
  "BacklogItem.investmentBucket",
  "FeatureBuild.kind",
  "FeatureBuild.disposition",
  "FeatureBuild.uxVerificationStatus",
  "Workroom.decisionScope",
  "Workroom.portfolioRole",
  // 2026-08-22 BI-2C80E6EA / DI-F289DBB51DCB: generic intake evidence
  // now joins its packet by tenant-safe packet identity. Nullable direct
  // patient provenance remains on the rows; consent and coverage deliberately
  // retain their stronger packet+organization+patient relations. Migration:
  // 20260822164000_subject_agnostic_scheduling_and_resources. The reviewed
  // architecture plan owns the cardinality change and hybrid fallback.
  "CareIntakeResponse.packet",
  "CareIntakeResponse.supersedesResponse",
  "CareIntakeAccessGrant.packet",
  "CareIntakeException.packet",
  "CareIntakeStatusEvent.packet",
]);

// Model attributes intentionally removed through a steward-reviewed migration.
// Attribute exceptions are exact normalized lines rather than broad model or
// field exemptions, so allowing one retired index cannot conceal another.
// Prune each entry after the migration has shipped fleet-wide.
export const INTENTIONAL_MODEL_ATTRIBUTE_REMOVALS = new Set([
  // 2026-08-22 BI-2C80E6EA / DI-F289DBB51DCB: the supersession relation now
  // joins by response+organization, so its tenant-safe composite index strictly
  // subsumes the former single-column index. Migration:
  // 20260822164000_subject_agnostic_scheduling_and_resources.
  "CareIntakeResponse.@@index([supersedesResponseId])",
  // 2026-08-22 BI-D2AA1064: OutboundPublication is an immutable event receipt,
  // so create and later update receipts may reference the same remote resource.
  // Current remote-identity uniqueness is enforced by ExternalChannelProjection.
  // Migration: 20260822062000_allow_external_update_receipts.
  "OutboundPublication.@@unique([channelId, externalId])",
]);

// Models intentionally RENAMED via a steward-reviewed change (AGENTS.md §11).
// Each entry maps the old model name to the new one. A logical rename is not a
// regression when the physical table is preserved, so the guard accepts an entry
// ONLY when the new model carries `@@map("<old name>")` — that is what makes the
// rename metadata-only (`prisma migrate diff` stays empty) and rollback cheap.
// Without the @@map the rename IS a table drop and still regresses.
//
// Field lines are compared after substituting renamed model names, so a relation
// whose only change is its referenced type (e.g. `WorkCapsule?` -> `Workroom?`)
// is not reported. Genuine field drops inside a renamed model still regress.
// Prune entries once the rename has shipped to every environment.
export const INTENTIONAL_MODEL_RENAMES = new Map([
  // 2026-08-15 BI-7BE9D81D (EP-WORK-CONVERGENCE): the Workroom is the canonical
  // unit of what we claim and where we work, replacing WorkCapsule
  // (founder-directed). Both models keep @@map to their original tables, so the
  // 285 live rows are untouched and no migration is required.
  ["WorkCapsule", "Workroom"],
  ["WorkCapsuleActivity", "WorkroomActivity"],
]);

// Apply the sanctioned model renames to a schema line so that a relation field
// differing only by its referenced model name compares equal.
//
// `@@map("...")` is deliberately exempt. Its argument is the PHYSICAL TABLE
// name, not a model name, and the whole point of an honoured rename is that the
// new model keeps `@@map("<old model name>")`. Substituting inside it rewrote
// the base's `@@map("WorkCapsule")` into `@@map("Workroom")`, which never
// matches the head, so every renamed model reported its own `@@map` as removed
// — main regressed against itself and blocked any PR touching the schema.
function applyModelRenames(line, renames) {
  if (/^@@map\(/.test(line.trim())) return line;
  let out = line;
  for (const [from, to] of renames) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  return out;
}

export function diffSchemas(
  base,
  head,
  allowlist = INTENTIONAL_FIELD_REMOVALS,
  renames = INTENTIONAL_MODEL_RENAMES,
  attributeAllowlist = INTENTIONAL_MODEL_ATTRIBUTE_REMOVALS,
) {
  const regressions = [];

  // A rename is only honoured when the new model preserves the physical table
  // via @@map("<old name>"); otherwise it is a real table drop.
  const honouredRenames = new Map();
  for (const [from, to] of renames) {
    const headLines = head.models.get(to);
    if (!headLines) continue;
    if (![...headLines].some((l) => l === `@@map("${from}")`)) continue;
    honouredRenames.set(from, to);
  }

  // Models
  for (const [name, baseLines] of base.models) {
    const renamedTo = honouredRenames.get(name);
    if (!head.models.has(name) && !renamedTo) {
      regressions.push(`model ${name} removed entirely`);
      continue;
    }
    const headLines = renamedTo ? head.models.get(renamedTo) : head.models.get(name);
    const label = renamedTo ? `${name} (renamed to ${renamedTo})` : name;
    for (const rawBaseLine of baseLines) {
      const line = applyModelRenames(rawBaseLine, honouredRenames);
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
        if (!parsed && attributeAllowlist.has(`${name}.${line}`)) continue;
        regressions.push(`model ${label}: removed \`${line}\``);
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
    baseSource = readSchemaAtRef(baseRef, { repoRoot });
  } catch (err) {
    console.error(
      `❌ Could not read the Prisma schema at ${baseRef}: ${err.message.split("\n")[0]}`,
    );
    console.error("   The base ref may not be fetched. Try: git fetch origin main --depth=50");
    process.exit(2);
  }

  try {
    headSource = readSchemaFromWorkingTree(repoRoot);
  } catch (err) {
    console.error(`❌ Could not read ${SCHEMA_REPO_DIR} from working tree: ${err.message}`);
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
    `The following items were removed from ${SCHEMA_REPO_DIR} since ${baseRef}:`,
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
