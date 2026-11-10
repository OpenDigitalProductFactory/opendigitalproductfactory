#!/usr/bin/env node
// scripts/check-actuator-inputs-writable.mjs
//
// BI-2624B7EA / BI-9252B9EA / BI-C61CEEA9 — the facts the employment actuator
// refuses to guess must be SETTABLE by an operator.
//
// THE PROBLEM IT FIXES: EP-862820FD shipped an actuator that was correct, fully
// wired, tested end to end — and structurally incapable of ever firing, because
// NEITHER of the two facts it requires had a write path anywhere in the product.
//
//   WorkLocation.jurisdictionSlug     — no UI, no action, no MCP tool
//   EmploymentType.classification     — no UI, no action, no MCP tool
//
// Both columns were deliberately left NULL by their migrations, on the correct
// principle that the platform must not guess a legal fact. The refusal messages
// told the operator to "set the jurisdiction on that location" and to record a
// classification. There was nowhere to do either. So every employment event on
// every install resolved to operator work, permanently, and no Workroom could
// ever open.
//
// Every unit test passed throughout, because a fact the tests supply directly
// looks identical to a fact an operator can supply. Only driving the live
// install surfaced it.
//
// THE INVARIANT: a column the actuator reads, and refuses to default, must have
// at least one production write path. A read-only governed column is a dead end
// dressed as a control.
//
//   node scripts/check-actuator-inputs-writable.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Columns the actuator requires, and the write the operator surface must perform. */
const REQUIRED_INPUTS = [
  {
    label: "WorkLocation.jurisdictionSlug",
    // A write is a Prisma update/create naming the column as a data field.
    writeRe: /jurisdictionSlug\s*:/,
    modelRe: /workLocation\s*\.\s*(update|updateMany|upsert|create)/,
    why: "the co-employment control tells operators to set the jurisdiction on a work location",
  },
  {
    label: "EmploymentType.classification",
    writeRe: /classification\s*:/,
    modelRe: /employmentType\s*\.\s*(update|updateMany|upsert|create)/,
    why: "the actuator resolves a worker's classification from their employment type",
  },
];

const SEARCH_ROOTS = [
  path.join("apps", "web", "lib", "actions"),
  path.join("apps", "web", "lib", "mcp"),
  path.join("apps", "web", "app"),
];
const SKIP_RE = /(\.(test|spec|stories)\.[cm]?[jt]sx?$|__tests__\/|\/generated\/|\.next\/)/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) yield* walk(full);
    else if (/\.[cm]?tsx?$/.test(full)) yield full;
  }
}

const sources = [];
for (const root of SEARCH_ROOTS) {
  for (const file of walk(path.join(REPO_ROOT, root))) {
    const rel = path.relative(REPO_ROOT, file).replaceAll("\\", "/");
    if (SKIP_RE.test(rel)) continue;
    sources.push({ rel, text: readFileSync(file, "utf8") });
  }
}

const missing = [];
for (const input of REQUIRED_INPUTS) {
  const writer = sources.find(
    (s) => input.modelRe.test(s.text) && input.writeRe.test(s.text),
  );
  if (!writer) missing.push(input);
}

if (missing.length > 0) {
  console.error("Employment actuator inputs have no operator write path.\n");
  for (const input of missing) {
    console.error(`  ✗ ${input.label}`);
    console.error(`      ${input.why}, but nothing in the product can set it.`);
  }
  console.error(
    "\nA governed column the actuator refuses to default, and that no operator can\n" +
      "set, makes every employment event resolve to operator work forever. Add a\n" +
      "governed write path (see setWorkLocationJurisdiction in\n" +
      "apps/web/lib/actions/reference-data-admin.ts).\n",
  );
  process.exit(1);
}

console.log("Actuator inputs OK — every fact the actuator requires can be set by an operator.");
