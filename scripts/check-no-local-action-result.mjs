#!/usr/bin/env node
// One ActionResult ratchet — BI-1CED89B9 (Simplify & Strengthen W6,
// architecture pass 2026-08-16 §3.3-a / §4-P1).
//
// apps/web/lib/shared/action-result.ts is the single home of the
// `{ ok: true; data } | { ok: false; error }` server-action result. The pass
// found 9 competing local aliases (three spelling the failure field `message`)
// and ~1,590 hand-inlined `ok: true` sites. The aliases are codemodded away in
// the same PR that adds this guard; the inline sites are frozen as a
// shrink-only TOTAL budget (mass migration is explicitly out of scope — the
// ratchet stops regrowth).
//
// Two checks over apps/web source (auto-discovered by scripts/check-guards.mjs
// — the check-no-* loop — so no ci.yml/package.json wiring):
//
//   1. localAliases — any local declaration of the generic result names:
//        `type ActionResult…` / `interface ActionResult…`
//        `type Result… = …{ ok:` (the discriminated-result shape)
//      outside the canonical module. Expected: ZERO. A domain-named contract
//      with different semantics (e.g. EnvelopeActionResult's reason+httpStatus)
//      is allowed — the guard polices the generic names, which must have
//      exactly one home.
//   2. inlineOkTrueTotal — total `ok: true` object-literal sites. Shrink-only
//      number: growth beyond the baselined total fails; compose ok()/err()
//      from lib/shared/action-result instead.
//
// Baseline: scripts/local-action-result-baseline.json (owner + expiry; an
// expired baseline fails until deliberately re-reviewed).
//
//   node scripts/check-no-local-action-result.mjs            # check (CI)
//   node scripts/check-no-local-action-result.mjs --update   # retighten

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT_PATH), "..");
export const SCAN_DIR = join(REPO_ROOT, "apps", "web");
export const BASELINE_PATH = join(REPO_ROOT, "scripts", "local-action-result-baseline.json");

export const CANONICAL_MODULE = "apps/web/lib/shared/action-result.ts";
export const SCAN_SUBDIRS = ["app", "components", "lib", "hooks"];

// A local claim on the generic result names. `Result` alone is only flagged
// when its body opens a `{ ok:` discriminated shape, so domain types named
// *Result (SkillIngestionResult, MergeResult, …) never match.
export const ALIAS_RES = [
  /^\s*(?:export\s+)?type\s+ActionResult\b/m,
  /^\s*(?:export\s+)?interface\s+ActionResult\b/m,
  /^\s*(?:export\s+)?type\s+Result(?:<[^>\n]*>)?\s*=[^;]{0,120}\{\s*ok\s*:/m,
];

export const OK_TRUE_RE = /\bok:\s*true\b/g;

function isSourceFile(name) {
  return (
    /\.(ts|tsx)$/.test(name) &&
    !/\.(test|spec|stories)\.(ts|tsx)$/.test(name) &&
    !name.endsWith(".d.ts")
  );
}

export function listSourceFiles(scanDir = SCAN_DIR, subdirs = SCAN_SUBDIRS) {
  const acc = [];
  function walk(abs) {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(child);
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        acc.push(relative(REPO_ROOT, child).split("\\").join("/"));
      }
    }
  }
  for (const sub of subdirs) walk(join(scanDir, sub));
  return acc.sort();
}

/** Files (outside the canonical module) declaring a generic result alias. */
export function findLocalAliases(files) {
  const out = [];
  for (const { path, source } of files) {
    if (path === CANONICAL_MODULE) continue;
    if (ALIAS_RES.some((re) => re.test(source))) out.push(path);
  }
  return out.sort();
}

/** Total inline `ok: true` sites outside the canonical module. */
export function countInlineOkTrue(files) {
  let total = 0;
  for (const { path, source } of files) {
    if (path === CANONICAL_MODULE) continue;
    total += (source.match(OK_TRUE_RE) ?? []).length;
  }
  return total;
}

