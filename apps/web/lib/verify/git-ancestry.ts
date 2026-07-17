// Pure helpers + git ancestry IO for live-install preflight (BI-08BE758C).
// Spec: docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md
//
// Portal processes often lack a .git directory at process.cwd(). Without a repo
// root (or when SHAs are abbreviated / objects are missing), merge-base exits
// non-1 and the old path returned null → BLOCKED "ancestry was not computable"
// with no actionable cause. These helpers: (1) treat equal/prefix SHAs as
// contained, (2) try multiple repo roots, (3) classify failures for a useful
// nextAction detail.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Git hex SHA fragment (abbreviated or full). */
const SHA_HEX = /^[0-9a-f]{7,40}$/i;

/**
 * When feature and served are the same commit (full or abbreviated prefix
 * match in either direction), containment is true without consulting git.
 * Pure — used by gitAncestry and unit-tested.
 */
export function shasEqualOrPrefix(feature: string, served: string): boolean {
  const a = feature.trim().toLowerCase();
  const b = served.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (!SHA_HEX.test(a) || !SHA_HEX.test(b)) return false;
  // Only treat as equal when one is a proper prefix of the other (abbrev vs full).
  return a.startsWith(b) || b.startsWith(a);
}

export type AncestryFailureKind =
  | "not-ancestor"
  | "missing-object"
  | "no-git"
  | "no-repo"
  | "unknown";

/**
 * Classify a failed `git merge-base --is-ancestor` (or rev-parse) error so the
 * preflight nextAction can tell the operator what to do. Pure over message/code.
 */
export function classifyGitAncestryFailure(err: {
  code?: number | string;
  message?: string;
  stderr?: string;
}): AncestryFailureKind {
  const code = typeof err.code === "number" ? err.code : Number(err.code);
  if (code === 1) return "not-ancestor";

  const text = `${err.message ?? ""}\n${err.stderr ?? ""}`.toLowerCase();
  if (
    text.includes("not a git repository") ||
    text.includes("not a git dir") ||
    text.includes("unable to find current revision")
  ) {
    return "no-repo";
  }
  if (
    text.includes("not a valid object name") ||
    text.includes("bad object") ||
    text.includes("unknown revision") ||
    text.includes("needed a single revision") ||
    text.includes("ambiguous argument")
  ) {
    return "missing-object";
  }
  if (
    text.includes("enoent") ||
    text.includes("not found") ||
    text.includes("spawn git") ||
    err.code === "ENOENT"
  ) {
    return "no-git";
  }
  return "unknown";
}

/** Human detail for preflight nextAction when ancestry is uncomputable. */
export function ancestryFailureDetail(kind: AncestryFailureKind): string {
  switch (kind) {
    case "not-ancestor":
      return "Feature commit is not an ancestor of the served SHA — advance via /ops/self-upgrade.";
    case "missing-object":
      return "One or both commits are missing from the local git object store. On the host that owns the portal source: git fetch --no-tags origin main, then re-run the preflight. If still missing, set DPF_REPO_ROOT to the clone that has both SHAs.";
    case "no-repo":
      return "No git repository found at process.cwd() or DPF_REPO_ROOT. Point DPF_REPO_ROOT at the DPF clone (or mount .git into the portal) so ancestry can be computed.";
    case "no-git":
      return "git binary is not available in this process. Install git on the portal host or run preflight from a host that has git + the repo.";
    default:
      return "Fetch the served and feature commits (git fetch) with DPF_REPO_ROOT set to the clone, then re-run the preflight. If still uncomputable, file a blocker BI and stop.";
  }
}

/**
 * Candidate directories to run git ancestry in. Pure over env + cwd so tests
 * can inject without mutating process.env.
 */
/**
 * Well-known in-container / install mounts that often hold the DPF clone even
 * when DPF_REPO_ROOT was never exported into the portal process (BI-1D55A2AD).
 * Order is least→most specific so env still wins via push-first.
 */
export const WELL_KNOWN_PORTAL_REPO_ROOTS = Object.freeze([
  "/host-dpf", // docker-compose host install bind (DPF_HOST_INSTALL_PATH)
  "/host-source", // promoter / self-upgrade host source mount
  "/workspace", // dpf-source-code volume used by some portal images
]);

export function gitRepoRootCandidates(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string[] {
  const roots: string[] = [];
  const push = (v: string | undefined) => {
    const t = (v ?? "").trim();
    if (t && !roots.includes(t)) roots.push(t);
  };
  push(env.DPF_REPO_ROOT);
  push(env.DPF_GIT_WORK_TREE);
  push(env.PROJECT_ROOT);
  // GIT_DIR is a .git path — use its parent as work tree when it ends with .git
  const gitDir = (env.GIT_DIR ?? "").trim();
  if (gitDir.endsWith("/.git") || gitDir.endsWith("\\.git")) {
    push(gitDir.slice(0, -5));
  } else {
    push(gitDir || undefined);
  }
  // Portal containers often do not have process.cwd() === the Git work tree
  // (Next runs under /app). Always try the compose-standard host mounts so a
  // normal local install can compute ancestry without ad-hoc discovery.
  for (const wellKnown of WELL_KNOWN_PORTAL_REPO_ROOTS) {
    push(wellKnown);
  }
  push(cwd);
  return roots;
}

export type GitAncestryResult = {
  contained: boolean | null;
  failureKind?: AncestryFailureKind;
  /** Repo root that succeeded, when any. */
  repoRoot?: string;
};

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ ok: true; stdout: string } | { ok: false; err: { code?: number | string; message?: string; stderr?: string } }> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 256 * 1024,
      env: process.env,
    });
    return { ok: true, stdout: String(stdout ?? "") };
  } catch (e) {
    const err = e as { code?: number | string; message?: string; stderr?: string | Buffer };
    return {
      ok: false,
      err: {
        code: err.code,
        message: err.message,
        stderr: err.stderr != null ? String(err.stderr) : undefined,
      },
    };
  }
}

/**
 * Whether `feature` is an ancestor-or-equal of `served`. Never throws.
 * Returns `{ contained: null, failureKind }` when uncomputable so callers can
 * surface an actionable remedy (BI-08BE758C).
 */
export async function resolveGitAncestry(
  feature: string,
  served: string,
  opts?: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    /** Injectable for tests — defaults to real git. */
    run?: typeof runGit;
  },
): Promise<GitAncestryResult> {
  if (shasEqualOrPrefix(feature, served)) {
    return { contained: true };
  }

  const run = opts?.run ?? runGit;
  const roots = gitRepoRootCandidates(opts?.env ?? process.env, opts?.cwd ?? process.cwd());
  let lastKind: AncestryFailureKind = "unknown";

  for (const root of roots) {
    // Confirm this root is a git work tree before merge-base.
    const probe = await run(["rev-parse", "--is-inside-work-tree"], root);
    if (!probe.ok) {
      lastKind = classifyGitAncestryFailure(probe.err);
      continue;
    }

    const mb = await run(
      ["merge-base", "--is-ancestor", feature.trim(), served.trim()],
      root,
    );
    if (mb.ok) {
      return { contained: true, repoRoot: root };
    }
    const kind = classifyGitAncestryFailure(mb.err);
    if (kind === "not-ancestor") {
      return { contained: false, failureKind: "not-ancestor", repoRoot: root };
    }
    lastKind = kind;
  }

  return { contained: null, failureKind: lastKind };
}
