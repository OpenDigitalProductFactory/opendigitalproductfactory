/**
 * Recompute the gauntlet's gate identity for a build's CURRENT tree, so a
 * consumer can look up the record the producer wrote (BI-0700B79C).
 *
 * This is the half that makes tree keying useful. The producer derives a key
 * when it records a result; a consumer has to derive the SAME key before it
 * knows anything about the result, purely from what is on disk now. That is why
 * the plan digest hashes the plan and never the outcome.
 */
import { guardPlanDigest, readWorktreeTreeSha, type SandboxExec } from "@/lib/build/sandbox/guard-gauntlet";
import { toolchainFingerprintFrom } from "@/lib/build/sandbox/guard-gauntlet-evidence";

export const GAUNTLET_SCRIPT_PATH = "scripts/pregate-preflight.mjs";

export type GauntletIdentity = {
  repository: string;
  /** Null when the tree cannot be identified; the caller must refuse, not assume. */
  treeSha: string | null;
  guardPlanDigest: string | null;
  toolchainFingerprint: string | null;
};

/**
 * Read the build worktree's current tree and toolchain.
 *
 * Every field is independently nullable because a partial identity must not be
 * silently completed with a guess — an unreadable toolchain is not the same as a
 * known one, and the caller refuses on either.
 */
export async function runGuardGauntletIdentity(input: {
  containerId: string;
  buildId: string;
  repository: string;
  exec?: SandboxExec;
  resolveWorkdir?: (buildId: string) => string;
}): Promise<GauntletIdentity> {
  const exec = input.exec ?? (await import("@/lib/sandbox")).execInSandbox;
  const resolveWorkdir = input.resolveWorkdir
    ?? (await import("@/lib/build/sandbox/build-branch")).resolveBuildWorkdir;
  const workdir = resolveWorkdir(input.buildId);

  const treeSha = await readWorktreeTreeSha(exec, input.containerId, workdir);

  let toolchainFingerprint: string | null = null;
  try {
    const raw = await exec(input.containerId, "node -v 2>/dev/null; pnpm -v 2>/dev/null");
    const [node, pnpm] = raw.split(/\r?\n/);
    // An empty read is not a toolchain: leaving it null makes the caller refuse
    // rather than match against a fingerprint of nothing.
    if (node?.trim()) toolchainFingerprint = toolchainFingerprintFrom({ node: node.trim(), pnpm: pnpm?.trim() });
  } catch {
    toolchainFingerprint = null;
  }

  return {
    repository: input.repository,
    treeSha,
    guardPlanDigest: treeSha ? guardPlanDigest(GAUNTLET_SCRIPT_PATH) : null,
    toolchainFingerprint,
  };
}
