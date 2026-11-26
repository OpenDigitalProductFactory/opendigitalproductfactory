
// BI-224F56F1: implemented once in ../../../../scripts/lib/upgrade-source/prepare-source.mjs so the
// authorized source writer (promoter image) and the portal share one
// definition of upgrade-source preparation.
import type { UpgradeSourceMode } from "./config";
import * as impl from "../../../../scripts/lib/upgrade-source/prepare-source.mjs";

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
  /** Delay between retries of the host-clone remote read (tests pass 0). */
  remoteReadRetryDelayMs?: number;
  /** Base backoff between upstream-fetch retries after a network failure (tests pass 0). */
  networkRetryDelayMs?: number;
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

// The shared module is plain JS; this declared signature is the contract.
export const prepareUpgradeSource = impl.prepareUpgradeSource as unknown as
  (input: PrepareSourceInput, run: GitRunner) => Promise<PrepareSourceResult>;
/** Real git runner over execFile. Never throws on non-zero exit. */
export const defaultGitRunner: GitRunner = impl.defaultGitRunner;
