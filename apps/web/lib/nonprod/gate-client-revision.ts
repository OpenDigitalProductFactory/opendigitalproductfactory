/**
 * Server-side floor on the local-CI gate CLIENT a claim comes from.
 *
 * The gate client (`scripts/gate-worktree.mjs` and the durable-wait resumer it
 * spawns) runs from the branch being gated, not from the install. A client-side
 * defect fixed on main therefore keeps running in every branch cut before the
 * fix, on every developer host, until each branch rebases - and no rollout of
 * the install can reach it. The only party every gate client talks to, and the
 * only one that upgrades with the platform, is this admission endpoint. So a
 * client defect that harms the host is retired HERE: the server refuses claims
 * from clients below the floor with a non-retryable answer that tells the
 * author to rebase. That answer also stops a stale resumer, because a refusal
 * is neither "queued" nor a transient block.
 *
 * `platform-function-never-depends-on-a-client`: the guarantee lives server
 * side; each client only reports its revision.
 *
 * Raising the floor: bump GATE_CLIENT_REVISION in scripts/lib/gate-client-revision.mjs
 * in the same change as the client fix, then add a floor entry below naming
 * the defect. Scope a floor to the platforms the defect actually harms, so an
 * unaffected host is never forced to rebase for nothing.
 */

export type GateClientPlatform = "win32" | "posix";

export interface GateClientFloor {
  /** Lowest client revision admitted on the platforms below. */
  minimumRevision: number;
  platforms: readonly GateClientPlatform[];
  /** Plain-language description of the defect that set this floor. */
  reason: string;
}

export const GATE_CLIENT_FLOORS: readonly GateClientFloor[] = Object.freeze([
  {
    minimumRevision: 1,
    platforms: ["win32"],
    reason:
      "gate clients before revision 1 open a visible, focus-stealing terminal window on every "
      + "durable-wait re-claim on Windows hosts",
  },
]);

/**
 * Infer the host platform from the claim's worktree path. A drive-letter or
 * UNC path is Windows; anything else is POSIX. No path means we cannot tell,
 * and an unknown platform is admitted: this floor protects the host from a
 * known client defect, it is not a reason to refuse a claim we cannot place.
 */
export function inferGateClientPlatform(worktreePath: string | undefined): GateClientPlatform | null {
  if (!worktreePath) return null;
  if (/^[A-Za-z]:[\\/]/.test(worktreePath) || worktreePath.startsWith("\\\\")) return "win32";
  if (worktreePath.startsWith("/")) return "posix";
  return null;
}

/** A client that reports no revision predates the field: revision 0. */
export function normalizeGateClientRevision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Is this claim from the gate client (`scripts/gate-worktree.mjs`)? The floor
 * governs that client only - the pre-push infrastructure probe and the dev
 * portal lease also claim local-integration-ci and carry none of its defects.
 * Current clients say so by reporting a revision. Clients from before the
 * revision field existed are recognised by the claim purpose every gate client
 * has sent since 2026-07-25, which predates the durable-wait resumer.
 */
export const GATE_CLIENT_PURPOSE_PREFIX = "Pre-PR local-CI gate for ";

export function isGateClientClaim(input: { clientRevision: unknown; purpose: string | undefined }): boolean {
  if (input.clientRevision !== undefined) return true;
  return typeof input.purpose === "string" && input.purpose.startsWith(GATE_CLIENT_PURPOSE_PREFIX);
}

export interface GateClientRefusal {
  minimumRevision: number;
  clientRevision: number;
  platform: GateClientPlatform;
  reason: string;
}

export function evaluateGateClientRevision(input: {
  clientRevision: unknown;
  worktreePath: string | undefined;
  purpose: string | undefined;
  floors?: readonly GateClientFloor[];
}): GateClientRefusal | null {
  if (!isGateClientClaim(input)) return null;
  const platform = inferGateClientPlatform(input.worktreePath);
  if (!platform) return null;
  const clientRevision = normalizeGateClientRevision(input.clientRevision);
  let refusal: GateClientRefusal | null = null;
  for (const floor of input.floors ?? GATE_CLIENT_FLOORS) {
    if (!floor.platforms.includes(platform)) continue;
    if (clientRevision >= floor.minimumRevision) continue;
    if (!refusal || floor.minimumRevision > refusal.minimumRevision) {
      refusal = { minimumRevision: floor.minimumRevision, clientRevision, platform, reason: floor.reason };
    }
  }
  return refusal;
}
