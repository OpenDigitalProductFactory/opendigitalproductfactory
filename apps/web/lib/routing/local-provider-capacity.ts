import { listActiveNonprodEnvironmentLeases } from "@/lib/nonprod/environment-lease";
import { isLocalProviderId } from "./provider-locality";

export type LocalProviderCapacityDeferralReason =
  | "local-ci-active-capacity-reservation"
  | "local-ci-capacity-reservation-unavailable";

export type LocalProviderCapacityStatus =
  | { available: true; reason: null }
  | { available: false; reason: LocalProviderCapacityDeferralReason };

type ActiveLeaseReader = () => Promise<Array<{ environmentKey: string }>>;

export class LocalProviderCapacityDeferredError extends Error {
  constructor(public readonly reason: LocalProviderCapacityDeferralReason) {
    super(`Local provider dispatch deferred: ${reason}`);
    this.name = "LocalProviderCapacityDeferredError";
  }
}

/** Authoritative host-capacity policy shared by every local inference boundary. */
export async function inspectLocalProviderCapacity(input: {
  listActiveLeases?: ActiveLeaseReader;
} = {}): Promise<LocalProviderCapacityStatus> {
  const listActiveLeases = input.listActiveLeases
    ?? (() => listActiveNonprodEnvironmentLeases({}));
  try {
    const activeLeases = await listActiveLeases();
    if (activeLeases.some((lease) => lease.environmentKey === "local-integration-ci")) {
      return { available: false, reason: "local-ci-active-capacity-reservation" };
    }
    return { available: true, reason: null };
  } catch {
    // Starting a resident local model is unsafe when capacity ownership cannot
    // be proven, so uncertainty is deliberately fail-closed for local only.
    return { available: false, reason: "local-ci-capacity-reservation-unavailable" };
  }
}

export async function assertLocalProviderCapacityAvailable(input: {
  listActiveLeases?: ActiveLeaseReader;
} = {}): Promise<void> {
  const status = await inspectLocalProviderCapacity(input);
  if (!status.available) throw new LocalProviderCapacityDeferredError(status.reason);
}

/** Completion-adapter boundary: remote providers remain independent of host leases. */
export async function assertProviderDispatchCapacity(
  providerId: string,
  input: { listActiveLeases?: ActiveLeaseReader } = {},
): Promise<void> {
  if (!isLocalProviderId(providerId)) return;
  await assertLocalProviderCapacityAvailable(input);
}
