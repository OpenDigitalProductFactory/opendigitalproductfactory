// apps/web/lib/build/sandbox/leaked-readiness-checkout.ts
//
// BI-34A05E78: the published-tree readiness command detaches the build clone to
// the published commit and checks the build branch out again later in the same
// shell. When that shell is killed (FB-533EC6E2, exit 137, 2026-11-13 05:36Z)
// the restore never runs. The clone stays detached on the published commit, and
// every later preflight reads HEAD^{tree}, which is the published overlay tree
// with no verification record. It was refused hourly although the build's own
// tree had not changed.
//
// A trap cannot help when the shell gets SIGKILL, so the next attempt repairs
// the clone before it reads the tree. Only the safe case is repaired: HEAD
// detached, no tracked changes, build branch present. Anything else is
// reported, and the preflight refuses as it did before.

import type { SandboxExec } from "./guard-gauntlet";

export type CheckoutRestoreOutcome = "on-branch" | "restored" | "dirty" | "unknown";

const SAFE_BRANCH = /^(?![-/])(?!.*(?:\.\.|\/\/|@\{|\\))[A-Za-z0-9._/-]+$/;
const BUILD_WORKDIR = /^\/workspace\/\.builds\/[A-Za-z0-9_-]+$/;

export function buildRestoreCheckoutCommand(input: { workdir: string; buildBranch: string }): string {
  if (!BUILD_WORKDIR.test(input.workdir)) throw new Error("Restore workdir must be a build worktree.");
  if (!SAFE_BRANCH.test(input.buildBranch) || input.buildBranch.endsWith("/")) {
    throw new Error("Build branch is not a safe Git branch name.");
  }
  const branch = input.buildBranch;
  return [
    `cd '${input.workdir}' || { echo DPF_CHECKOUT=unknown; exit 0; }`,
    "if git symbolic-ref -q HEAD >/dev/null; then echo DPF_CHECKOUT=on-branch;",
    `elif [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then echo DPF_CHECKOUT=dirty;`,
    `elif git show-ref --verify -q 'refs/heads/${branch}' && git checkout -q '${branch}' 2>/dev/null; then echo DPF_CHECKOUT=restored;`,
    "else echo DPF_CHECKOUT=unknown; fi",
  ].join(" ");
}

/** Put a leaked detached checkout back on its build branch. Never throws. */
export async function restoreLeakedReadinessCheckout(input: {
  exec: SandboxExec;
  containerId: string;
  workdir: string;
  buildBranch: string;
}): Promise<CheckoutRestoreOutcome> {
  try {
    const out = await input.exec(input.containerId, buildRestoreCheckoutCommand(input));
    const match = /DPF_CHECKOUT=(on-branch|restored|dirty)\b/.exec(out);
    return (match?.[1] as CheckoutRestoreOutcome | undefined) ?? "unknown";
  } catch {
    return "unknown";
  }
}
