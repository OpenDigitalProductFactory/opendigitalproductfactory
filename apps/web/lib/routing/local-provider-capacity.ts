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
}>>;

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
      lease.environmentKey === "local-integration-ci" && lease.status === "active"
    ))) {
      return { available: false, reason: "local-ci-active-capacity-reservation" };
    }
    // A live queued claim is bounded by its heartbeat/expiry contract. Giving
    // it precedence over *new* local inference reserves the next safe host
    // window without killing provider work that was already in flight.
    if (reservations.some((lease) => (
      lease.environmentKey === "local-integration-ci" && lease.status === "queued"
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
