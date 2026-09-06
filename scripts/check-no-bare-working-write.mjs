#!/usr/bin/env node
/**
 * BI-4ab6be39 Phase I — CI guard.
 *
 * Ensures new code that writes `status: "working"` to a TaskRun goes through
 * the sanctioned helper at apps/web/lib/observability/heartbeat.ts
 * (markTaskRunWorking) so the lastHeartbeatAt invariant holds and the
 * watchdog can do its job.
 *
 * Scans apps/web/lib for non-test source files containing the bare write,
 * intersects with an allowlist of files that are already known-correct
 * (either they ARE the sanctioned path, or they have a documented reason
 * not to use it). Any file outside the allowlist fails CI with a clear
 * message pointing at the helper.
 *
 * Run: node scripts/check-no-bare-working-write.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, "apps", "web", "lib");

// Files that are allowed to write status: "working" directly. Add a comment
// explaining WHY each entry is here — future contributors deserve context.
const ALLOWLIST = new Set([
  // The sanctioned helper itself — implements heartbeat() and
  // markTaskRunWorking(). All other callers should route through here.
  "apps/web/lib/observability/heartbeat.ts",
  // Spawns proactive reflection TaskRuns in the "working" state at creation
  // time (not a transition from submitted/etc). The downstream agentic loop
  // emits its own heartbeats at iteration boundaries (Phase D1).
  "apps/web/lib/tak/reflection-triggers.ts",
  // Creates bounded, proactive pattern-observer TaskRuns already in "working"
  // state at birth; they complete/fail in the same observer transaction scope.
  "apps/web/lib/tak/pattern-observer/core.ts",
  // Creates periodic pattern-review TaskRuns in "working" at birth and closes
  // them after the synchronous observer pass; this is not a queued transition.
  "apps/web/lib/tak/pattern-observer/periodic-review.ts",
  // Creates scheduled work-pattern profile review TaskRuns in "working" at
  // birth and completes them at the end of the scheduled review.
  "apps/web/lib/tak/work-pattern-profile-review.ts",
  // Creates the Build Studio work-capsule TaskRun envelope in "working" at
  // birth. Build pipeline (Phase D3) heartbeats from the step loop.
  "apps/web/lib/work-capsules/build-studio-attachment.ts",
  // Agent thread dispatcher — transitions a queued TaskRun to working at the
  // moment dispatch starts, in the SAME update that sets startedAt,
  // currentAgentId, AND lastHeartbeatAt. That's the invariant the helper
  // exists to enforce; this file just inlines it because it also needs to
  // set other dispatcher-only fields in the same atomic write.
  "apps/web/lib/actions/agent-thread-dispatcher-runtime.ts",
  // Creates a server-authorized Workroom TaskRun in the "working" state at
  // birth and sets lastHeartbeatAt in that same atomic create before the
  // provider operation can be admitted or dispatched.
  "apps/web/lib/inference/async-operation-workroom-runtime.ts",

  // Writes Workroom.status, not TaskRun.status — a durable maintenance room has
  // no heartbeat and no stall watchdog, so markTaskRunWorking does not apply
  // (BI-ED117C82).
  "apps/web/lib/wiki/embedding-coverage-workroom.ts",]);

const WORKING_WRITE_RE = /status:\s*["']working["']/;

/**
 * BI-3B6DC1DC: only a TASK RUN write is this guard's business.
 *
 * The guard exists so `TaskRun.status = "working"` always lands with
 * `lastHeartbeatAt`, or the stall watchdog false-positives. It used to match
 * the literal anywhere in a file, so a Workroom upsert — a different model,
 * with no heartbeat contract at all — tripped a TaskRun guard and had to be
 * allowlisted. Every such entry makes the allowlist a weaker signal about the
 * thing the guard actually protects.
 *
 * A hit counts only when the same statement touches a taskRun delegate or a
 * TaskRun-shaped identifier. `sliceStatement` keeps that check local: a
 * Workroom write ten lines above a TaskRun write must not launder it.
 */
const TASK_RUN_CONTEXT_RE =
  /\b(taskRun|taskRuns|TaskRun|task_run)\b|\btaskRunId\b/;

/** The statement around an index — bounded by braces, semicolons or blank lines. */
export function sliceStatement(body, index) {
  const start = Math.max(
    body.lastIndexOf("await ", index),
    body.lastIndexOf("\n\n", index),
    body.lastIndexOf(";", index),
  );
  const end = body.indexOf(";", index);
  return body.slice(start === -1 ? 0 : start, end === -1 ? body.length : end + 1);
}

/** Every bare working-write in `body` that belongs to a TaskRun. */
export function findTaskRunWorkingWrites(body) {
  const hits = [];
  const re = new RegExp(WORKING_WRITE_RE.source, "g");
  for (const match of body.matchAll(re)) {
    const statement = sliceStatement(body, match.index ?? 0);
    if (TASK_RUN_CONTEXT_RE.test(statement)) hits.push(statement.trim().slice(0, 200));
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      // Skip common non-source dirs and snapshot fixtures.
      if (entry === "node_modules" || entry === ".next" || entry === "__snapshots__" || entry === "dist") continue;
      yield* walk(full);
    } else if (s.isFile()) {
      // Source files only — skip tests and type-only declarations.
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx") || full.endsWith(".d.ts")) continue;
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
      yield full;
    }
  }
}

const violations = [];

for (const file of walk(SCAN_DIR)) {
  let body;
  try {
    body = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const hits = findTaskRunWorkingWrites(body);
  if (hits.length === 0) continue;

  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (ALLOWLIST.has(rel)) continue;

  violations.push(rel);
}

if (violations.length > 0) {
  console.error("");
  console.error("ERROR: BI-4ab6be39 Phase I — bare `status: \"working\"` writes found outside the allowlist.");
  console.error("");
  console.error("These files write directly to TaskRun.status without setting lastHeartbeatAt:");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Fix: import { markTaskRunWorking } from \"@/lib/observability/heartbeat\" and call");
  console.error("     await markTaskRunWorking(taskRunId) instead of writing { status: \"working\" } inline.");
  console.error("This guarantees lastHeartbeatAt is set atomically so the stall-detection watchdog");
  console.error("doesn't false-positive on the gap between transition and first work.");
  console.error("");
  console.error("If a new file legitimately needs to bypass the helper (e.g. it creates a TaskRun in");
  console.error("the working state at birth rather than transitioning), add it to ALLOWLIST in");
  console.error("scripts/check-no-bare-working-write.mjs with a one-line comment explaining why.");
  console.error("");
  process.exit(1);
}

console.log(`✓ No unsanctioned status:\"working\" writes outside the allowlist (${ALLOWLIST.size} allowed files).`);
