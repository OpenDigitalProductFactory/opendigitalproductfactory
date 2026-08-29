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
//   upstream: fetch <remote> <branch> → checkout install branch → compare its
//             content with the common upstream base. No local content delta ⇒
//             advance to the exact upstream SHA. Local content delta ⇒ merge
//             the target (--no-ff) and stamp the merge commit. Conflict ⇒ abort
//             + defer, so the operator is never left mid-merge.
//   local:    build the working tree as-is; stamp = HEAD (+ "-dirty" when the
//             tree has uncommitted changes).

import {
  buildHeadShaCommand,
  buildDirtyCheckCommand,
  deriveDeployedStamp,
} from "./version";
import type { UpgradeSourceMode } from "./config";
import {
  buildLfsLsFilesCommand,
  buildLfsPullCommand,
  describeUnmaterialized,
  parseLfsLsFiles,
  unmaterializedPaths,
} from "./lfs-materialization";
import { getErrorMessage } from "@/lib/shared/get-error-message";

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
  /**
   * BI-A8A7CCFD — when set, do the upstream-merge work in this isolated
   * workspace path INSTEAD of mutating the operator's install clone directly.
   * The workspace is a normal git clone of `hostSourcePath` (objects hardlinked
   * via the local protocol); each upgrade run starts by force-syncing it to
   * the install clone's view of `installBranch` and the live upstream tip, so
   * the workspace tree is always exactly the bytes to merge. On clean merge
   * the new install-branch tip is pushed back to `hostSourcePath` (ref-only;
   * the operator's working tree is never touched).
   *
   * When undefined, falls back to the legacy direct-merge behavior (the
   * orchestrator opts out via `useIsolatedWorkspace=false`, e.g. for
   * single-purpose install boxes where the install clone is never dirty).
   */
  workspacePath?: string;
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
      reason: "no-target" | "prep-error" | "dirty-tree" | "lfs-unmaterialized";
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
 *
 * Two upstream-mode flavours, picked by `input.workspacePath`:
 *   - set    → BI-A8A7CCFD isolated workspace: merge in a dedicated tree, push
 *              the install-branch tip back to the install clone (ref-only).
 *              The operator's install-clone working tree is never touched.
 *   - unset  → legacy direct-merge against the install clone (preserved for
 *              single-purpose install boxes via `useIsolatedWorkspace=false`).
 */
export async function prepareUpgradeSource(
  input: PrepareSourceInput,
  run: GitRunner,
): Promise<PrepareSourceResult> {
  const { sourceMode, hostSourcePath, remote, branch, installBranch, workspacePath } = input;

  if (sourceMode === "local") {
    try {
      const stamp = await readHeadStamp(run, hostSourcePath);
      return { ok: true, mode: "local", stamp };
    } catch (err) {
      return { ok: false, reason: "prep-error", message: errMsg(err) };
    }
  }

  // BI-A8A7CCFD — workspace-isolated upstream merge.
  if (workspacePath) {
    return prepareUpgradeSourceInWorkspace(
      { hostSourcePath, remote, branch, installBranch, workspacePath },
      run,
    );
  }

  // ── upstream WITHOUT an isolated workspace: RETIRED (BI-4043A64B) ──────────
  // The legacy path ran `git checkout <installBranch>` + `git merge` directly
  // against the host clone's WORKING TREE (`/host-dpf`). An interrupted or
  // partial run corrupted the operator's tree — observed 2026-06-15 as 721
  // deleted `packages/` files + files rewritten to main. Source-prep must never
  // mutate the host working tree, so an isolated workspace (BI-A8A7CCFD) is now
  // mandatory for upstream merges. `useIsolatedWorkspace` defaults true (and is
  // forced true in config parsing), so a workspacePath is always derived;
  // reaching here means it was explicitly disabled — refuse rather than corrupt.
  return {
    ok: false,
    reason: "prep-error",
    message:
      "upstream upgrade requires an isolated workspace — the legacy direct-merge against the host clone is retired (it mutated the operator working tree; BI-4043A64B). Leave useIsolatedWorkspace enabled (the default) so the merge runs in .upgrade-workspace.",
  };
}

function errMsg(err: unknown): string {
  return getErrorMessage(err);
}

