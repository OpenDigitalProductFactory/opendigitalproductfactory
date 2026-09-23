import {
  mergeLocalCiHostPressure,
  observeLocalCiServerPressure,
  type LocalCiCapacityBroker,
} from "./local-ci-capacity-broker";
import {
  loadLocalCiPoolConfig,
  resolveLocalCiPoolPolicy,
  type LocalCiHostPressure,
  type ResolvedLocalCiPoolPolicy,
} from "./local-ci-pool-policy";
import { readLocalCiInstallationProfile } from "./local-ci-capacity-profile";
import {
  resolveHostResourceAdmission,
  type ActiveHeavyReservation,
  type HeavyResourceClass,
  type HostResourceAdmission,
} from "./host-resource-policy";
import type { OutcomeDisposition } from "@/lib/shared/outcome-disposition";

type PlatformConfigReader = Parameters<
  typeof loadLocalCiPoolConfig
>[0]["platformConfig"];

export interface HostResourcePressure {
  totalMemoryBytes: number;
  availableMemoryBytes: number;
  inferenceResident: boolean;
}

export interface HostResourceLeaseEvidence extends HostResourcePressure {
  ungovernedProcesses?: Array<{
    pid: number;
    parentPid: number;
    resourceClass: string;
    commandLine: string;
    disposition: "evidence-only";
  }>;
}

export interface ResolvedHostResourcePoolPolicy {
  policyVersion: 1;
  source: "host-resource-profile";
  requestedCapacity: number;
  manifestCapacity: 1;
  hostSafeCapacity: number;
  effectiveCapacity: 0 | 1;
  slotKeys: ["slot-0"] | [];
  rollbackReason: string | null;
  config: null;
  /**
   * BI-C77D920A. The admission's own kind, carried through instead of collapsed.
   *
   * `hostSafeCapacity`/`effectiveCapacity`/`slotKeys` are genuinely boolean —
   * there is one slot or none — but `admitted ? … : …` made "wait, capacity will
   * free" and "this will never be admitted" indistinguishable to the caller, and
   * the durable-wait behaviour the resilient-concurrent-development process
   * depends on needs to tell them apart.
   */
  admissionStatus: HostResourceAdmission["status"];
  /**
   * The same fact in the canonical vocabulary (§10 rule 5: a boundary may narrow
   * a disposition, never collapse it).
   *
   * NOTE on `queued` → `awaiting-person`: the §10 table places it there, and the
   * routing property is what matters rather than the name — RETRY_POSTURE is
   * "never", meaning REPORT the wait rather than spin on it, which is exactly how
   * the durable wait works (pregate exits 75 and a detached resumer holds the
   * claim; the caller does not re-ask). That the label says "person" when the
   * thing being waited on is capacity is a naming tension owned by BI-2B96E1B9,
   * which reconciles the two vocabularies; it is recorded here rather than
   * silently resolved.
   */
  disposition: OutcomeDisposition;
}

/**
 * What kind of answer each host admission is — total over the union, so a new
 * admission status cannot be added without deciding what it MEANS (§10 rule 6).
 */
const HOST_ADMISSION_DISPOSITION: Record<HostResourceAdmission["status"], OutcomeDisposition> = {
  // Not heavyweight, so the gate does not apply and the work proceeds.
  bypass: "proceed",
  admitted: "proceed",
  // Capacity is full now and frees later. The claim is not in question.
  queued: "awaiting-person",
  // Settled no: an unmeasurable host or an unknown resource class never admits
  // this request, however long the caller waits.
  blocked: "refused",
};

