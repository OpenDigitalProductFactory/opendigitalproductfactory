/**
 * Local-changes ledger — Private/Public Change Segregation (EP-1A78BAE1).
 *
 * Reports what this install keeps that the community version does NOT have,
 * measured by CONTENT, not by commit identity.
 *
 * Why content, not commits: the public workflow squash-merges PRs (§4). A squash
 * collapses N branch commits into one new commit on the community `main` with a
 * fresh SHA; the install branch keeps the original unsquashed commits, which
 * never match that squash by commit- or patch-identity. A commit-range
 * (`origin/main..dpf/install`) therefore lists every squash-merged change as
 * "private" forever — on this repo that was 4,707 commits, ~2,300 of them
 * carrying a (#NNNN) PR number (i.e. provably public). `git cherry` /
 * `--cherry-pick` cannot rescue it — patch-id can't match a squash either.
 *
 * The honest signal is the three-dot tree diff `<remote>/<branch>...<install>`:
 * the content the install ADDED on its own side since the merge-base with the
 * community reference. Work that was squash-merged upstream and returned through
 * the self-upgrade merge sits at/below the merge-base, so it is excluded; and
 * upstream changes the install has not merged yet ("behind") are on the other
 * side of the merge-base, so they are excluded too. What remains is exactly the
 * private delta — empty when nothing is kept private.
 *
 * Pure parsing/collection here (unit-tested over a GitRunner); the server
 * resolver `getLocalChangesLedger` wires the live install path + config.
 */

import type { GitRunner } from "./prepare-source";

/** A file whose content differs on the install side (the private delta). */
export interface LocalChange {
  path: string;
  added: number;
  deleted: number;
}

export interface LocalChangesResult {
  available: boolean;
  note?: string;
  changes: LocalChange[];
}

/**
 * Parse `git diff --numstat` output into LocalChange rows. Each line is
 * `<added>\t<deleted>\t<path>`; binary files report `-` for the counts (kept as
 * 0). Paths are taken verbatim (no rename arrows — the caller passes
 * `--no-renames`).
 */
export function parseNumstat(stdout: string): LocalChange[] {
  return stdout
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.trim().length > 0)
    .map((line): LocalChange | null => {
      const parts = line.split("\t");
      if (parts.length < 3) return null;
      const [addedRaw, deletedRaw, ...rest] = parts;
      const path = rest.join("\t").trim();
      if (path.length === 0) return null;
      const added = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10) || 0;
      const deleted = deletedRaw === "-" ? 0 : Number.parseInt(deletedRaw, 10) || 0;
      return { path, added, deleted };
    })
    .filter((c): c is LocalChange => c !== null);
}

export interface CollectOptions {
  hostSourcePath: string;
  remote: string;
  branch: string;
  installBranch: string;
  max?: number;
}

/**
 * Collect the private content delta: files the install branch added on its own
 * side since the merge-base with the community reference (three-dot diff). Never
 * throws: a non-git install (consumer mode) or an unresolvable reference returns
 * `available: false` with a plain-language note instead of an error.
 */
export async function collectLocalChanges(run: GitRunner, opts: CollectOptions): Promise<LocalChangesResult> {
  const { hostSourcePath, remote, branch, installBranch, max = 200 } = opts;

  const isRepo = await run(["-C", hostSourcePath, "rev-parse", "--is-inside-work-tree"]);
  if (isRepo.code !== 0) {
    return {
      available: false,
      note: "This install does not track changes in git, so there is no local-changes list to show.",
      changes: [],
    };
  }

  // Three-dot: diff the merge-base(community, install) against the install tip —
  // i.e. only the content the install added on its own side. Commit identity is
  // deliberately NOT used (squash-merges destroy it); the tree is the truth.
  const range = `${remote}/${branch}...${installBranch}`;
  const res = await run(["-C", hostSourcePath, "diff", "--numstat", "--no-renames", range]);
  if (res.code !== 0) {
    return {
      available: false,
      note: "Could not read the local-changes list yet (the install branch or community reference may not be set up).",
      changes: [],
    };
  }

  return { available: true, changes: parseNumstat(res.stdout).slice(0, max) };
}

/** Server resolver: read the live install's config + run git. */
export async function getLocalChangesLedger(): Promise<LocalChangesResult> {
  try {
    const { getSelfUpgradeConfig } = await import("./config");
    const { defaultGitRunner } = await import("./prepare-source");
    const config = await getSelfUpgradeConfig();
    const hostSourcePath = config.hostSourceMountPath ?? process.env.HOST_SOURCE_PATH ?? "/workspace";
    return await collectLocalChanges(defaultGitRunner, {
      hostSourcePath,
      remote: config.repositoryRemote ?? "origin",
      branch: config.repositoryBranch ?? "main",
      installBranch: config.installBranch,
    });
  } catch {
    return { available: false, note: "The local-changes list is unavailable right now.", changes: [] };
  }
}
