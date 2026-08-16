#!/usr/bin/env node
// FK index-coverage ratchet — BI-640B011D (Simplify & Strengthen W2,
// architecture pass 2026-08-16 §3.2-b).
//
// Two budgets over packages/db/prisma/schema.prisma, frozen in a baseline the
// same way scripts/check-application-boundaries.mjs freezes owned exceptions
// and scripts/check-module-size.mjs freezes oversized files:
//
//   1. fkMissingIndex — DECLARED Prisma relations (@relation(fields: [...]))
//      whose FK column(s) are not the leading column(s) of any index on the
//      model (@@index / @@unique / @@id, or field-level @id / @unique). These
//      are NOT mechanically indexed (operator rule: every index needs a query
//      path — see docs/superpowers/plans/2026-08-16-hot-table-index-prune-proposal.md);
//      the baseline may only shrink.
//   2. unbackedIdColumns — bare FK-shaped `*Id` scalar columns with no declared
//      relation. Heuristic: String/Int/BigInt field named `*Id`, not the row's
//      primary key, not the model's own semantic identity key
//      (`<modelName>Id @unique`, e.g. Epic.epicId), and not used by any
//      @relation on the model.
//
// A NEW entry beyond the baseline fails; a shrink passes and reports so the
// author retightens with --update in the same PR. The baseline carries an
// owner and an expiry date — an expired baseline fails until it is re-reviewed
// and deliberately extended.
//
//   node scripts/check-fk-index-coverage.mjs            # check (CI)
//   node scripts/check-fk-index-coverage.mjs --update   # retighten the baseline

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const SCHEMA_PATH = join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
export const BASELINE_PATH = join(REPO_ROOT, "scripts", "fk-index-coverage-baseline.json");

const SCALAR_FK_TYPES = new Set(["String", "Int", "BigInt"]);

/** Parse schema.prisma into a minimal structural model list. */
export function parsePrismaModels(source) {
  const models = [];
  const modelRe = /^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = modelRe.exec(source))) {
    const [, name, body] = match;
    const fields = [];
    const relations = [];
    const indexes = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      const idx = line.match(/^@@(?:index|unique|id)\(\[([^\]]+)\]/);
      if (idx) {
        indexes.push(idx[1].split(",").map((c) => c.trim().split("(")[0]));
        continue;
      }
      if (line.startsWith("@@")) continue;
      const field = line.match(/^(\w+)\s+([A-Za-z_]\w*)((?:\[\])?\??)\s*(.*)$/);
      if (!field) continue;
      const [, fieldName, fieldType, , attrs] = field;
      fields.push({ name: fieldName, type: fieldType, attrs });
      if (/@id\b/.test(attrs) || /@unique\b/.test(attrs)) indexes.push([fieldName]);
      const rel = attrs.match(/@relation\(([^)]*)\)/);
      if (rel) {
        const fk = rel[1].match(/fields:\s*\[([^\]]+)\]/);
        if (fk) {
          relations.push({
            targetModel: fieldType,
            fkFields: fk[1].split(",").map((c) => c.trim()),
          });
        }
      }
    }
    models.push({ name, fields, relations, indexes });
  }
  return models;
}

