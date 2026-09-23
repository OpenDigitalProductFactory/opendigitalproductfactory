// BI-848360EF — reap a worktree when its PR merges, not when the session ends.
//
// The SessionEnd hook (packages/dpf-skill-pack/hooks/worktree-session-hygiene.mjs)
// is the primary reaper and it is correct, but it can only reap a Tier-A tree and
// Tier A requires `merged`. The normal sequence is: gate, push, open PR, END THE
// THREAD, and the PR merges in the queue minutes to hours later. At SessionEnd
// the branch is not merged, so the hook correctly declines — and nothing ever
// revisits that worktree.
//
// That gap is measurable. 2026-09-09: 101 worktrees, 48 merged and Tier-A
// eligible, none reaped. A manual sweep took it to 55; within two days it was
// 103, and by 2026-09-22 it was 157 with 83 merged and unreaped.
//
// It also fights a standing founder instruction — do not hold a thread open to
// watch CI or the merge queue — because following that instruction guarantees
// the reaper's precondition is false when it runs.
//
// WHY THIS DELEGATES TO THE JANITOR INSTEAD OF DELETING
//
// `classifyWorktree` puts its liveness gate ABOVE the merged/Tier-A check, and
// its comment says exactly why: "the moment a live session's PR merges, its
// clean tree first becomes Tier-A eligible — exactly when it must NOT be
// reaped." A merge-triggered reaper is precisely the caller that walks into that
// window. So this does not implement its own rules; it runs the janitor scoped
// to the one branch that just merged, and every existing protection still
// decides — a live session heartbeat, an active Workroom claim, `.worktree-pinned`,
// an active lease, an open PR, a dirty tree. Removal still goes through the
// junction-safe helper, which matters because each worktree carries ~28 junctions
// into the root clone's node_modules and a recursive delete that follows one is
// what wiped packages/* on 2026-08-15.

import { inngest } from "../inngest-client";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { resolveManagedScriptPath } from "@/lib/operate/backups/managed-script-path";

/** Master switch, shared with the fleet backstop: run at all (default OFF). */
export const REAP_ON_MERGE_ENABLED_FLAG = "DPF_WORKTREE_JANITOR_ENABLED";

/**
 * Live removal. Default OFF so the event can be observed before it deletes —
 * the same soak posture the scheduled janitor takes.
 */
export const REAP_ON_MERGE_AUTO_REAP_FLAG = "DPF_WORKTREE_JANITOR_AUTO_REAP";

const JANITOR_SCRIPT = "worktree-janitor.mjs";
const SCAN_TIMEOUT_MS = 120_000;

/**
 * Args for one branch. `--tier-a-only` is NOT optional: Tier B is stale-but-
 * unmerged work and a merge event says nothing about it.
 */
export function reapArgsForBranch(branch: string, live: boolean): string[] {
  const args = ["--branch", branch, "--json", "--tier-a-only"];
  args.push(live ? "--live" : "--dry-run");
  return args;
}

/** A live reap must never be able to widen past Tier A. */
export function assertTierAOnly(args: readonly string[]): void {
  if (args.includes("--live") && !args.includes("--tier-a-only")) {
    throw new Error("[pr-merged-reap] a live reap must be --tier-a-only");
  }
  if (!args.includes("--branch")) {
    throw new Error("[pr-merged-reap] refusing to run unscoped: --branch is required");
  }
}

export const pullRequestMergedReap = inngest.createFunction(
  {
    id: "build/pr-merged-reap",
    retries: 2,
    concurrency: [{ limit: 1, scope: "fn" }],
    triggers: [{ event: "build/pr-merged.received" }],
  },
  async ({ event, step }) => {
    const { headRefName } = event.data as { headRefName: string };
    if (!headRefName) return { ran: false, reason: "no-head-branch" };

    const enabled = envFlagEnabled(process.env, REAP_ON_MERGE_ENABLED_FLAG);
    if (!enabled) return { ran: false, reason: "janitor-disabled", branch: headRefName };

    const live = envFlagEnabled(process.env, REAP_ON_MERGE_AUTO_REAP_FLAG);
    const args = reapArgsForBranch(headRefName, live);
    assertTierAOnly(args);

    return step.run("scan-branch-worktree", async () => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const scriptPath = resolveManagedScriptPath(JANITOR_SCRIPT);

      try {
        const { stdout } = await execFileAsync("node", [scriptPath, ...args], {
          timeout: SCAN_TIMEOUT_MS,
          env: {
            ...process.env,
            DPF_REPO_ROOT: process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT || "/host-dpf",
          },
        });
        const scan = JSON.parse(stdout) as { removals?: unknown[]; decisions?: unknown[] };
        return {
          ran: true,
          live,
          branch: headRefName,
          removed: scan.removals?.length ?? 0,
          considered: scan.decisions?.length ?? 0,
        };
      } catch (err) {
        // A reaper that cannot reach its subject reports that, never success.
        // The fleet backstop learned this the expensive way: its script was
        // never copied into the image, every run died with MODULE_NOT_FOUND,
        // and the caught error read exactly like a clean sweep (BI-B3370CB2).
        const e = err as { stderr?: string; message?: string };
        const reason = (e.stderr || e.message || String(err)).trim().slice(0, 300);
        console.error(`[pr-merged-reap] UNHEALTHY for ${headRefName}: ${reason}`);
        return { ran: false, reason: "scan-failed", branch: headRefName, detail: reason };
      }
    });
  },
);
