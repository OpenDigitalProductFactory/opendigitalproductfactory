// BI-42FA7DD8 — Worktree Tier-A FLEET BACKSTOP (optional schedule).
//
// PRIMARY path is transactional, not this cron:
//   packages/dpf-skill-pack/hooks/worktree-session-hygiene.mjs on SessionStart
//   (observe) + SessionEnd/Stop (reap THIS session's worktree when Tier-A).
// That fires on every client that loaded dpf-platform (Claude plugin / Grok
// global hooks / Codex hooks) — no per-client cron to configure, no "schedule
// went dark" failure mode for the common case.
//
// THIS module is an optional fleet sweeper for leftovers (abandoned worktrees
// after crashes, clients without hooks). It is server-side Inngest (portal),
// NOT a CLI client cron. It still may not see host worktrees when the portal
// container lacks a host git view — then it no-ops.
//
// Spec: docs/superpowers/specs/2026-07-26-multi-client-governance-parity-design.md § D4
// Kernel: worktree-selection-and-reaping, destructive-actions-require-explicit-go
//
// SAFETY DOCTRINE (backstop)
//   * Default OFF (DPF_WORKTREE_JANITOR_ENABLED not set) — no scan.
//   * When ENABLED without AUTO_REAP: dry-run observe only.
//   * When AUTO_REAP=1: live **Tier A only**. Tier B never auto-deleted here.
//   * Removals use junction-safe-worktree-remove.mjs via the CLI.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { resolveManagedScriptPath } from "@/lib/operate/backups/managed-script-path";

/** Master switch: run the scan at all (default OFF). */
export const WORKTREE_JANITOR_ENABLED_FLAG = "DPF_WORKTREE_JANITOR_ENABLED";

/**
 * Live Tier-A reaping. Only honored when ENABLED is also set.
 * Default OFF — soak with dry-run first.
 */
export const WORKTREE_JANITOR_AUTO_REAP_FLAG = "DPF_WORKTREE_JANITOR_AUTO_REAP";

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

export async function runWorktreeJanitor(options: RunOptions = {}): Promise<RunResult> {
  const env = options.env ?? process.env;

  if (!envFlagEnabled(env, WORKTREE_JANITOR_ENABLED_FLAG)) {
    return {
      skipped: true,
      reason: `disabled (${WORKTREE_JANITOR_ENABLED_FLAG} not set)`,
    };
  }

  const autoReap =
    envFlagEnabled(env, WORKTREE_JANITOR_AUTO_REAP_FLAG) &&
    envFlagEnabled(env, WORKTREE_JANITOR_ENABLED_FLAG);
  const mode: "dry-run" | "live" = autoReap ? "live" : "dry-run";

  const runScan = options.runScan ?? defaultRunScan;
  const outcome = await runScan(mode);

  if (!outcome.available) {
    console.warn(`[worktree-janitor] scan unavailable: ${outcome.reason}`);
    return { skipped: true, reason: outcome.reason };
  }

  const { scan } = outcome;
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

export const worktreeJanitor = inngest.createFunction(
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
