// DEPRECATED — Phase 3 of BI-063BDF1B replaced the per-request runner shape
// with DB-backed snapshot reads in read-model.ts. This file is left on disk
// for one rollback window; deletion ships in Phase 8 of
// docs/superpowers/plans/2026-05-26-contributor-inventory-sync.md.
//
// No caller imports this module today. The local `LegacyInventoryRunners`
// type is the contract the page server-component used pre-Phase 3.

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BUFFER = 4 * 1024 * 1024;

/**
 * @deprecated Removed from active read-model in Phase 3. The new read-model
 * resolves snapshot sources from ContributorInventorySnapshot rows.
 */
export type LegacyInventoryRunners = {
  runGitWorktreeList: () => Promise<string>;
  runGitForEachRef: () => Promise<string>;
  runGhPrList: () => Promise<string>;
  listFilesystemWorktreePaths: () => Promise<string[]>;
};

export type NodeRunnerOptions = {
  repoCwd: string;
  worktreeRoot?: string;
  timeoutMs?: number;
};

/** @deprecated See file-header note. */
export function createNodeInventoryRunners(
  options: NodeRunnerOptions,
): LegacyInventoryRunners {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.repoCwd;

  return {
    runGitWorktreeList: async () => {
      const { stdout } = await execFileAsync("git", ["worktree", "list", "--porcelain"], {
        cwd,
        timeout,
        maxBuffer: MAX_BUFFER,
      });
      return stdout;
    },
    runGitForEachRef: async () => {
      const { stdout } = await execFileAsync(
        "git",
        [
          "for-each-ref",
          "--format=%(refname)\t%(objectname)\t%(committerdate:iso-strict)\t%(if)%(upstream:trackshort)%(then)%(else)%(end)",
          "refs/remotes/origin/",
        ],
        {
          cwd,
          timeout,
          maxBuffer: MAX_BUFFER,
        },
      );
      return stdout;
    },
    runGhPrList: async () => {
      const { stdout } = await execFileAsync(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "200",
          "--json",
          "number,title,headRefName,baseRefName,isDraft,mergeStateStatus,url,state",
        ],
        {
          cwd,
          timeout,
          maxBuffer: MAX_BUFFER,
        },
      );
      return stdout;
    },
    listFilesystemWorktreePaths: async () => {
      if (!options.worktreeRoot) return [];
      try {
        const entries = await readdir(options.worktreeRoot, { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory())
          .map((e) => path.join(options.worktreeRoot!, e.name).replace(/\\/g, "/"));
      } catch {
        return [];
      }
    },
  };
}
