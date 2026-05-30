// apps/web/lib/self-upgrade/prepare-source.ts
//
// Source preparation for the self-upgrade subsystem (governed-upgrade-lifecycle
// spec §5.0). Runs PORTAL-side, where the process has read/write access to the
// host clone via the `/host-dpf` mount and where merge conflicts can be surfaced
// in the Upgrade Center rather than dropped to a CLI.
//
// It mutates the host clone so that, by the time the (read-only) promoter builds
// it, the working tree IS exactly the bytes to ship — and returns the honest
// deployed stamp derived from that tree's real HEAD. The promoter never has to
// be trusted to label the build; the label is the tree's own identity.
//
//   upstream: fetch <remote> <branch> → checkout install branch → merge the
//             target into it (--no-ff). Clean merge ⇒ proceed with the
//             merge-commit SHA as the stamp; conflict ⇒ abort + defer with the
//             conflicting files, so the operator is never left mid-merge.
//   local:    build the working tree as-is; stamp = HEAD (+ "-dirty" when the
//             tree has uncommitted changes).

import {
  buildFetchCommand,
  buildRemoteHeadCommand,
  buildHeadShaCommand,
  buildDirtyCheckCommand,
  buildMergeCommand,
  deriveDeployedStamp,
} from "./version";
import type { UpgradeSourceMode } from "./config";

/** Result of running one git command. Never throws on non-zero exit. */
export type GitResult = { stdout: string; stderr: string; code: number };

/** Injected git runner — argv in, captured result out. */
export type GitRunner = (args: string[]) => Promise<GitResult>;

export type PrepareSourceInput = {
  sourceMode: UpgradeSourceMode;
  /** In-portal path to the host clone (e.g. /host-dpf), NOT the host-side path. */
  hostSourcePath: string;
  remote: string;
  branch: string;
  installBranch: string;
};

export type PrepareSourceResult =
  | {
      ok: true;
      mode: UpgradeSourceMode;
      /** Honest identity of the bytes to build (40-hex, or `<sha>-dirty`). */
      stamp: string;
      /** The upstream SHA contained by this build, when known (lineage). */
      upstreamSha?: string;
    }
  | {
      ok: false;
      reason: "merge-conflict";
      conflictFiles: string[];
      upstreamSha?: string;
      message: string;
    }
  | {
      ok: false;
      reason: "no-target" | "prep-error";
      message: string;
    };

function trim(s: string): string {
  return s.trim();
}

async function readHeadStamp(run: GitRunner, hostSourcePath: string): Promise<string> {
  const head = await run(buildHeadShaCommand(hostSourcePath).slice(1));
  const dirty = await run(buildDirtyCheckCommand(hostSourcePath).slice(1));
  return deriveDeployedStamp(head.stdout, trim(dirty.stdout).length > 0);
}

/**
 * Prepare the upgrade source on disk and return its honest stamp. `run` receives
 * git argv WITHOUT the leading "git" (so it can be a thin wrapper over execFile).
 */
export async function prepareUpgradeSource(
  input: PrepareSourceInput,
  run: GitRunner,
): Promise<PrepareSourceResult> {
  const { sourceMode, hostSourcePath, remote, branch, installBranch } = input;

  if (sourceMode === "local") {
    try {
      const stamp = await readHeadStamp(run, hostSourcePath);
      return { ok: true, mode: "local", stamp };
    } catch (err) {
      return { ok: false, reason: "prep-error", message: errMsg(err) };
    }
  }

  // ── upstream ──────────────────────────────────────────────────────────────
  try {
    const fetch = await run(buildFetchCommand({ hostSourcePath, remote, branch }).slice(1));
    if (fetch.code !== 0) {
      return { ok: false, reason: "prep-error", message: `fetch failed: ${trim(fetch.stderr) || fetch.code}` };
    }

    const head = await run(buildRemoteHeadCommand({ hostSourcePath, remote, branch }).slice(1));
    const upstreamSha = trim(head.stdout);
    if (head.code !== 0 || !upstreamSha) {
      return { ok: false, reason: "no-target", message: `cannot resolve ${remote}/${branch}` };
    }

    // Move the clone onto the durable install branch WITHOUT discarding its
    // local commits: check it out if it exists, otherwise create it from the
    // current HEAD. (`-B` is deliberately avoided — it would reset an existing
    // install branch to HEAD and destroy the local delta this whole design
    // exists to preserve.)
    const exists = await run(["-C", hostSourcePath, "rev-parse", "--verify", "--quiet", installBranch]);
    const checkout =
      exists.code === 0
        ? await run(["-C", hostSourcePath, "checkout", installBranch])
        : await run(["-C", hostSourcePath, "checkout", "-b", installBranch]);
    if (checkout.code !== 0) {
      return { ok: false, reason: "prep-error", message: `checkout ${installBranch} failed: ${trim(checkout.stderr) || checkout.code}` };
    }

    const merge = await run(buildMergeCommand({ hostSourcePath, remote, branch }).slice(1));
    if (merge.code !== 0) {
      // Collect the conflicting files, then abort so the clone is never left
      // mid-merge. The operator resolves in the Upgrade Center; until then the
      // current build keeps running.
      const conflicts = await run(["-C", hostSourcePath, "diff", "--name-only", "--diff-filter=U"]);
      const conflictFiles = trim(conflicts.stdout).split("\n").map(trim).filter(Boolean);
      await run(["-C", hostSourcePath, "merge", "--abort"]);
      return {
        ok: false,
        reason: "merge-conflict",
        conflictFiles,
        upstreamSha,
        message: `upstream merge conflicts in ${conflictFiles.length} file(s)`,
      };
    }

    const stamp = await readHeadStamp(run, hostSourcePath);
    return { ok: true, mode: "upstream", stamp, upstreamSha };
  } catch (err) {
    return { ok: false, reason: "prep-error", message: errMsg(err) };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Real git runner over execFile. Never throws on non-zero exit — git's exit
 * code and captured stderr are returned so callers can branch on them (a merge
 * conflict is exit 1, not an exception).
 */
export async function defaultGitRunner(args: string[]): Promise<GitResult> {
  const { execFile } = await import("node:child_process");
  // Run prep's internal git ops with repo hooks DISABLED. The host clone ships a
  // Git LFS post-checkout/post-merge hook (the repo uses filter=lfs), but the
  // portal container has no git-lfs binary — so the hook exits non-zero and makes
  // an otherwise-successful `git checkout`/`merge` look like it failed, aborting
  // the whole upgrade at prep. Prep is mechanical (move branches, merge for a
  // build) and never needs LFS smudging, so force core.hooksPath empty and skip
  // LFS smudge. `-c` is a git GLOBAL option and must precede the subcommand —
  // prepend it ahead of the caller's args (which start with "-C <path> <cmd>").
  const safeArgs = ["-c", "core.hooksPath=/dev/null", ...args];
  return new Promise<GitResult>((resolve) => {
    execFile("git", safeArgs, {
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    }, (err, stdout, stderr) => {
      const out = stdout?.toString() ?? "";
      const errOut = stderr?.toString() ?? "";
      if (err) {
        const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1;
        resolve({ stdout: out, stderr: errOut || errMsg(err), code });
      } else {
        resolve({ stdout: out, stderr: errOut, code: 0 });
      }
    });
  });
}
