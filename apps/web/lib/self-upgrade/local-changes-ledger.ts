/**
 * Local-changes ledger — Private/Public Change Segregation (EP-1A78BAE1).
 *
 * Lists the commits on the durable install branch (`dpf/install`) whose CONTENT
 * is NOT upstream — i.e. the changes the operator has kept on their own system
 * and not shared with the community. This answers, in plain language, "what have
 * we kept private?"
 *
 * BI-75C4A412: a plain two-dot commit range (`upstream..installBranch`) over-
 * reports. Shared changes flow upstream and return via the self-upgrade merge,
 * but upstream squash-rebases them, so the returned commit has a DIFFERENT sha —
 * the operator's original commit is still not reachable from upstream and a
 * commit-range would keep counting it as "private". We instead compare by
 * CONTENT: `--cherry-pick --right-only` over a three-dot (`...`) symmetric range
 * drops any install-branch commit that is patch-equivalent to one already
 * upstream, leaving only the genuinely-private delta.
 *
 * Pure parsing/collection here (unit-tested over a GitRunner); the server
 * resolver `getLocalChangesLedger` wires the live install path + config.
 */

import type { GitRunner } from "./prepare-source";

export interface LocalChange {
  sha: string;
  subject: string;
  date: string;
}

export interface LocalChangesResult {
  available: boolean;
  note?: string;
  changes: LocalChange[];
}

// Unit separator — safe field delimiter for `git log --format`.
const SEP = "\x1f";
export const LEDGER_LOG_FORMAT = `%H${SEP}%s${SEP}%aI`;

/** Parse `git log --format=%H<SEP>%s<SEP>%aI` output into LocalChange rows. */
export function parseLedgerLog(stdout: string): LocalChange[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, date] = line.split(SEP);
      return { sha: (sha ?? "").slice(0, 12), subject: subject ?? "", date: date ?? "" };
    })
    .filter((c) => c.sha.length > 0);
}

export interface CollectOptions {
  hostSourcePath: string;
  remote: string;
  branch: string;
  installBranch: string;
  max?: number;
}

/**
 * Collect local-only commits (on installBranch, not in remote/branch). Never
 * throws: a non-git install (consumer mode) or an unset install branch returns
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

  // Three-dot symmetric range + --cherry-pick --right-only = install-branch
  // commits whose patch is NOT already upstream (content diff, not sha range).
  // See BI-75C4A412 note above.
  const range = `${remote}/${branch}...${installBranch}`;
  const res = await run([
    "-C", hostSourcePath, "log", "--no-merges", "--cherry-pick", "--right-only",
    `--max-count=${max}`, `--format=${LEDGER_LOG_FORMAT}`, range,
  ]);
  if (res.code !== 0) {
    return {
      available: false,
      note: "Could not read the local-changes list yet (the install branch or community reference may not be set up).",
      changes: [],
    };
  }

  return { available: true, changes: parseLedgerLog(res.stdout) };
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
