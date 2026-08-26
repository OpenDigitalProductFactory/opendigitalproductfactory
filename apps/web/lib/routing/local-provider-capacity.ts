import { listCapacityReservingNonprodEnvironmentLeases } from "@/lib/nonprod/environment-lease";
import { isLocalProviderId } from "./provider-locality";

export type LocalProviderCapacityDeferralReason =
  | "local-ci-active-capacity-reservation"
  | "local-ci-queued-capacity-reservation"
  | "local-ci-capacity-reservation-unavailable";

export type LocalProviderCapacityStatus =
  | { available: true; reason: null; expectedFreeAt?: null }
  | {
    available: false;
    reason: LocalProviderCapacityDeferralReason;
    /**
     * When the blocking claim's own contract says the host comes free
     * (BI-94D44FDB). Null when nothing is blocking us that we can read — an
     * unproven-capacity deferral has no window to report.
     */
    expectedFreeAt?: Date | null;
  };

type LeaseReader = () => Promise<Array<{
  environmentKey: string;
  status?: string;
  claimKey?: string | null;
  expiresAt?: Date | null;
}>>;

/**
 * Does this lease actually contend for local INFERENCE capacity?
 *
 * The local-integration-ci environment is shared by two very different
 * consumers. The pre-PR CI gate runs tests and builds, and genuinely competes
 * with the local model for the host. The contributor preview (:3001) only binds
 * a port and a worktree — it runs no inference at all.
 *
 * Treating both alike meant a preview claim suspended every AI coworker on the
 * install. Worse, a preview client that retries a refused claim enqueues a new
 * row each time (BI-D933A328), so a permanently non-empty queue became a
 * permanent outage of the platform's own AI: builds sat unable to advance while
 * the owner-facing surface reported "Waiting for AI capacity".
 *
 * A port binding is not an inference workload, so it must not reserve the GPU.
 */
function contendsForInference(lease: { claimKey?: string | null }): boolean {
  return !(lease.claimKey ?? "").startsWith("dev-portal:");
}

export class LocalProviderCapacityDeferredError extends Error {
  constructor(
    public readonly reason: LocalProviderCapacityDeferralReason,
    /**
     * When the blocking claim's contract says the host comes free
     * (BI-94D44FDB). Carried on the error so the owner-facing reply can name a
     * window instead of an open-ended wait: measured over seven days on the
     * live install, a real gate holds the host for ~195s on average, which is
     * short enough to wait out and far too long to leave unexplained.
     */
    public readonly expectedFreeAt: Date | null = null,
  ) {
    super(`Local provider dispatch deferred: ${reason}`);
    this.name = "LocalProviderCapacityDeferredError";
  }
}

/** The soonest a blocking claim releases the host, or null if none is readable. */
function earliestExpiry(
  leases: ReadonlyArray<{ expiresAt?: Date | null }>,
): Date | null {
  const times = leases
    .map((lease) => lease.expiresAt)
    .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));
  if (times.length === 0) return null;
  return times.reduce((soonest, next) => (next < soonest ? next : soonest));
}

/** Authoritative host-capacity policy shared by every local inference boundary. */
export async function inspectLocalProviderCapacity(input: {
  listCapacityLeases?: LeaseReader;
} = {}): Promise<LocalProviderCapacityStatus> {
  const listCapacityLeases = input.listCapacityLeases
    ?? (() => listCapacityReservingNonprodEnvironmentLeases({}));
  try {
    const reservations = await listCapacityLeases();
    const blocking = (status: string) => reservations.filter((lease) => (
      lease.environmentKey === "local-integration-ci"
      && lease.status === status
      && contendsForInference(lease)
    ));

    const active = blocking("active");
    if (active.length > 0) {
      return {
        available: false,
        reason: "local-ci-active-capacity-reservation",
        expectedFreeAt: earliestExpiry(active),
      };
    }
    // A live queued claim is bounded by its heartbeat/expiry contract. Giving
    // it precedence over *new* local inference reserves the next safe host
    // window without killing provider work that was already in flight.
    //
    // Deliberately UNCHANGED (BI-94D44FDB). The obvious move was to drop the
    // queued deferral here as DI-405E6765ED90 did for the short-call boundary,
    // but the evidence does not support it: over seven days on the live install
    // the queue held 3 rows, not a standing backlog, because BI-D933A328's
    // contendsForInference filter already removed the dev-portal flood that
    // made it permanently non-empty (998 of 1,006 expired claims were
    // dev-portal). The starvation that remains is `active` holds — ~300 real
    // gate runs averaging 195s — so changing the queued rule would trade a
    // reasoned safety property for no measured gain.
    const queued = blocking("queued");
    if (queued.length > 0) {
      return {
        available: false,
        reason: "local-ci-queued-capacity-reservation",
        expectedFreeAt: earliestExpiry(queued),
      };
    }
    return { available: true, reason: null };
  } catch {
    // Starting a resident local model is unsafe when capacity ownership cannot
    // be proven, so uncertainty is deliberately fail-closed for local only.
    return { available: false, reason: "local-ci-capacity-reservation-unavailable" };
  }
}

export async function assertLocalProviderCapacityAvailable(input: {
  listCapacityLeases?: LeaseReader;
} = {}): Promise<void> {
  const status = await inspectLocalProviderCapacity(input);
  if (!status.available) {
    throw new LocalProviderCapacityDeferredError(status.reason, status.expectedFreeAt ?? null);
  }
}

/** Completion-adapter boundary: remote providers remain independent of host leases. */
export async function assertProviderDispatchCapacity(
  providerId: string,
  input: { listCapacityLeases?: LeaseReader } = {},
): Promise<void> {
  if (!isLocalProviderId(providerId)) return;
  await assertLocalProviderCapacityAvailable(input);
}

// ─── Short-call boundary (BI-0AA939DF) ──────────────────────────────────────
//
// The policy above is written for a RESIDENT model: starting one while another
// process owns the host is unsafe, so both `active` and `queued` fail closed.
// That is right for a chat model holding VRAM for a whole conversation.
//
// It was applied to embeddings too, and that was wrong. Embeddings are a short
// single-shot call against an already-resident model, and on a one-slot pool
// with steady gate traffic the gate is effectively never open — so semantic
// search, WWWD stance retrieval, wiki similarity and document embeddings were
// suppressed across the whole install for the duration of every gate run.
//
// MEASURED on the live host, 2026-08-25:
//
//   no gate running                     10ms per embedding (after cold start)
//   active gate + 3 queued           10-20ms per embedding
//   observable effect on the gate      none
//
// A 10ms call and a multi-minute build do not contend. The first attempt at
// this kept the gate and added a 1.5s bounded wait, which helped only with
// sub-second gaps and so never helped at all — a lease lasts 2-4 minutes.
//
// Kernel decision DI-7F674966B4B2 (composite 10.166, margin 2.324, high
// confidence, verdict proceed) exempts this boundary outright. That option had
// ranked LAST in the earlier DI-405E6765ED90 (5.704) on a blast_radius score
// supplied from the assumption that an embedding behaves like a resident model.
// Re-scored against the measurement, it wins. The kernel weighed both option
// sets correctly; only the facts it was given changed.
//
// There is therefore no short-call capacity function any more. The embedding
// path simply does not consult host capacity. assertProviderDispatchCapacity
// above is untouched and still governs chat dispatch to local providers.