function hasLeadingIndex(model, fkFields) {
  const want = new Set(fkFields);
  return model.indexes.some((cols) => {
    if (cols.length < fkFields.length) return false;
    return cols.slice(0, fkFields.length).every((c) => want.has(c));
  });
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Declared FK relations whose columns lead no index. Keys: `Model.colA+colB`. */
export function computeFkIndexMisses(models) {
  const misses = [];
  for (const model of models) {
    for (const rel of model.relations) {
      if (!hasLeadingIndex(model, rel.fkFields)) {
        misses.push(`${model.name}.${rel.fkFields.join("+")}`);
      }
    }
  }
  return misses.sort();
}

/** Bare FK-shaped `*Id` columns with no declared relation. Keys: `Model.col`. */
export function computeUnbackedIdColumns(models) {
  const out = [];
  for (const model of models) {
    const relationCols = new Set(model.relations.flatMap((r) => r.fkFields));
    const identityKey = `${lowerFirst(model.name)}Id`;
    for (const field of model.fields) {
      if (!/Id$/.test(field.name) || field.name === "id") continue;
      if (!SCALAR_FK_TYPES.has(field.type)) continue;
      if (/@id\b/.test(field.attrs)) continue;
      if (field.name === identityKey && /@unique\b/.test(field.attrs)) continue;
      if (relationCols.has(field.name)) continue;
      out.push(`${model.name}.${field.name}`);
    }
  }
  return out.sort();
}

export function validateBaseline(baseline, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  if (baseline?.version !== 1) failures.push("Baseline version must be 1.");
  if (!baseline?.owner?.trim()) failures.push("Baseline requires an owner.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline?.expiry ?? "")) {
    failures.push("Baseline requires expiry in YYYY-MM-DD form.");
  } else if (baseline.expiry < today) {
    failures.push(
      `Baseline expired on ${baseline.expiry} — re-review the budgets and deliberately extend the expiry.`,
    );
  }
  for (const key of ["fkMissingIndex", "unbackedIdColumns"]) {
    if (!Array.isArray(baseline?.[key])) failures.push(`Baseline ${key} must be an array.`);
  }
  return failures;
}

/** Ratchet evaluation: new entries fail; disappeared entries are stale (pass + report). */
export function evaluateBudget(current, baselined) {
  const baseSet = new Set(baselined);
  const currentSet = new Set(current);
  return {
    newMisses: current.filter((k) => !baseSet.has(k)),
    stale: baselined.filter((k) => !currentSet.has(k)),
  };
}

export function runCheck({ schemaSource, baseline, today }) {
  const models = parsePrismaModels(schemaSource);
  const fkMissingIndex = computeFkIndexMisses(models);
  const unbackedIdColumns = computeUnbackedIdColumns(models);
  const baselineFailures = validateBaseline(baseline, today ? { today } : {});
  if (baselineFailures.length) {
    return { ok: false, baselineFailures, fkMissingIndex, unbackedIdColumns };
  }
  const fk = evaluateBudget(fkMissingIndex, baseline.fkMissingIndex);
  const unbacked = evaluateBudget(unbackedIdColumns, baseline.unbackedIdColumns);
  return {
    ok: fk.newMisses.length === 0 && unbacked.newMisses.length === 0,
    baselineFailures: [],
    fkMissingIndex,
    unbackedIdColumns,
    fk,
    unbacked,
  };
}

function main() {
  const schemaSource = readFileSync(SCHEMA_PATH, "utf8");

  if (process.argv.includes("--update")) {
    let owner = "platform-architecture";
    let expiry = "2026-11-16";
    try {
      const existing = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
      owner = existing.owner ?? owner;
      expiry = existing.expiry ?? expiry;
    } catch {
      // first write — defaults above
    }
    const models = parsePrismaModels(schemaSource);
    const baseline = {
      version: 1,
      owner,
      expiry,
      note:
        "FK index-coverage ratchet baseline (BI-640B011D). Shrink-only: indexes are added per query path, never mechanically. Regenerate with: node scripts/check-fk-index-coverage.mjs --update",
      fkMissingIndex: computeFkIndexMisses(models),
      unbackedIdColumns: computeUnbackedIdColumns(models),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Wrote FK index-coverage baseline: ${baseline.fkMissingIndex.length} FK-without-leading-index, ` +
        `${baseline.unbackedIdColumns.length} unbacked *Id columns.`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/fk-index-coverage-baseline.json — run: node scripts/check-fk-index-coverage.mjs --update",
    );
    process.exit(1);
  }

  const result = runCheck({ schemaSource, baseline });
  if (result.baselineFailures.length) {
    console.error("FK index-coverage baseline is invalid:");
    for (const f of result.baselineFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error("FK index-coverage ratchet failed (BI-640B011D).\n");
    if (result.fk.newMisses.length) {
      console.error("NEW declared-FK relations without a leading index (add a justified index");
      console.error("with a query-path citation, or add the index in the same migration):");
      for (const k of result.fk.newMisses) console.error(`  - ${k}`);
      console.error("");
    }
    if (result.unbacked.newMisses.length) {
      console.error("NEW bare FK-shaped *Id columns with no declared relation (declare a real");
      console.error("@relation — NOT VALID in the migration if legacy rows may be orphaned):");
      for (const k of result.unbacked.newMisses) console.error(`  - ${k}`);
      console.error("");
    }
    console.error("Do not expand the baseline without an owned data-architecture decision.");
    process.exit(1);
  }

  const staleTotal = result.fk.stale.length + result.unbacked.stale.length;
  if (staleTotal > 0) {
    console.warn(
      `FK index-coverage debt shrank by ${staleTotal} — retighten the baseline in this PR with --update:`,
    );
    for (const k of [...result.fk.stale, ...result.unbacked.stale]) console.warn(`  - ${k}`);
  }
  console.log(
    `FK index coverage OK — ${result.fkMissingIndex.length} FK-without-leading-index ` +
      `(budget ${baseline.fkMissingIndex.length}), ${result.unbackedIdColumns.length} unbacked *Id ` +
      `(budget ${baseline.unbackedIdColumns.length}), owner ${baseline.owner}, review by ${baseline.expiry}.`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