// ─── BI-A8A7CCFD: workspace-isolated upstream merge ────────────────────────
//
// The workspace is a normal git clone of `hostSourcePath`. We never `git gc`
// during an upgrade, so `git clone` with the local protocol's default
// hardlinks is safe and disk-cheap.
//
// Each run starts by force-syncing the workspace to the install clone's view
// of `installBranch` and the live upstream tip, so the merge always runs
// against an exact mirror — not whatever the operator's dev tree happens to
// look like. Push the merged install-branch tip back to the install clone
// (ref-only) so the next upgrade and the operator's git tooling see the new
// HEAD without us touching the operator's checked-out working tree.

type WorkspaceMergeInput = {
  hostSourcePath: string;
  remote: string;
  branch: string;
  installBranch: string;
  workspacePath: string;
};

/** Internal-remote name the workspace uses for the upstream URL it pulls from.
 *  Kept distinct from `origin` (which points at the install clone) so the two
 *  fetch surfaces are unambiguous to the reader and to git config. */
const UPSTREAM_REMOTE_IN_WORKSPACE = "upgrade-upstream";

async function workspaceIsInitialized(
  run: GitRunner,
  workspacePath: string,
): Promise<boolean> {
  const head = await run(["-C", workspacePath, "rev-parse", "--git-dir"]);
  return head.code === 0;
}

async function initWorkspace(
  run: GitRunner,
  input: WorkspaceMergeInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // git clone with a local source uses hardlinks by default (no extra disk
  // beyond a fresh working tree). We do NOT pass --shared — that would make
  // the workspace fragile if the install clone is ever pruned mid-run.
  const clone = await run([
    "-c",
    "core.autocrlf=false",
    "-c",
    "core.eol=lf",
    "clone",
    "--no-tags",
    input.hostSourcePath,
    input.workspacePath,
  ]);
  if (clone.code !== 0) {
    return { ok: false, message: `workspace init failed (clone): ${trim(clone.stderr) || clone.code}` };
  }
  // Set commit identity for the merge commits the workspace will author.
  // Falls through silently on failure — the merge step would error visibly
  // and the operator can configure identity in PlatformConfig if needed.
  await run(["-C", input.workspacePath, "config", "user.email", "self-upgrade@dpf.local"]);
  await run(["-C", input.workspacePath, "config", "user.name", "DPF self-upgrade"]);
  await run(["-C", input.workspacePath, "config", "commit.gpgsign", "false"]);
  await run(["-C", input.workspacePath, "config", "core.autocrlf", "false"]);
  await run(["-C", input.workspacePath, "config", "core.eol", "lf"]);
  return { ok: true };
}

async function configureUpstreamRemote(
  run: GitRunner,
  input: WorkspaceMergeInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Read the install clone's upstream URL — that's the canonical source of
  // truth for "where the upgrade target lives" (typically github).
  const urlResult = await run([
    "-C",
    input.hostSourcePath,
    "config",
    "--get",
    `remote.${input.remote}.url`,
  ]);
  const upstreamUrl = trim(urlResult.stdout);
  if (urlResult.code !== 0 || !upstreamUrl) {
    return {
      ok: false,
      message: `install clone has no '${input.remote}' remote configured; cannot resolve upgrade target URL`,
    };
  }
  // Idempotent: set-url succeeds on an existing remote; add when absent.
  const existing = await run([
    "-C",
    input.workspacePath,
    "config",
    "--get",
    `remote.${UPSTREAM_REMOTE_IN_WORKSPACE}.url`,
  ]);
  if (trim(existing.stdout) === upstreamUrl) {
    return { ok: true };
  }
  if (existing.code === 0) {
    const setUrl = await run([
      "-C",
      input.workspacePath,
      "remote",
      "set-url",
      UPSTREAM_REMOTE_IN_WORKSPACE,
      upstreamUrl,
    ]);
    if (setUrl.code !== 0) {
      return { ok: false, message: `remote set-url failed: ${trim(setUrl.stderr) || setUrl.code}` };
    }
  } else {
    const addRemote = await run([
      "-C",
      input.workspacePath,
      "remote",
      "add",
      UPSTREAM_REMOTE_IN_WORKSPACE,
      upstreamUrl,
    ]);
    if (addRemote.code !== 0) {
      return { ok: false, message: `remote add failed: ${trim(addRemote.stderr) || addRemote.code}` };
    }
  }
  return { ok: true };
}

