#!/usr/bin/env node
// Unattributable-deferral guard — BI-9DA5F179.
//
// A backlog item written to status="deferred" without a reason, trigger, review
// date and accountable owner is not parked. It is gone: no trigger fires, no
// review comes due, nobody owns the next decision, and it reads as handled while
// being unreachable from every sweep that would surface it.
//
// This is not hypothetical. escalate-build-to-human.ts wrote
//
//     data: { status: "deferred", activeBuildId: null, updatedAt: now }
//
// and by 2026-09-01 seven items sat deferred with all four fields null and zero
// status_change activity rows — including BI-F0715C9C, the item tracking the
// readiness deadlock. A backlog cleanup that drove those buckets to zero on
// 2026-08-30 was fully undone within two days, because cleaning the rows does
// nothing while a write path keeps producing them.
//
// The governed MCP path already validates deferrals (normalizeDeferralInput in
// apps/web/lib/backlog/deferral-contract.ts). This guard stops a direct Prisma
// write from going around it.
//
// SCOPE: runtime code — apps/web and packages/<pkg>/src. One-off maintenance
// scripts under packages/<pkg>/scripts are excluded: they are run by hand
// against a named epic, are not a recurrence path, and rewriting historical
// one-offs to carry an owner principal buys nothing.
//
// PASSES when the deferred write also carries `deferReason`, or spreads a
// deferral projection (any `...somethingDefer...`), which is how the governed
// action composes it.
//
//   node scripts/check-no-unattributable-deferral.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** How many lines around the `status:` line count as the same write. 24, not
 *  12: the work-sync mirror built its `data` object 19 lines above the upsert
 *  that consumed it, and the guard read the two as unrelated. */
const WINDOW = 24;

const SCOPE_RE = /^(apps\/web\/.*|packages\/[^/]+\/src\/.*)\.tsx?$/;
const TEST_RE = /\.(test|spec)\.tsx?$/;
const DEFERRED_RE = /status:\s*["']deferred["']/;
// A status copied through from another record — `status: item.status`,
// `status: input.status`, `status: row.status`. This is the second class the
// guard exists for (BI-9DA5F179, 2026-09-02): the same-organization work-sync
// mirror copied a peer's `deferred` verbatim and parked 18 items with nothing
// attached, and no literal "deferred" appeared anywhere in the file. A
// pass-through status can be `deferred` at runtime, so it must carry (or
// spread) the deferral exactly as a literal write must.
const PASSTHROUGH_STATUS_RE = /\bstatus:\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.status\b/;
// A BacklogItem write, as opposed to a return value or a `where` filter that
// merely mentions the same string.
const BACKLOG_WRITE_RE = /backlogItem\s*\.\s*(update|updateMany|create|createMany|upsert)/i;
const ATTRIBUTED_RE = /deferReason|\.\.\.\s*\w*[Dd]efer\w*/;
// A `payload: { ..., status: x.status }` line is a JSON snapshot column on a
// provenance row (FederatedRecordMirror), not the BacklogItem's own status.
const SNAPSHOT_LINE_RE = /\bpayload\s*:\s*\{/;

export function findUnattributableDeferrals(path, text) {
  const lines = text.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, index) => {
    const literal = DEFERRED_RE.test(line);
    const passthrough = !literal && PASSTHROUGH_STATUS_RE.test(line) && !SNAPSHOT_LINE_RE.test(line);
    if (!literal && !passthrough) return;
    const from = Math.max(0, index - WINDOW);
    const to = Math.min(lines.length, index + WINDOW + 1);
    const window = lines.slice(from, to).join("\n");
    if (!BACKLOG_WRITE_RE.test(window)) return; // not a BacklogItem write
    if (ATTRIBUTED_RE.test(window)) return; // carries or spreads the deferral
    hits.push({ path, line: index + 1, text: line.trim(), kind: literal ? "literal" : "passthrough" });
  });
  return hits;
}

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((p) => SCOPE_RE.test(p) && !TEST_RE.test(p));
}

function main() {
  const violations = trackedFiles().flatMap((path) => {
    let text;
    try {
      text = readFileSync(join(REPO_ROOT, path), "utf8");
    } catch {
      return [];
    }
    return findUnattributableDeferrals(path, text);
  });

  if (violations.length === 0) {
    console.log("[unattributable-deferral] No backlog item is parked without a reason, trigger, review date and owner. OK.");
    return;
  }

  console.error("[unattributable-deferral] FAILED — a backlog item is written to \"deferred\" without an attributable deferral.");
  for (const v of violations) {
    console.error(`  - ${v.path}:${v.line}  ${v.text}`);
  }
  console.error("");
  console.error("A deferral with no reason, trigger, review date or owner is not a park — nothing");
  console.error("fires, nothing comes due, and the item reads as handled while being unreachable.");
  console.error("Compose it through normalizeDeferralInput (apps/web/lib/backlog/deferral-contract.ts)");
  console.error("and spread the result, as the governed backlog action does. Record a status_change");
  console.error("activity on the ITEM too, not only on the build or job that parked it. (BI-9DA5F179)");
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
