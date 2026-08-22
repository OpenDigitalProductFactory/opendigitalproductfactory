import { listCapacityReservingNonprodEnvironmentLeases } from "@/lib/nonprod/environment-lease";
import { isLocalProviderId } from "./provider-locality";

export type LocalProviderCapacityDeferralReason =
  | "local-ci-active-capacity-reservation"
  | "local-ci-queued-capacity-reservation"
  | "local-ci-capacity-reservation-unavailable";

export type LocalProviderCapacityStatus =
  | { available: true; reason: null }
  | { available: false; reason: LocalProviderCapacityDeferralReason };

type LeaseReader = () => Promise<Array<{
  environmentKey: string;
  status?: string;
  claimKey?: string | null;
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
  constructor(public readonly reason: LocalProviderCapacityDeferralReason) {
    super(`Local provider dispatch deferred: ${reason}`);
    this.name = "LocalProviderCapacityDeferredError";
  }
}

/** Authoritative host-capacity policy shared by every local inference boundary. */
export async function inspectLocalProviderCapacity(input: {
  listCapacityLeases?: LeaseReader;
} = {}): Promise<LocalProviderCapacityStatus> {
  const listCapacityLeases = input.listCapacityLeases
    ?? (() => listCapacityReservingNonprodEnvironmentLeases({}));
  try {
    const reservations = await listCapacityLeases();
    if (reservations.some((lease) => (
      lease.environmentKey === "local-integration-ci"
      && lease.status === "active"
      && contendsForInference(lease)
    ))) {
      return { available: false, reason: "local-ci-active-capacity-reservation" };
    }
    // A live queued claim is bounded by its heartbeat/expiry contract. Giving
    // it precedence over *new* local inference reserves the next safe host
    // window without killing provider work that was already in flight.
    if (reservations.some((lease) => (
      lease.environmentKey === "local-integration-ci"
      && lease.status === "queued"
      && contendsForInference(lease)
    ))) {
      return { available: false, reason: "local-ci-queued-capacity-reservation" };
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
  if (!status.available) throw new LocalProviderCapacityDeferredError(status.reason);
}

/** Completion-adapter boundary: remote providers remain independent of host leases. */
export async function assertProviderDispatchCapacity(
  providerId: string,
  input: { listCapacityLeases?: LeaseReader } = {},
): Promise<void> {
  if (!isLocalProviderId(providerId)) return;
  await assertLocalProviderCapacityAvailable(input);
}
