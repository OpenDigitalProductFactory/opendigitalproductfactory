// BI-DBF3F426 — Runtime-artifact janitor, scheduled OBSERVE / DRY-RUN activation.
//
// Design-Grounding-Decision: BI-DBF3F426
// Spec: docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
//   §4.1 (worktree lifecycle + reaping) and §4.3 (sandbox & container discipline).
//
// COMPLEMENT to runtime-target-janitor.ts (BI-AD949172, hourly). That sweep reaps
// stale *RuntimeTarget* / lease *records* in the DB. This one gives the Docker-side
// janitor — scripts/runtime-artifact-janitor.mjs (per-branch CI build images +
// stray/foreign compose projects) — a scheduled home.
//
// ─── SAFETY DOCTRINE: OBSERVE-ONLY. THIS SCHEDULE NEVER DELETES. ──────────────
// The `destructive-actions-require-explicit-go` commandment governs Docker reaping:
// a wrong orphan-classification could tear down the running portal or a live build
// sandbox. So this scheduled function runs the janitor's DETECTION in DRY-RUN mode
// ONLY. It LOGS what the janitor WOULD reap (what / why-classified-orphan / age) and
// records a summary — and deletes nothing.
//
// There is intentionally NO code path from this schedule to the janitor's `--apply`
// reaping. Proof, three layers deep:
//   1. The only args this file ever passes to the CLI are OBSERVE_SCAN_ARGS below,
//      a frozen literal that is `["--json"]` — no `--apply`, no `--live`. The CLI
//      defaults to dry-run, so even the flag omission is belt-and-suspenders.
//   2. assertObserveArgs() throws at module load if OBSERVE_SCAN_ARGS ever grows an
//      apply/live token — a regression tripwire, not just a comment.
//   3. The runner re-checks the CLI's own reported `mode` and REFUSES to record a
//      summary for anything other than "dry-run".
// The reaping functions (reapImage / reapComposeProject) live only inside the CLI's
// main(), reachable only when it parses `--apply`/`--live`, which this file never
// emits. Turning on real reaping is a SEPARATE, founder-gated change (a governed
// operator action), deliberately excluded from this PR.
//
// Activation is further gated by DPF_RUNTIME_ARTIFACT_JANITOR_ENABLED (default OFF):
// even the harmless dry-run scan does not run until an operator opts in. The whole
// scheduled set is already behind DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { resolveManagedScriptPath } from "@/lib/operate/backups/managed-script-path";

/** Operator opt-in for the observe scan. Default OFF (conservative activation). */
export const ARTIFACT_JANITOR_OBSERVE_FLAG = "DPF_RUNTIME_ARTIFACT_JANITOR_ENABLED";

/**
 * The ONLY argv this schedule ever hands the janitor CLI. `--json` selects the
 * machine-readable report; the CLI defaults to dry-run, so no mutation flag is
 * present or needed. This must never contain `--apply` or `--live`.
 */
export const OBSERVE_SCAN_ARGS: readonly string[] = Object.freeze(["--json"]);

/** Tokens that would make the CLI mutate Docker state. Forbidden from the schedule. */
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
      `[runtime-artifact-janitor] OBSERVE schedule must never pass reaping flags; ` +
        `found ${JSON.stringify(offending)}. Real reaping is a founder-gated operator action, ` +
        `not a scheduled behaviour (destructive-actions-require-explicit-go).`,
    );
  }
}
assertObserveArgs(OBSERVE_SCAN_ARGS);

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

/** Shape of the CLI's `--json` report (subset this function reads). */
export type ArtifactJanitorScan = {
  mode: string;
  stalenessDays: number;
  imageDecisions: ImageDecision[];
  projectDecisions: ProjectDecision[];
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
    };

export type RunObserveOptions = {
  env?: Record<string, string | undefined>;
  /** Injectable for tests; production uses defaultRunScan (dry-run CLI spawn). */
  runScan?: () => Promise<ScanOutcome>;
};

// ─── Default scan: spawn the CLI in DRY-RUN and parse its JSON ────────────────

async function defaultRunScan(): Promise<ScanOutcome> {
  // Re-assert at the call site too — cheap, and it pins the invariant next to the
  // one place that actually spawns the CLI.
  assertObserveArgs(OBSERVE_SCAN_ARGS);

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const scriptPath = resolveManagedScriptPath(JANITOR_SCRIPT);

  try {
    // Constant binary "node" + constant script path + frozen dry-run args. No shell.
    const { stdout } = await execFileAsync("node", [scriptPath, ...OBSERVE_SCAN_ARGS], {
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
      reason: `observe scan disabled (${ARTIFACT_JANITOR_OBSERVE_FLAG} not set)`,
    };
  }

  const runScan = options.runScan ?? defaultRunScan;
  const outcome = await runScan();

  if (!outcome.available) {
    console.warn(`[runtime-artifact-janitor] observe scan unavailable: ${outcome.reason}`);
    return { skipped: true, reason: outcome.reason };
  }

  const { scan } = outcome;

  // Defense-in-depth: the CLI reports its own mode. Anything other than "dry-run"
  // means something upstream tried to make this schedule mutate — refuse it.
  if (scan.mode !== "dry-run") {
    console.error(
      `[runtime-artifact-janitor] REFUSING scan mode "${scan.mode}"; the observe schedule ` +
        `only ever records dry-run detections and never reaps.`,
    );
    return { skipped: true, reason: `unexpected scan mode "${scan.mode}"` };
  }

  const imagesToReap = (scan.imageDecisions ?? []).filter((d) => d.verdict === "REAP");
  const projectsToReap = (scan.projectDecisions ?? []).filter((d) => d.verdict === "REAP");

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
    // Daily. Docker-artifact churn is slow; a per-day dry-run scan gives the founder
    // steady visibility of the would-reap set without hammering the host. 05:20 to
    // avoid the 04:00–05:00 backup/retention/steward window.
    triggers: [cron("20 5 * * *")],
  },
  async ({ step }) => {
    return await step.run("observe-runtime-artifacts", () =>
      runRuntimeArtifactJanitorObserve(),
    );
  },
);
