// BI-42FA7DD8 / BI-99395B29 — PRIMARY, platform-owned worktree reaper.
//
// This portal Inngest job OWNS worktree reaping on every install. It runs
// server-side whether or not any AI client is installed, connected or ending its
// session cleanly — `platform-function-never-depends-on-a-client`. Many clients
// and threads share one install; none of them owns its upkeep.
//
// ACCELERATORS (never owners; the guarantee holds with all of them absent):
//   * pull-request-merged-reap.ts — server-side, reaps the one merged branch
//     on the merge event instead of waiting for the daily sweep.
//   * packages/dpf-skill-pack/hooks/worktree-session-hygiene.mjs — client
//     SessionEnd hook; may reap THIS session's Tier-A tree sooner. A client
//     that lacks the hook, crashes or never ends loses nothing.
//
// Spec: docs/superpowers/specs/2026-07-26-multi-client-governance-parity-design.md § D4
// Kernel: platform-function-never-depends-on-a-client, worktree-selection-and-reaping,
//         destructive-actions-require-explicit-go
//
// SAFETY DOCTRINE
//   * Default OFF (DPF_WORKTREE_JANITOR_ENABLED not set) — no scan.
//   * ENABLED without AUTO_REAP: observe, plus the bounded Tier-A reap above
//     DPF_WORKTREE_JANITOR_MAX.
//   * AUTO_REAP=1: live **Tier A only**. Tier B is never auto-deleted here.
//   * FAIL CLOSED: every live run is preceded by an observation. A blind
//     observation reports UNHEALTHY; an observation that kept anything because
//     liveness was unreadable stays an observation. No flag reaps on a guess.
//   * Removals use junction-safe-worktree-remove.mjs via the CLI.

import { cron } from "@/lib/jobs/triggers";
import { jobs } from "@/lib/jobs";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { resolveManagedScriptPath } from "@/lib/operate/backups/managed-script-path";

/** Master switch: run the scan at all (default OFF). */
export const WORKTREE_JANITOR_ENABLED_FLAG = "DPF_WORKTREE_JANITOR_ENABLED";

/**
 * Live Tier-A reaping. Only honored when ENABLED is also set.
 * Default OFF — soak with dry-run first.
 */
export const WORKTREE_JANITOR_AUTO_REAP_FLAG = "DPF_WORKTREE_JANITOR_AUTO_REAP";

/**
 * Upper bound on retained worktrees, above which Tier-A reaping runs WITHOUT a
 * human decision. This is the operative half of
 * `platform-function-never-depends-on-a-client`: a default that requires a
 * technical action from a non-technical owner is not a safe default, it is a
 * deferred outage.
 *
 * Bounded rather than absolute — the excess is reaped oldest-first, and only
 * Tier A, which `classifyWorktree` already defines as merged, clean, unpinned,
 * without an open PR and without a live session heartbeat. Tier B and anything
 * unmerged or unpushed keep explicit-go; that constraint is load-bearing, since
 * a sweep of the development install found ~137 branches with commits never
 * pushed and one abandoned worktree holding a finished, signed, tested commit.
 */
export const WORKTREE_JANITOR_MAX_FLAG = "DPF_WORKTREE_JANITOR_MAX";

/** Generous enough that ordinary concurrent work never trips it; far below the
 *  193 observed when nothing reaped at all. */
export const DEFAULT_MAX_WORKTREES = 40;

export function resolveMaxWorktrees(env: Record<string, string | undefined>): number {
  const raw = (env[WORKTREE_JANITOR_MAX_FLAG] ?? "").trim();
  if (raw.length === 0) return DEFAULT_MAX_WORKTREES;
  const parsed = Number.parseInt(raw, 10);
  // A malformed bound must not silently disable the bound.
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_WORKTREES;
}

const JANITOR_SCRIPT = "worktree-janitor.mjs";
const SCAN_TIMEOUT_MS = 300_000;
const SCAN_MAX_BUFFER = 8 * 1024 * 1024;

export type WorktreeJanitorDecision = {
  path: string;
  branch: string | null;
  verdict: string;
  reason: string;
  tier: string | null;
};

export type WorktreeJanitorScan = {
  mode: string;
  available: boolean;
  root?: string;
  graceDays?: number;
  policy?: string;
  decisions?: WorktreeJanitorDecision[];
  summary?: {
    counts: Record<string, number>;
    tierAPaths: string[];
    tierBPaths: string[];
  };
  error?: string;
  removals?: Array<{ path: string; worktreeRemoved?: boolean; branchDeleted?: boolean }>;
};

export type ScanOutcome =
  | { available: true; scan: WorktreeJanitorScan }
  | { available: false; reason: string };

