// BI-DBF3F426 — Runtime-artifact janitor, scheduled home.
// BI-A55BE432 — Founder-gated auto-reap (this file's AUTO_REAP path).
//
// Design-Grounding-Decision: BI-DBF3F426, BI-A55BE432
// Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
//   §4.1 (worktree lifecycle + reaping) and §4.3 (sandbox & container discipline).
//
// COMPLEMENT to runtime-target-janitor.ts (BI-AD949172, hourly). That sweep reaps
// stale *RuntimeTarget* / lease *records* in the DB. This one gives the Docker-side
// janitor — scripts/runtime-artifact-janitor.mjs (per-branch CI build images +
// stray/foreign compose projects, plus their orphaned named volumes) — a scheduled
// home.
//
// ─── SAFETY DOCTRINE: THREE STATES (mirrors worktree-janitor.ts, BI-42FA7DD8) ──
// The `destructive-actions-require-explicit-go` commandment governs Docker reaping:
// a wrong orphan-classification could tear down the running portal or a live build
// sandbox. The durable flag pair IS the explicit-go, so auto-reap stays governed:
//   * Default OFF (DPF_RUNTIME_ARTIFACT_JANITOR_ENABLED not set) — no scan at all.
//   * ENABLED without AUTO_REAP — DRY-RUN observe only: logs what it WOULD reap
//     (what / why-classified-orphan / age) and deletes nothing.
//   * ENABLED + AUTO_REAP=1 — live `--apply`: reaps orphaned CI build images and
//     stray compose projects INCLUDING their named volumes.
// Live reaping leans entirely on the CLI's own guards (root `dpf` never touched,
// any project with a running container KEPT, any live-worktree-backed project KEPT,
// volume removal label-scoped, 7-day staleness grace). Rollout doctrine: soak the
// observe log first, arm AUTO_REAP only once the daily would-reap set is trusted.
//
// Graceful degradation is unchanged: the portal container has no Docker socket, so
// the CLI exits 1, the scan degrades to "unavailable", and the schedule logs and
// no-ops — it never throws. A host runner (or an operator on the host) is where the
// CLI actually has Docker to look at.
//
// The whole scheduled set is already behind DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { resolveManagedScriptPath } from "@/lib/operate/backups/managed-script-path";

/** Master switch: run the scan at all (default OFF, conservative activation). */
export const ARTIFACT_JANITOR_OBSERVE_FLAG = "DPF_RUNTIME_ARTIFACT_JANITOR_ENABLED";

/**
 * Live `--apply` reaping. Honored ONLY when the master switch is also set.
 * Default OFF — soak with the dry-run observe log first.
 */
export const ARTIFACT_JANITOR_AUTO_REAP_FLAG = "DPF_RUNTIME_ARTIFACT_JANITOR_AUTO_REAP";

/**
 * Observe argv: `--json` selects the machine-readable report; the CLI defaults to
 * dry-run, so no mutation flag is present or needed. Must never contain a reaping
 * flag — enforced by assertObserveArgs() below.
 */
export const OBSERVE_SCAN_ARGS: readonly string[] = Object.freeze(["--json"]);

/**
 * Auto-reap argv: `--apply` turns on real reaping. All blast-radius control lives
 * in the CLI's classifier (root-safe, running-container-safe, live-worktree-safe,
 * label-scoped volumes, staleness grace), so no extra scoping flag is needed here.
 */
export const AUTO_REAP_SCAN_ARGS: readonly string[] = Object.freeze(["--json", "--apply"]);

/** Tokens that would make the CLI mutate Docker state. Forbidden from OBSERVE args. */
const APPLY_TOKENS = ["--apply", "--live"];

/** Node CLI, run in dry-run. Located via the managed-script resolver (container-safe). */
const JANITOR_SCRIPT = "runtime-artifact-janitor.mjs";
const SCAN_TIMEOUT_MS = 60_000;
const SCAN_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Regression tripwire: fail loudly at module load if the observe args ever grow a
 * reaping flag. Keeps the "the schedule can never delete" invariant enforced by the
 * runtime, not just by a comment a future edit might not read.
 */
export function assertObserveArgs(args: readonly string[]): void {
  const offending = args.filter((a) => APPLY_TOKENS.some((t) => a === t || a.startsWith(`${t}=`)));
  if (offending.length > 0) {
    throw new Error(
      `[runtime-artifact-janitor] OBSERVE args must never contain reaping flags; ` +
        `found ${JSON.stringify(offending)}. Live reaping only runs from AUTO_REAP_SCAN_ARGS ` +
        `under the AUTO_REAP flag (destructive-actions-require-explicit-go).`,
    );
  }
}
assertObserveArgs(OBSERVE_SCAN_ARGS);