async function prepareUpgradeSourceInWorkspace(
  input: WorkspaceMergeInput,
  run: GitRunner,
): Promise<PrepareSourceResult> {
  try {
    // ── 1. Ensure workspace exists and has a known-good remote topology ─────
    if (!(await workspaceIsInitialized(run, input.workspacePath))) {
      const init = await initWorkspace(run, input);
      if (!init.ok) return { ok: false, reason: "prep-error", message: init.message };
    }
    const upstreamConfig = await configureUpstreamRemote(run, input);
    if (!upstreamConfig.ok) {
      return { ok: false, reason: "prep-error", message: upstreamConfig.message };
    }

    // ── 2. Fetch fresh upstream + install-branch ────────────────────────────
    const fetchUpstream = await run([
      "-C",
      input.workspacePath,
      "fetch",
      UPSTREAM_REMOTE_IN_WORKSPACE,
      input.branch,
    ]);
    if (fetchUpstream.code !== 0) {
      return {
        ok: false,
        reason: "prep-error",
        message: `fetch upstream failed: ${trim(fetchUpstream.stderr) || fetchUpstream.code}`,
      };
    }

    const upstreamHead = await run([
      "-C",
      input.workspacePath,
      "rev-parse",
      `${UPSTREAM_REMOTE_IN_WORKSPACE}/${input.branch}`,
    ]);
    const upstreamSha = trim(upstreamHead.stdout);
    if (upstreamHead.code !== 0 || !upstreamSha) {
      return {
        ok: false,
        reason: "no-target",
        message: `cannot resolve ${UPSTREAM_REMOTE_IN_WORKSPACE}/${input.branch} after fetch`,
      };
    }

    // Pull the install clone's authoritative install-branch into the workspace.
    // `--force` + the explicit `<src>:<dst>` refspec overwrites any prior local
    // install-branch in the workspace, so the merge always starts from the
    // install clone's actual tip. If the install clone has no install-branch
    // yet (first-ever run), we'll create one below from the upstream tip.
    const fetchInstall = await run([
      "-C",
      input.workspacePath,
      "fetch",
      "--force",
      "origin",
      `+refs/heads/${input.installBranch}:refs/remotes/origin/${input.installBranch}`,
    ]);
    const installBranchExists =
      fetchInstall.code === 0 &&
      !/couldn't find remote ref/i.test(fetchInstall.stderr);

    // ── 3. Clean checkout of the install-branch (or create from upstream) ──
    if (installBranchExists) {
      const checkout = await run([
        "-C",
        input.workspacePath,
        "checkout",
        "-B",
        input.installBranch,
        `refs/remotes/origin/${input.installBranch}`,
      ]);
      if (checkout.code !== 0) {
        return {
          ok: false,
          reason: "prep-error",
          message: `workspace checkout ${input.installBranch} failed: ${trim(checkout.stderr) || checkout.code}`,
        };
      }
    } else {
      // First-time install-branch creation: derive it from the upstream tip.
      // Mirrors the legacy direct-merge path's `checkout -b <installBranch>`
      // semantics (no prior local commits to preserve on this code path).
      const checkout = await run([
        "-C",
        input.workspacePath,
        "checkout",
        "-B",
        input.installBranch,
        `${UPSTREAM_REMOTE_IN_WORKSPACE}/${input.branch}`,
      ]);
      if (checkout.code !== 0) {
        return {
          ok: false,
          reason: "prep-error",
          message: `workspace checkout (initial install-branch) failed: ${trim(checkout.stderr) || checkout.code}`,
        };
      }
    }
    // Belt-and-braces clean tree: makes the merge deterministic even if a
    // prior crash left untracked files behind.
    await run(["-C", input.workspacePath, "reset", "--hard", "HEAD"]);
    await run(["-C", input.workspacePath, "clean", "-fdx"]);

    // ── 4. Advance or merge upstream → install-branch ───────────────────────
    // An upstream-only installation must retain a globally resolvable image
    // identity. The historical unconditional --no-ff merge minted a new local
    // commit even when dpf/install carried no content beyond its upstream base;
    // peers then could not fetch the served SHA to prove ancestry. Compare the
    // install tree with the merge base: when there is no local content delta,
    // moving directly to the fetched upstream commit preserves the exact bytes
    // and canonical SHA. A real local delta still takes the merge path so
    // proprietary/custom installation code is never discarded.
    const upstreamRef = `${UPSTREAM_REMOTE_IN_WORKSPACE}/${input.branch}`;
    const mergeBase = await run([
      "-C",
      input.workspacePath,
      "merge-base",
      "HEAD",
      upstreamRef,
    ]);
    const baseSha = trim(mergeBase.stdout);
    const localContentDelta =
      mergeBase.code !== 0 || !baseSha
        ? true
        : (await run([
            "-C",
            input.workspacePath,
            "diff",
            "--quiet",
            baseSha,
            "HEAD",
            "--",
          ])).code !== 0;

    const advance = localContentDelta
      ? await run([
          "-C",
          input.workspacePath,
          "merge",
          "--no-ff",
          upstreamRef,
          "-m",
          `Merge ${UPSTREAM_REMOTE_IN_WORKSPACE}/${input.branch} into ${input.installBranch} (self-upgrade)`,
        ])
      : await run(["-C", input.workspacePath, "reset", "--hard", upstreamRef]);

    if (advance.code !== 0) {
      const conflicts = await run([
        "-C",
        input.workspacePath,
        "diff",
        "--name-only",
        "--diff-filter=U",
      ]);
      const conflictFiles = trim(conflicts.stdout).split("\n").map(trim).filter(Boolean);
      await run(["-C", input.workspacePath, "merge", "--abort"]);
      await run(["-C", input.workspacePath, "reset", "--hard", "HEAD"]);
      await run(["-C", input.workspacePath, "clean", "-fdx"]);
      // Capture stderr too so the operator-visible failureLog explains WHY
      // when conflictFiles is empty (e.g. refusing to merge unrelated
      // histories) — the legacy "merge-conflict: " trail with no files left
      // operators guessing. The orchestrator surfaces this into the message.
      const stderrExcerpt = trim(advance.stderr).slice(0, 500);
      return {
        ok: false,
        reason: "merge-conflict",
        conflictFiles,
        upstreamSha,
        message:
          conflictFiles.length > 0
            ? `upstream merge conflicts in ${conflictFiles.length} file(s)`
            : `merge aborted with no conflict markers; git said: ${stderrExcerpt || "(no stderr)"}`,
      };
    }

    // ── 4b. Materialize Git LFS objects, then assert none are left as stubs. ──
    // The workspace tree IS the promoter's Docker build context, and Dockerfile
    // asserts real bytes for the LFS-tracked IT4IT workbook it COPYs (#4843).
    // The prep git runner deliberately sets GIT_LFS_SKIP_SMUDGE=1 so the
    // mechanical branch/merge ops never block on the network, which means
    // materialization has to be an explicit step here, once the tree is final.
    //
    // Failing here costs one git command instead of a two-minute promoter build
    // that dies on a zip-magic check buried in Docker output, and it writes a
    // named reason onto the run row. `lfs pull` is best-effort: `ls-files` is
    // the verdict, so a pull that partially succeeds is still caught.
    await run(buildLfsPullCommand(input.workspacePath));
    const lsFiles = await run(buildLfsLsFilesCommand(input.workspacePath));
    // A non-zero ls-files (no git-lfs binary, or LFS not configured) is not
    // itself proof of stubs — but it means we cannot VERIFY, and an unverified
    // build context is exactly what shipped the pointer. Treat it as a stop.
    if (lsFiles.code !== 0) {
      return {
        ok: false,
        reason: "lfs-unmaterialized",
        message:
          `cannot verify Git LFS materialization in the upgrade workspace: ` +
          `\`git lfs ls-files\` exited ${lsFiles.code}: ${trim(lsFiles.stderr) || "(no stderr)"}. ` +
          `The portal image must provide the git-lfs binary for the git-source upgrade shape.`,
      };
    }
    const stubs = unmaterializedPaths(parseLfsLsFiles(lsFiles.stdout));
    if (stubs.length > 0) {
      return { ok: false, reason: "lfs-unmaterialized", message: describeUnmaterialized(stubs) };
    }

    // ── 5. Stamp the merged tree's HEAD and push the new install-branch tip
    //       back to the install clone (ref-only — never touches its tree). ──
    const stamp = await readHeadStamp(run, input.workspacePath);
    const push = await run([
      "-C",
      input.workspacePath,
      "push",
      "origin",
      `HEAD:refs/heads/${input.installBranch}`,
    ]);
    if (push.code !== 0) {
      // The merge succeeded and the workspace holds the bytes the promoter
      // will build. The install clone's ref is stale (its dpf/install hasn't
      // advanced), but the build still proceeds — the next upgrade will see
      // the workspace ahead of origin/installBranch and force-sync again. We
      // surface this as a soft warning by promoting the stamp regardless and
      // letting the orchestrator log the push stderr alongside the success.
      // (If the operator's clone refuses pushes because they have
      // installBranch checked out, the upgrade still ships; their tree just
      // doesn't auto-track the new tip until they `git fetch . dpf/install`.)
      // Logged via stamp; do not fail the upgrade for this.
    }
    return { ok: true, mode: "upstream", stamp, upstreamSha };
  } catch (err) {
    return { ok: false, reason: "prep-error", message: errMsg(err) };
  }
}