export type RunResult =
  | { skipped: true; reason: string }
  /**
   * Enabled, scheduled, and unable to see what it is responsible for. This is
   * NOT a skip: a backstop that cannot reach its subject must never report
   * success. Returning `skipped` here is how 528 GB accumulated behind a job
   * that ran on time and found nothing (BI-99395B29).
   */
  | { skipped: false; healthy: false; reason: string }
  | {
      skipped: false;
      mode: "dry-run" | "live";
      root: string | null;
      tierA: number;
      tierB: number;
      keep: number;
      tierAPaths: string[];
      tierBPaths: string[];
      removed: number;
    };

export type RunOptions = {
  env?: Record<string, string | undefined>;
  runScan?: (mode: "dry-run" | "live") => Promise<ScanOutcome>;
};

/**
 * Args for observe (dry-run). Must never include --live.
 * Exported for the regression tripwire test.
 */
export const OBSERVE_ARGS: readonly string[] = Object.freeze([
  "--json",
  "--dry-run",
  "--tier-a-only",
]);

/**
 * Args for auto-reap. Tier-A only — never reaps Tier B stale unmerged.
 */
export const AUTO_REAP_ARGS: readonly string[] = Object.freeze([
  "--json",
  "--live",
  "--tier-a-only",
]);

export function assertNoSilentLiveInObserve(args: readonly string[]): void {
  if (args.includes("--live") || args.includes("--apply")) {
    throw new Error(
      `[worktree-janitor] OBSERVE_ARGS must not include live reaping flags; found ${JSON.stringify(args)}`,
    );
  }
}
assertNoSilentLiveInObserve(OBSERVE_ARGS);

export function assertAutoReapIsTierAOnly(args: readonly string[]): void {
  if (!args.includes("--tier-a-only")) {
    throw new Error("[worktree-janitor] AUTO_REAP_ARGS must include --tier-a-only");
  }
  if (!args.includes("--live")) {
    throw new Error("[worktree-janitor] AUTO_REAP_ARGS must include --live");
  }
}
assertAutoReapIsTierAOnly(AUTO_REAP_ARGS);

async function defaultRunScan(mode: "dry-run" | "live"): Promise<ScanOutcome> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const scriptPath = resolveManagedScriptPath(JANITOR_SCRIPT);
  const cliArgs = mode === "live" ? [...AUTO_REAP_ARGS] : [...OBSERVE_ARGS];

  try {
    const { stdout } = await execFileAsync("node", [scriptPath, ...cliArgs], {
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: SCAN_MAX_BUFFER,
      env: {
        ...process.env,
        // Prefer host install mount inside the portal container when present.
        DPF_REPO_ROOT: process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT || "/host-dpf",
      },
    });
    const scan = JSON.parse(stdout) as WorktreeJanitorScan;
    if (scan.available === false) {
      return { available: false, reason: scan.error || "janitor reported unavailable" };
    }
    return { available: true, scan };
  } catch (err) {
    const e = err as { stderr?: string; message?: string; stdout?: string };
    // CLI may print JSON even on soft failures via stdout in some shells.
    if (e.stdout) {
      try {
        const scan = JSON.parse(e.stdout) as WorktreeJanitorScan;
        if (scan.available === false) {
          return { available: false, reason: scan.error || "janitor unavailable" };
        }
        return { available: true, scan };
      } catch {
        // fall through
      }
    }
    const reason = (e.stderr || e.message || String(err)).toString().trim().slice(0, 500);
    return { available: false, reason };
  }
}

/**
 * Worktrees this install is holding on to. Counts every decision the scan
 * returned rather than only the reapable ones: the bound is about how much is
 * accumulating, not about how much happens to be safe to delete right now.
 */
/**
 * Did this scan keep anything only because it could not read the Workroom claim
 * record? If so its liveness picture is incomplete and no bound may act on it.
 */
export function scanKeptForUnknownLiveness(scan: WorktreeJanitorScan): boolean {
  return (scan.decisions ?? []).some(
    (d) => d.verdict === "KEEP" && /absent evidence|unreadable/i.test(d.reason ?? ""),
  );
}