/**
 * Regression tripwire for the live path: auto-reap must actually carry `--apply`,
 * or arming the flag would silently do nothing (a worse failure than an error).
 */
export function assertAutoReapArgs(args: readonly string[]): void {
  if (!args.includes("--apply")) {
    throw new Error("[runtime-artifact-janitor] AUTO_REAP_SCAN_ARGS must include --apply");
  }
}
assertAutoReapArgs(AUTO_REAP_SCAN_ARGS);

// ─── Types ───────────────────────────────────────────────────────────────────

type ImageDecision = {
  image: { repository: string };
  verdict: "REAP" | "KEEP";
  reason: string;
  ageDays: number;
};
type ProjectDecision = {
  project: { projectName: string };
  verdict: "REAP" | "KEEP";
  reason: string;
  ageDays: number;
};

/** Per-volume reclaim result the CLI reports for a reaped project (apply mode). */
type AppliedVolume = { name: string; ok: boolean; detail?: string };
/** Per-project reap result the CLI reports (apply mode). */
type AppliedProject = {
  projectName: string;
  ok: boolean;
  volumes?: AppliedVolume[];
  volumesSkippedReason?: string;
};

/** Shape of the CLI's `--json` report (subset this function reads). */
export type ArtifactJanitorScan = {
  mode: string;
  stalenessDays: number;
  imageDecisions: ImageDecision[];
  projectDecisions: ProjectDecision[];
  /** Present only in apply mode: what the CLI actually removed. */
  applied?: {
    images?: Array<{ repository: string; ok: boolean }>;
    projects?: AppliedProject[];
  };
};

export type ScanOutcome =
  | { available: true; scan: ArtifactJanitorScan }
  | { available: false; reason: string };

export type ObserveResult =
  | { skipped: true; reason: string }
  | {
      skipped: false;
      mode: "dry-run";
      stalenessDays: number;
      wouldReapImages: number;
      wouldReapProjects: number;
      wouldReapImageRepositories: string[];
      wouldReapProjectNames: string[];
    }
  | {
      skipped: false;
      mode: "apply";
      stalenessDays: number;
      reapedImages: number;
      reapedProjects: number;
      reclaimedVolumes: number;
      reapedProjectNames: string[];
    };

export type RunObserveOptions = {
  env?: Record<string, string | undefined>;
  /** Injectable for tests; production uses defaultRunScan (CLI spawn). */
  runScan?: (mode: "dry-run" | "apply") => Promise<ScanOutcome>;
};

// ─── Default scan: spawn the CLI in DRY-RUN and parse its JSON ────────────────

async function defaultRunScan(mode: "dry-run" | "apply"): Promise<ScanOutcome> {
  // Re-assert both invariants at the call site — cheap, and it pins them next to the
  // one place that actually spawns the CLI.
  assertObserveArgs(OBSERVE_SCAN_ARGS);
  assertAutoReapArgs(AUTO_REAP_SCAN_ARGS);

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const scriptPath = resolveManagedScriptPath(JANITOR_SCRIPT);
  const cliArgs = mode === "apply" ? [...AUTO_REAP_SCAN_ARGS] : [...OBSERVE_SCAN_ARGS];

  try {
    // Constant binary "node" + constant script path + frozen args. No shell.
    const { stdout } = await execFileAsync("node", [scriptPath, ...cliArgs], {
      timeout: SCAN_TIMEOUT_MS,
      maxBuffer: SCAN_MAX_BUFFER,
    });
    const scan = JSON.parse(stdout) as ArtifactJanitorScan;
    return { available: true, scan };
  } catch (err) {
    // The CLI exits 1 when docker/git are not reachable — the expected case inside
    // the portal container, which has no Docker socket. That is NOT a failure of
    // this schedule: it degrades to "unavailable" and logs, never throws. A host
    // runner (or a future governed operator action) is where detection actually
    // has Docker to look at.
    const e = err as { stderr?: string; message?: string };
    const reason = (e.stderr || e.message || String(err)).toString().trim().slice(0, 500);
    return { available: false, reason };
  }
}

// ─── Pure runner (Inngest-free; tests inject runScan) ────────────────────────