/** Adapter from the typed host policy to the durable lease pool shape. */
export function resolveHostResourcePoolPolicy(input: {
  resourceClass: HeavyResourceClass;
  expectedMemoryBytes: number;
  hostResource: HostResourcePressure;
  activeReservations: ActiveHeavyReservation[];
}): ResolvedHostResourcePoolPolicy {
  const admission = resolveHostResourceAdmission({
    resourceClass: input.resourceClass,
    expectedMemoryBytes: input.expectedMemoryBytes,
    totalMemoryBytes: input.hostResource.totalMemoryBytes,
    availableMemoryBytes: input.hostResource.availableMemoryBytes,
    inferenceResident: input.hostResource.inferenceResident,
    activeHeavyReservations: input.activeReservations,
  });
  const admitted = admission.status === "admitted";
  const requestedCapacity = "capacity" in admission ? admission.capacity : 1;
  return {
    policyVersion: 1,
    source: "host-resource-profile",
    requestedCapacity,
    manifestCapacity: 1,
    hostSafeCapacity: admitted ? 1 : 0,
    effectiveCapacity: admitted ? 1 : 0,
    slotKeys: admitted ? ["slot-0"] : [],
    rollbackReason: admitted ? null : admission.reason,
    config: null,
    admissionStatus: admission.status,
    disposition: HOST_ADMISSION_DISPOSITION[admission.status],
  };
}

export async function resolveNonprodPoolPolicy(input: {
  platformConfig: PlatformConfigReader | undefined;
  environmentKey: string;
  hostPressure?: LocalCiHostPressure;
  capacityBroker?: LocalCiCapacityBroker;
  manifestSlotCount: number;
  reserveAdmissionHeadroom?: boolean;
  now: Date;
}): Promise<ResolvedLocalCiPoolPolicy> {
  if (input.environmentKey !== "local-integration-ci") {
    return {
      policyVersion: 1,
      source: "default",
      requestedCapacity: 1,
      manifestCapacity: 1,
      hostSafeCapacity: 1,
      effectiveCapacity: 1,
      slotKeys: ["slot-0"],
      rollbackReason: "environment-singleton",
      config: null,
    };
  }
  const configValue = input.platformConfig
    ? await loadLocalCiPoolConfig({ platformConfig: input.platformConfig })
    : null;
  // Consulted only when no valid config row exists (BI-D908DA0A). A read failure
  // is not a reason to guess: an unreadable declaration resolves to null and the
  // policy keeps the compatibility singleton.
  const installation = input.platformConfig
    ? await readLocalCiInstallationProfile({
      platformConfig: input.platformConfig,
    }).catch(() => null)
    : null;
  const clientPressure = input.hostPressure ?? {};
  const preliminary = resolveLocalCiPoolPolicy({
    configValue,
    host: clientPressure,
    manifestSlotCount: input.manifestSlotCount,
    reserveAdmissionHeadroom: input.reserveAdmissionHeadroom,
    env: process.env,
    now: input.now,
    installation,
  });
  // A missing/malformed config keeps the compatibility singleton and has no
  // broker contract to enforce. A valid configured singleton still requires
  // canonical pressure: "one requested" is not permission to admit on an
  // unsafe host.
  if (preliminary.config === null) return preliminary;

  let serverPressure: LocalCiHostPressure;
  try {
    serverPressure = await (
      input.capacityBroker ?? observeLocalCiServerPressure
    )();
  } catch {
    serverPressure = {
      observedAt: input.now.toISOString(),
      dockerHealthy: false,
      convergenceActive: true,
      fencesHealthy: false,
      evidenceIsolationHealthy: false,
    };
  }
  const decidedHostPressure = mergeLocalCiHostPressure({
    client: clientPressure,
    server: serverPressure,
  });
  // Hand the decided observation back with the decision (BI-48F42581). The
  // caller only has its own client sample; recording that next to a
  // server-derived rollbackReason produced gate records that contradicted
  // themselves and sent operators looking for a bug in the wrong place.
  return {
    ...resolveLocalCiPoolPolicy({
      configValue,
      host: decidedHostPressure,
      manifestSlotCount: input.manifestSlotCount,
      reserveAdmissionHeadroom: input.reserveAdmissionHeadroom,
      env: process.env,
      now: input.now,
      installation,
    }),
    decidedHostPressure,
  };
}
