import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// V8 old-space ceiling for the Next.js production build. Overridable via env so
// the CI heap can be tuned from the workflow (per BI-6540EB2B) WITHOUT a code
// change. Why it matters: on a 16 GB hosted runner an 8 GB old-space limit plus
// RSS overhead plus Next's build workers can approach physical RAM. When the OS
// reaps the process the job dies with a SIGTERM "runner received a shutdown
// signal" and the PR is silently ejected from the merge queue while still
// reporting mergeStateStatus: CLEAN. Lowering this ceiling makes an oversized
// build fail as a clean V8 "heap out of memory" (attributable, re-run-safe)
// instead of a runner death.
const maxOldSpaceMb =
  Number.parseInt(process.env.DPF_BUILD_MAX_OLD_SPACE_MB ?? "", 10) || 8192;

// Retries are applied ONLY when the build child is killed by a signal (OOM /
// runner preemption) — never on a real build error, which must fail fast so a
// broken PR is not masked and the 45m job budget is not doubled. Default 1.
const parsedRetries = Number.parseInt(process.env.DPF_BUILD_SIGNAL_RETRIES ?? "", 10);
const maxSignalRetries =
  Number.isFinite(parsedRetries) && parsedRetries >= 0 ? parsedRetries : 1;

/**
 * Decide what to do with a spawnSync result. Pure and exported so the
 * retry/attribution policy is unit-testable without running a real build.
 *
 * @param {{error?: Error, status?: number|null, signal?: string|null}} result
 * @param {{attempt: number, maxRetries: number}} ctx  attempt is 0-based.
 * @returns {{action: "ok"|"retry"|"fail", code: number, signal?: string, reason?: string}}
 */
export function interpretBuildResult(result, { attempt, maxRetries }) {
  if (result.error) {
    return { action: "fail", code: 1, reason: `spawn error: ${result.error.message}` };
  }
  if (result.signal) {
    // Signal death == the OS/runner killed the process (OOM or preemption),
    // NOT a source-level build failure. Retry while attempts remain.
    const canRetry = attempt < maxRetries;
    return {
      action: canRetry ? "retry" : "fail",
      code: 137, // conventional 128+SIGKILL; marks an infra/OOM death, not exit 1
      signal: result.signal,
      reason: `child terminated by signal ${result.signal} (likely runner OOM/preemption, not a source error)`,
    };
  }
  const status = result.status ?? 0;
  return status === 0
    ? { action: "ok", code: 0 }
    : { action: "fail", code: status, reason: `build exited with status ${status}` };
}

function runOnce() {
  // Resolved lazily (not at import time) so tests can import the policy above
  // without `next` being installed in the worktree.
  const nextBin = require.resolve("next/dist/bin/next");
  return spawnSync(
    process.execPath,
    [`--max-old-space-size=${maxOldSpaceMb}`, nextBin, "build", ...process.argv.slice(2)],
    { env: process.env, stdio: "inherit" },
  );
}

function main() {
  for (let attempt = 0; ; attempt += 1) {
    const decision = interpretBuildResult(runOnce(), {
      attempt,
      maxRetries: maxSignalRetries,
    });

    if (decision.action === "ok") process.exit(0);

    if (decision.action === "retry") {
      console.error(
        `[production-build] ${decision.reason}; retrying (attempt ${attempt + 2}/${maxSignalRetries + 1})`,
      );
      continue;
    }

    // action === "fail"
    if (decision.signal) {
      console.error(
        `[production-build] FATAL: ${decision.reason}; exhausted ${maxSignalRetries} ` +
          `retr${maxSignalRetries === 1 ? "y" : "ies"}. This is infrastructure (memory/` +
          `preemption), not a code failure — re-run the job, or lower DPF_BUILD_MAX_OLD_SPACE_MB ` +
          `(currently ${maxOldSpaceMb}) / raise the runner size.`,
      );
    } else if (decision.reason) {
      console.error(`[production-build] ${decision.reason}`);
    }
    process.exit(decision.code);
  }
}

// Only drive the build when executed directly; importing for tests must not run it.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
