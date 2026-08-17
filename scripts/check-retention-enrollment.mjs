#!/usr/bin/env node
// Retention-enrollment ratchet — BI-873F3C48 (Simplify & Strengthen W3,
// architecture pass 2026-08-16 §3.2-e).
//
// Growth-table heuristic (explicit, so false positives are allowlisted
// DELIBERATELY rather than silently ignored). A Prisma model is
// "growth-shaped" when BOTH hold:
//
//   1. Its name ends in one of: Event, Log, Telemetry, Receipt, Audit,
//      Activity, Metric, Attempt, Observation, History — the append-only
//      naming families the 2026-08-16 architecture pass measured.
//   2. It carries a DateTime column named one of: createdAt, startedAt,
//      occurredAt, recordedAt, detectedAt, calledAt, timestamp — i.e. the
//      sweep would have a time axis to purge by.
//
// Every growth-shaped model must appear (as its camelCase Prisma accessor) in
// exactly one of:
//   • PURGE_POLICIES        (apps/web/lib/operate/retention/policies.ts)
//   • RETAINED_DATASETS     (same file — regulated, never auto-purged)
//   • the allowlist          (scripts/retention-enrollment-allowlist.json) —
//     business records / aggregates the heuristic over-matches, each entry
//     carrying model + reason + owner + expiry. An expired entry fails until
//     re-reviewed and deliberately extended.
//
// The registry is read TEXTUALLY (model: "<accessor>") because this guard runs
// under plain node while policies.ts is TypeScript; the enrollment shape is a
// stable literal in that file by design (single source of truth).
//
//   node scripts/check-retention-enrollment.mjs   # check (CI)

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const SCHEMA_PATH = join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
export const POLICIES_PATH = join(REPO_ROOT, "apps", "web", "lib", "operate", "retention", "policies.ts");
export const ALLOWLIST_PATH = join(REPO_ROOT, "scripts", "retention-enrollment-allowlist.json");

export const GROWTH_NAME_RE =
  /(Event|Log|Telemetry|Receipt|Audit|Activity|Metric|Attempt|Observation|History)$/;
export const TIME_FIELDS = Object.freeze([
  "createdAt",
  "startedAt",
  "occurredAt",
  "recordedAt",
  "detectedAt",
  "calledAt",
  "timestamp",
]);

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Growth-shaped models per the header heuristic. Returns PascalCase names. */
export function findGrowthModels(schemaSource) {
  const models = [];
  const modelRe = /^model\s+(\w+)\s+\{([\s\S]*?)^\}/gm;
  let match;
  while ((match = modelRe.exec(schemaSource))) {
    const [, name, body] = match;
    if (!GROWTH_NAME_RE.test(name)) continue;
    const hasTimeAxis = TIME_FIELDS.some((tf) =>
      new RegExp(`^\\s*${tf}\\s+DateTime\\b`, "m").test(body),
    );
    if (hasTimeAxis) models.push(name);
  }
  return models.sort();
}

/** All `model: "<accessor>"` literals in the retention registry source. */
export function extractEnrolledModels(policiesSource) {
  const enrolled = new Set();
  for (const m of policiesSource.matchAll(/\bmodel:\s*"([A-Za-z0-9]+)"/g)) {
    enrolled.add(m[1]);
  }
  return enrolled;
}

export function validateAllowlist(allowlist, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  if (allowlist?.version !== 1) failures.push("Allowlist version must be 1.");
  if (!Array.isArray(allowlist?.entries)) {
    failures.push("Allowlist entries must be an array.");
    return failures;
  }
  const seen = new Set();
  for (const entry of allowlist.entries) {
    const id = entry?.model ?? "<missing>";
    if (!entry?.model?.trim()) failures.push("Every allowlist entry requires a model.");
    else if (seen.has(entry.model)) failures.push(`Duplicate allowlist model ${entry.model}.`);
    else seen.add(entry.model);
    if (!entry?.reason?.trim()) failures.push(`Allowlist entry ${id} requires a reason.`);
    if (!entry?.owner?.trim()) failures.push(`Allowlist entry ${id} requires an owner.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry?.expiry ?? "")) {
      failures.push(`Allowlist entry ${id} requires expiry in YYYY-MM-DD form.`);
    } else if (entry.expiry < today) {
      failures.push(
        `Allowlist entry ${id} expired on ${entry.expiry} — re-review and deliberately extend.`,
      );
    }
  }
  return failures;
}

export function runCheck({ schemaSource, policiesSource, allowlist, today }) {
  const allowlistFailures = validateAllowlist(allowlist, today ? { today } : {});
  const growthModels = findGrowthModels(schemaSource);
  const enrolled = extractEnrolledModels(policiesSource);
  const allowlisted = new Set((allowlist?.entries ?? []).map((e) => e.model));

  const unenrolled = growthModels.filter(
    (name) => !enrolled.has(lowerFirst(name)) && !allowlisted.has(name),
  );
  const staleAllowlist = [...allowlisted]
    .filter((name) => !growthModels.includes(name) || enrolled.has(lowerFirst(name)))
    .sort();

  return {
    ok: allowlistFailures.length === 0 && unenrolled.length === 0,
    allowlistFailures,
    growthModels,
    unenrolled,
    staleAllowlist,
  };
}

function main() {
  const schemaSource = readFileSync(SCHEMA_PATH, "utf8");
  const policiesSource = readFileSync(POLICIES_PATH, "utf8");
  let allowlist;
  try {
    allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/retention-enrollment-allowlist.json — every growth-shaped model must be enrolled or deliberately allowlisted.",
    );
    process.exit(1);
  }

  const result = runCheck({ schemaSource, policiesSource, allowlist });

  if (result.allowlistFailures.length) {
    console.error("Retention-enrollment allowlist is invalid:");
    for (const f of result.allowlistFailures) console.error(`  - ${f}`);
    process.exit(1);
  }
  if (result.unenrolled.length) {
    console.error("Retention-enrollment guard failed (BI-873F3C48) — growth-shaped models in");
    console.error("neither PURGE_POLICIES, RETAINED_DATASETS, nor the allowlist:");
    for (const name of result.unenrolled) console.error(`  - ${name}`);
    console.error("");
    console.error("Enroll each in apps/web/lib/operate/retention/policies.ts (purge for");
    console.error("telemetry/log/event data with a leading time-column index; RETAINED for");
    console.error("regulated/financial/consent records), or add a deliberate allowlist entry");
    console.error("(model + reason + owner + expiry) in scripts/retention-enrollment-allowlist.json.");
    process.exit(1);
  }
  if (result.staleAllowlist.length) {
    console.warn(
      `Retention allowlist has ${result.staleAllowlist.length} stale entr(y/ies) (model enrolled or no longer growth-shaped) — remove:`,
    );
    for (const name of result.staleAllowlist) console.warn(`  - ${name}`);
  }
  console.log(
    `Retention enrollment OK — ${result.growthModels.length} growth-shaped models, all enrolled or allowlisted ` +
      `(${(allowlist.entries ?? []).length} allowlisted).`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
