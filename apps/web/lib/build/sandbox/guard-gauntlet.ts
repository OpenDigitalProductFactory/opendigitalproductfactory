/**
 * Run the deterministic guard gauntlet against a Build Studio build's own tree.
 *
 * The external-agent path runs `scripts/pregate-preflight.mjs` — 67 guards —
 * before its first commit. The in-platform path ran none of them, which is the
 * bulk of the day-to-day quality difference between the two surfaces. Unlike the
 * production build and the image, the guards need no Docker, no lease and no host
 * toolchain: they are source-reading Node scripts, and the sandbox already has
 * Node, pnpm, git, an installed node_modules and the whole scripts/ tree, all
 * placed by docker-entrypoint.sh.
 *
 * This runs the SAME script the external path runs. Reimplementing the checks
 * here would guarantee the two surfaces drift apart, which is the thing the
 * parity work exists to prevent (BI-CA6769FE).
 */
import { createHash } from "node:crypto";

/** Never let a runaway guard hold the build; the full sweep is ~70-110s. */
const GAUNTLET_TIMEOUT_SECONDS = 600;

/**
 * Bound what we keep. The full preflight log is large and the interesting part
 * is the tail, where the failure summary is printed.
 */
const MAX_OUTPUT_CHARS = 20_000;

/** Marks the end of the command so a non-zero exit can be read from stdout. */
const EXIT_SENTINEL = "__DPF_GAUNTLET_EXIT__";

export type GuardGauntletOutcome =
  /** The gauntlet ran to a verdict. */
  | { ran: true; passed: boolean; failedGuards: string[]; output: string; treeSha: string | null; workdir: string; durationMs: number }
  /**
   * The gauntlet could not run. This is NOT a failing verdict — reporting it as
   * one is the mistake `report-only-the-verdict-you-reached` names, and the
   * caller must be able to tell the two apart.
   */
  | { ran: false; reason: string; workdir: string; durationMs: number };

export type SandboxExec = (containerId: string, command: string) => Promise<string>;

/** Shell-quote a path for `sh -c`. Workdirs are derived, never user text, but this is cheap. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * The guard names the preflight prints in its failure summary, which look like:
 *
 *   [pregate-preflight] 1 guard(s) FAILED in 67.6s — ...
 *     - Module Size Guard: node scripts/check-module-size.mjs
 *
 * Parsed from the summary block rather than from each guard's own prose, because
 * only the summary has a stable shape.
 */
export function parseFailedGuards(output: string): string[] {
  const marker = output.lastIndexOf("guard(s) FAILED");
  if (marker === -1) return [];
  const names: string[] = [];
  for (const line of output.slice(marker).split(/\r?\n/)) {
    const match = /^\s*-\s+([^:]+):/.exec(line);
    if (match?.[1]) names.push(match[1].trim());
  }
  return names;
}

/** Keep the tail: the verdict and the failure summary are at the end. */
export function boundOutput(output: string, max = MAX_OUTPUT_CHARS): string {
  if (output.length <= max) return output;
  return `… (${output.length - max} earlier characters omitted)\n${output.slice(-max)}`;
}

/**
 * A digest of the PLAN — what was going to be run — not of its outcome.
 *
 * This pairs with the tree sha: one says what was checked, the other says what
 * checked it. It must contain nothing result-dependent, because a consumer has
 * to derive the same key BEFORE it knows the result in order to look the record
 * up. Hashing the outcome in here would make the key underivable by anything but
 * the producer, which defeats the point of keying it at all.
 */
export const GUARD_PLAN_VERSION = 1 as const;

export function guardPlanDigest(scriptPath: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ plan: "guard-gauntlet", version: GUARD_PLAN_VERSION, scriptPath }))
    .digest("hex");
}

/**
 * The HEAD tree of the build's worktree — what the guards actually inspected.
 *
 * A commit sha identifies a commit; a TREE sha identifies content, which is what
 * a verification statement is about. Two builds that produce identical content
 * share a tree sha, and evidence about one is honestly evidence about the other.
 * Returns null when the worktree has no commit yet, which is a legitimate state
 * early in a build and must not be reported as a failure.
 */
export async function readWorktreeTreeSha(
  exec: SandboxExec,
  containerId: string,
  workdir: string,
): Promise<string | null> {
  try {
    const out = await exec(containerId, `cd ${quote(workdir)} && git rev-parse HEAD^{tree} 2>/dev/null`);
    const sha = out.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Run the guard gauntlet in the build's worktree.
 *
 * `workdir` must be the build's own tree. With `DPF_BUILD_WORKTREE_ISOLATION` on
 * (the default) the agent CLIs work in `/workspace/.builds/<buildId>` while the
 * MCP file tools write to the shared root — gating the wrong one silently
 * verifies work that is not the work.
 */
export async function runGuardGauntlet(input: {
  exec: SandboxExec;
  containerId: string;
  workdir: string;
  scriptPath?: string;
  now?: () => number;
}): Promise<GuardGauntletOutcome> {
  const { exec, containerId, workdir } = input;
  const scriptPath = input.scriptPath ?? "scripts/pregate-preflight.mjs";
  const now = input.now ?? (() => Date.now());
  const startedAt = now();

  const treeSha = await readWorktreeTreeSha(exec, containerId, workdir);

  // The preflight exits non-zero on failure and execInSandbox rejects on a
  // non-zero exit, so the exit code is carried out through stdout instead. A
  // rejection here therefore means the command could not run at all.
  const command =
    `cd ${quote(workdir)} && timeout ${GAUNTLET_TIMEOUT_SECONDS} node ${quote(scriptPath)} 2>&1; `
    + `echo "${EXIT_SENTINEL}=$?"`;

  let raw: string;
  try {
    raw = await exec(containerId, command);
  } catch (err) {
    return {
      ran: false,
      reason: `The guard gauntlet could not be started in the sandbox: ${(err as Error)?.message ?? "unknown error"}`,
      workdir,
      durationMs: now() - startedAt,
    };
  }

  const exitMatch = new RegExp(`${EXIT_SENTINEL}=(\\d+)`).exec(raw);
  if (!exitMatch) {
    return {
      ran: false,
      reason: "The guard gauntlet produced no exit status, so its verdict is unknown.",
      workdir,
      durationMs: now() - startedAt,
    };
  }

  const exitCode = Number(exitMatch[1]);
  const output = boundOutput(raw.replace(exitMatch[0], "").trimEnd());

  // 124 is `timeout`'s own code. A gauntlet that ran out of time did not reach a
  // verdict, so it is unavailable rather than failing.
  if (exitCode === 124) {
    return {
      ran: false,
      reason: `The guard gauntlet did not finish within ${GAUNTLET_TIMEOUT_SECONDS}s, so it reached no verdict.`,
      workdir,
      durationMs: now() - startedAt,
    };
  }

  const failedGuards = parseFailedGuards(output);

  // A non-zero exit with no named guard is a crash, not a finding — the preflight
  // prints its failures. Saying "a guard failed" here would be inventing one.
  if (exitCode !== 0 && failedGuards.length === 0) {
    return {
      ran: false,
      reason: `The guard gauntlet exited ${exitCode} without naming a failing guard, which is a crash rather than a finding.`,
      workdir,
      durationMs: now() - startedAt,
    };
  }

  return {
    ran: true,
    passed: exitCode === 0,
    failedGuards,
    output,
    treeSha,
    workdir,
    durationMs: now() - startedAt,
  };
}