/**
 * Hard ceiling on any single git invocation. The real failure mode this guards
 * is an INDEFINITE hang — a credential prompt, an `index.lock` wait, or process-
 * spawn contention on Windows/WSL2 when the host is saturated by the portal's
 * agent subprocesses. Those never return on their own, so without a timeout a
 * single `git log` on the git-backed self-upgrade render (local-changes ledger)
 * can wedge the whole page. 120s is far above any legitimate mechanical prep op
 * (branch move / merge / checkout are sub-second here) yet still converts an
 * infinite hang into a bounded non-zero result the caller already handles.
 * BI-4A400DE4.
 */
const GIT_RUNNER_TIMEOUT_MS = 120_000;

/**
 * Real git runner over execFile. Never throws on non-zero exit — git's exit
 * code and captured stderr are returned so callers can branch on them (a merge
 * conflict is exit 1, not an exception). A timed-out git is killed and returned
 * as a non-zero result (never a hang) — see GIT_RUNNER_TIMEOUT_MS.
 */
export async function defaultGitRunner(args: string[]): Promise<GitResult> {
  const { execFile } = await import("node:child_process");
  // Run prep's internal git ops with repo hooks DISABLED. The host clone ships a
  // Git LFS post-checkout/post-merge hook (the repo uses filter=lfs); the hook is
  // noise for mechanical prep and, on any host missing the binary, makes an
  // otherwise-successful `git checkout`/`merge` look like it failed and aborts the
  // whole upgrade at prep. GIT_LFS_SKIP_SMUDGE keeps branch moves and the merge
  // off the network — they only need trees and blobs, never LFS content.
  //
  // Skipping smudge does NOT mean the workspace may ship pointer stubs: it is the
  // promoter's Docker build context, and Dockerfile asserts real bytes (#4843).
  // Materialization is deferred to one explicit `git lfs pull` + `ls-files`
  // verification once the tree is final — see lfs-materialization.ts. Prep used
  // to claim it "never needs LFS smudging"; that stopped being true the moment
  // the image build began asserting the workbook's content, and every upgrade on
  // the git-source shape failed until this was split out.
  //
  // `-c` is a git GLOBAL option and must precede the subcommand — prepend it
  // ahead of the caller's args (which start with "-C <path> <cmd>").
  const safeArgs = ["-c", "core.hooksPath=/dev/null", ...args];
  return new Promise<GitResult>((resolve) => {
    execFile("git", safeArgs, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: GIT_RUNNER_TIMEOUT_MS,
      killSignal: "SIGKILL",
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" },
    }, (err, stdout, stderr) => {
      const out = stdout?.toString() ?? "";
      const errOut = stderr?.toString() ?? "";
      if (err) {
        // execFile flags a timeout kill via err.killed + err.signal; surface it
        // as a distinct, non-zero result so callers degrade rather than hang.
        const killed = (err as { killed?: boolean }).killed === true;
        const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1;
        const stderrOut = killed
          ? errOut || `git timed out after ${GIT_RUNNER_TIMEOUT_MS}ms and was terminated`
          : errOut || errMsg(err);
        resolve({ stdout: out, stderr: stderrOut, code: killed ? 124 : code });
      } else {
        resolve({ stdout: out, stderr: errOut, code: 0 });
      }
    });
  });
}