export function validateBaseline(baseline, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const failures = [];
  if (baseline?.version !== 1) failures.push("Baseline version must be 1.");
  if (!baseline?.owner?.trim()) failures.push("Baseline requires an owner.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseline?.expiry ?? "")) {
    failures.push("Baseline requires expiry in YYYY-MM-DD form.");
  } else if (baseline.expiry < today) {
    failures.push(
      `Baseline expired on ${baseline.expiry} — re-review the residual inline sites and deliberately extend the expiry.`,
    );
  }
  if (!Array.isArray(baseline?.localAliases)) failures.push("Baseline localAliases must be an array.");
  if (!Number.isInteger(baseline?.inlineOkTrueTotal) || baseline.inlineOkTrueTotal < 0) {
    failures.push("Baseline inlineOkTrueTotal must be a non-negative integer.");
  }
  return failures;
}

export function runCheck({ files, baseline, today }) {
  const localAliases = findLocalAliases(files);
  const inlineOkTrueTotal = countInlineOkTrue(files);
  const baselineFailures = validateBaseline(baseline, today ? { today } : {});
  if (baselineFailures.length) {
    return { ok: false, baselineFailures, localAliases, inlineOkTrueTotal };
  }
  const baseSet = new Set(baseline.localAliases);
  const newAliases = localAliases.filter((p) => !baseSet.has(p));
  const staleAliases = baseline.localAliases.filter((p) => !localAliases.includes(p));
  const inlineGrowth = inlineOkTrueTotal - baseline.inlineOkTrueTotal;
  return {
    ok: newAliases.length === 0 && inlineGrowth <= 0,
    baselineFailures: [],
    localAliases,
    inlineOkTrueTotal,
    newAliases,
    staleAliases,
    inlineGrowth,
  };
}

function readFiles() {
  return listSourceFiles().map((path) => ({
    path,
    source: readFileSync(join(REPO_ROOT, path), "utf8"),
  }));
}

function main() {
  const files = readFiles();

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
    const baseline = {
      version: 1,
      owner,
      expiry,
      note:
        "One-ActionResult ratchet baseline (BI-1CED89B9). localAliases must stay empty; inlineOkTrueTotal is shrink-only — compose ok()/err() from lib/shared/action-result. Regenerate with: node scripts/check-no-local-action-result.mjs --update",
      localAliases: findLocalAliases(files),
      inlineOkTrueTotal: countInlineOkTrue(files),
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `Wrote local-action-result baseline: ${baseline.localAliases.length} alias file(s), ` +
        `${baseline.inlineOkTrueTotal} inline ok:true sites.`,
    );
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      "Missing/unreadable scripts/local-action-result-baseline.json — run: node scripts/check-no-local-action-result.mjs --update",
    );
    process.exit(1);
  }

  const result = runCheck({ files, baseline });
  if (result.baselineFailures.length) {
    console.error("local-action-result baseline is invalid:");
    for (const f of result.baselineFailures) console.error(`  - ${f}`);
    process.exit(1);
  }

  if (!result.ok) {
    console.error("One-ActionResult ratchet failed (BI-1CED89B9).\n");
    if (result.newAliases.length) {
      console.error("NEW local ActionResult/Result alias declarations (import the canonical");
      console.error("type from @/lib/shared/action-result instead; a genuinely different");
      console.error("contract gets a DOMAIN name, not the generic one):");
      for (const p of result.newAliases) console.error(`  - ${p}`);
      console.error("");
    }
    if (result.inlineGrowth > 0) {
      console.error(
        `Inline ok:true sites grew: ${baseline.inlineOkTrueTotal} -> ${result.inlineOkTrueTotal} ` +
          `(+${result.inlineGrowth}). Compose ok()/err() from @/lib/shared/action-result.`,
      );
      console.error("");
    }
    console.error("Do not expand the baseline without an owned platform-architecture decision.");
    process.exit(1);
  }

  const shrunk = baseline.inlineOkTrueTotal - result.inlineOkTrueTotal;
  if (result.staleAliases.length > 0 || shrunk > 0) {
    console.warn(
      `One-ActionResult debt shrank (${result.staleAliases.length} alias file(s), ${shrunk} inline site(s)) — retighten with --update in this PR.`,
    );
  }
  console.log(
    `One ActionResult OK — ${result.localAliases.length} alias file(s) (budget ${baseline.localAliases.length}), ` +
      `${result.inlineOkTrueTotal} inline ok:true (budget ${baseline.inlineOkTrueTotal}), ` +
      `owner ${baseline.owner}, review by ${baseline.expiry}.`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