export async function runRuntimeArtifactJanitorObserve(
  options: RunObserveOptions = {},
): Promise<ObserveResult> {
  const env = options.env ?? process.env;

  if (!envFlagEnabled(env, ARTIFACT_JANITOR_OBSERVE_FLAG)) {
    return {
      skipped: true,
      reason: `scan disabled (${ARTIFACT_JANITOR_OBSERVE_FLAG} not set)`,
    };
  }

  // Live reap only when BOTH the master switch and the auto-reap flag are set.
  const autoReap =
    envFlagEnabled(env, ARTIFACT_JANITOR_OBSERVE_FLAG) &&
    envFlagEnabled(env, ARTIFACT_JANITOR_AUTO_REAP_FLAG);
  const mode: "dry-run" | "apply" = autoReap ? "apply" : "dry-run";

  const runScan = options.runScan ?? defaultRunScan;
  const outcome = await runScan(mode);

  if (!outcome.available) {
    console.warn(`[runtime-artifact-janitor] scan unavailable: ${outcome.reason}`);
    return { skipped: true, reason: outcome.reason };
  }

  const { scan } = outcome;

  // Defense-in-depth: the CLI reports its own mode; it must match what we asked for.
  // A mismatch means something rewired the args — refuse to record it either way.
  if (scan.mode !== mode) {
    console.error(
      `[runtime-artifact-janitor] REFUSING scan mode "${scan.mode}" (expected "${mode}").`,
    );
    return { skipped: true, reason: `unexpected scan mode "${scan.mode}"` };
  }

  const imagesToReap = (scan.imageDecisions ?? []).filter((d) => d.verdict === "REAP");
  const projectsToReap = (scan.projectDecisions ?? []).filter((d) => d.verdict === "REAP");

  if (mode === "apply") {
    const reapedImages = (scan.applied?.images ?? []).filter((i) => i.ok);
    const reapedProjects = (scan.applied?.projects ?? []).filter((p) => p.ok);
    const reclaimedVolumes = reapedProjects.reduce(
      (n, p) => n + (p.volumes ?? []).filter((v) => v.ok).length,
      0,
    );
    for (const p of reapedProjects) {
      const vols = (p.volumes ?? []).filter((v) => v.ok).length;
      console.warn(
        `[runtime-artifact-janitor] REAPED compose-project ${p.projectName} ` +
          `(+${vols} volume(s)) [apply]`,
      );
    }
    const result = {
      skipped: false as const,
      mode: "apply" as const,
      stalenessDays: scan.stalenessDays,
      reapedImages: reapedImages.length,
      reapedProjects: reapedProjects.length,
      reclaimedVolumes,
      reapedProjectNames: reapedProjects.map((p) => p.projectName),
    };
    console.warn(`[runtime-artifact-janitor] apply summary: ${JSON.stringify(result)}`);
    return result;
  }

  // Structured would-reap log: what / why-classified-orphan / age. Nothing deleted.
  for (const d of imagesToReap) {
    console.warn(
      `[runtime-artifact-janitor] WOULD-REAP image ${d.image.repository} — ${d.reason} ` +
        `(age ${d.ageDays.toFixed(1)}d) [dry-run, NOT deleted]`,
    );
  }
  for (const d of projectsToReap) {
    console.warn(
      `[runtime-artifact-janitor] WOULD-REAP compose-project ${d.project.projectName} — ${d.reason} ` +
        `(age ${d.ageDays.toFixed(1)}d) [dry-run, NOT deleted]`,
    );
  }

  const result = {
    skipped: false as const,
    mode: "dry-run" as const,
    stalenessDays: scan.stalenessDays,
    wouldReapImages: imagesToReap.length,
    wouldReapProjects: projectsToReap.length,
    wouldReapImageRepositories: imagesToReap.map((d) => d.image.repository),
    wouldReapProjectNames: projectsToReap.map((d) => d.project.projectName),
  };

  console.warn(`[runtime-artifact-janitor] observe summary: ${JSON.stringify(result)}`);
  return result;
}

// ─── Inngest wrapper ─────────────────────────────────────────────────────────

export const runtimeArtifactJanitor = inngest.createFunction(
  {
    id: "ops/runtime-artifact-janitor",
    retries: 1,
    // Daily. Docker-artifact churn is slow; a per-day scan gives steady visibility of
    // the would-reap set (observe) or keeps orphans reclaimed (auto-reap) without
    // hammering the host. 05:20 to avoid the 04:00–05:00 backup/retention/steward
    // window.
    triggers: [cron("20 5 * * *")],
  },
  async ({ step }) => {
    return await step.run("observe-runtime-artifacts", () =>
      runRuntimeArtifactJanitorObserve(),
    );
  },
);