export function countRetained(scan: WorktreeJanitorScan): number {
  // An EMPTY decisions array is "not populated", not "zero worktrees" — a scan
  // may report only a summary. Reading empty as zero would put the install
  // permanently under any bound, which is the same silent-success failure this
  // whole change exists to remove.
  if (Array.isArray(scan.decisions) && scan.decisions.length > 0) {
    return scan.decisions.length;
  }
  const counts = scan.summary?.counts ?? {};
  return Object.values(counts).reduce((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
}

/** A backstop that cannot reach its subject reports UNHEALTHY, never success. */
function unhealthy(reason: string): RunResult {
  console.error(
    `[worktree-janitor] UNHEALTHY — enabled but cannot see its worktree base: ${reason}. ` +
      "Nothing was scanned, so nothing being found is not evidence that nothing is there.",
  );
  return { skipped: false, healthy: false, reason };
}

/** Shared reporting for both the observation and the live run. */
function summarize(scan: WorktreeJanitorScan, mode: "dry-run" | "live"): RunResult {
  if (mode === "dry-run" && scan.mode !== "dry-run") {
    console.error(
      `[worktree-janitor] REFUSING unexpected scan mode "${scan.mode}" for observe run`,
    );
    return { skipped: true, reason: `unexpected scan mode "${scan.mode}"` };
  }

  const counts = scan.summary?.counts ?? {};
  const tierAPaths = scan.summary?.tierAPaths ?? [];
  const tierBPaths = scan.summary?.tierBPaths ?? [];

  for (const p of tierAPaths) {
    console.warn(
      `[worktree-janitor] ${mode === "live" ? "REAP" : "WOULD-REAP"} Tier-A ${p} [mode=${mode}]`,
    );
  }
  for (const p of tierBPaths) {
    console.warn(
      `[worktree-janitor] WOULD-REAP Tier-B (observe only) ${p} — never auto-deleted by schedule`,
    );
  }

  const removed =
    mode === "live"
      ? (scan.removals ?? []).filter((r) => r.worktreeRemoved).length
      : 0;

  const result = {
    skipped: false as const,
    mode,
    root: scan.root ?? null,
    tierA: counts.PRUNE_TIER_A ?? tierAPaths.length,
    tierB: counts.PRUNE_TIER_B ?? tierBPaths.length,
    keep: counts.KEEP ?? 0,
    tierAPaths,
    tierBPaths,
    removed,
  };

  console.warn(`[worktree-janitor] summary: ${JSON.stringify(result)}`);
  return result;
}

export async function runWorktreeJanitor(options: RunOptions = {}): Promise<RunResult> {
  const env = options.env ?? process.env;

  if (!envFlagEnabled(env, WORKTREE_JANITOR_ENABLED_FLAG)) {
    return {
      skipped: true,
      reason: `disabled (${WORKTREE_JANITOR_ENABLED_FLAG} not set)`,
    };
  }

  const explicitAutoReap =
    envFlagEnabled(env, WORKTREE_JANITOR_AUTO_REAP_FLAG) &&
    envFlagEnabled(env, WORKTREE_JANITOR_ENABLED_FLAG);

  const runScan = options.runScan ?? defaultRunScan;

  // Observe first, always. AUTO_REAP is the owner's standing go for Tier A,
  // not a go to act on evidence this run could not gather, so it fails closed
  // through the same observation the bound uses.
  const observed = await runScan("dry-run");
  if (!observed.available) return unhealthy(observed.reason);

  if (explicitAutoReap) {
    if (scanKeptForUnknownLiveness(observed.scan)) {
      console.error(
        "[worktree-janitor] AUTO_REAP on, but Workroom claims were unreadable this run — " +
          "staying in observe mode. The reaper must not reap on absent evidence.",
      );
      return summarize(observed.scan, "dry-run");
    }
    const live = await runScan("live");
    if (!live.available) return unhealthy(live.reason);
    return summarize(live.scan, "live");
  }

  const retained = countRetained(observed.scan);
  const max = resolveMaxWorktrees(env);

  if (retained <= max) {
    return summarize(observed.scan, "dry-run");
  }

  // A bound must never drive deletion on evidence the scan could not gather.
  // The observation reports how many worktrees it had to KEEP because the
  // Workroom claim record was unreadable; if it kept anything for that reason,
  // liveness is unknown for this run and going live would reap on a guess. This
  // is the half that turned a dormant classifier flaw into automatic damage
  // when the bound shipped in #4987 — the bound is only safe once liveness is
  // platform-owned AND actually readable.
  if (scanKeptForUnknownLiveness(observed.scan)) {
    console.error(
      "[worktree-janitor] over bound, but Workroom claims were unreadable this run — " +
        "staying in observe mode. A bound must not reap on absent evidence.",
    );
    return summarize(observed.scan, "dry-run");
  }

  console.warn(
    `[worktree-janitor] over bound: ${retained} worktrees retained, bound ${max} ` +
      `(${WORKTREE_JANITOR_MAX_FLAG}). Reaping Tier-A excess without waiting for a decision — ` +
      "Tier B and anything unmerged or unpushed still require an explicit go.",
  );

  const live = await runScan("live");
  if (!live.available) return unhealthy(live.reason);
  return summarize(live.scan, "live");

}

export const worktreeJanitor = jobs.createFunction(
  {
    id: "ops/worktree-janitor",
    retries: 1,
    // Daily after artifact observe (05:20) — host hygiene, not hot path.
    triggers: [cron("40 5 * * *")],
  },
  async ({ step }) => {
    return await step.run("worktree-janitor", () => runWorktreeJanitor());
  },
);
