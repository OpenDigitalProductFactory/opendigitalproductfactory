import type { ResolvedNonprodPoolPolicy } from "./environment-lease-result";
import {
  resolveHostResourcePoolPolicy,
  type HostResourceLeaseEvidence,
} from "./environment-lease-pool-policy";
import {
  isHeavyResourceClass,
  type ActiveHeavyReservation,
  type HeavyResourceClass,
} from "./host-resource-policy";
import type {
  LocalCiHostPressure,
  ResolvedLocalCiPoolPolicy,
} from "./local-ci-pool-policy";

export type HostBackedReservation = {
  resourceClass: HeavyResourceClass;
  expectedMemoryBytes: number;
};

type PersistedReservation = {
  resourceClass: string | null;
  expectedMemoryBytes: bigint | number | null;
};

/** Fixed shared-first lock order for the two host-backed lease classes. */
export async function lockHostBackedClaimAdmission(input: {
  environmentKey: string;
  lock: (environmentKey: string) => Promise<void>;
}): Promise<void> {
  if (input.environmentKey === "local-integration-ci"
    || input.environmentKey === "host-heavy-resource") {
    await input.lock("host-heavy-resource");
  }
  if (input.environmentKey !== "host-heavy-resource") {
    await input.lock(input.environmentKey);
  }
}

function activeReservations(
  rows: PersistedReservation[],
): ActiveHeavyReservation[] {
  return rows.flatMap((row) => {
    const resourceClass = String(row.resourceClass ?? "");
    const expectedMemoryBytes = Number(row.expectedMemoryBytes ?? 0);
    return isHeavyResourceClass(resourceClass) && expectedMemoryBytes > 0
      ? [{ resourceClass, expectedMemoryBytes }]
      : [];
  });
}

/**
 * Project one claim into the shared host byte domain. The caller supplies the
 * transaction-scoped active-row read, so the read and decision stay behind the
 * shared advisory lock without coupling this policy module to Prisma.
 */
export async function resolveHostBackedClaimPolicy(input: {
  environmentKey: string;
  slotManifestVersion?: 1;
  sharedPoolPolicy: ResolvedLocalCiPoolPolicy | null;
  explicitReservation?: HostBackedReservation;
  explicitHostResource?: HostResourceLeaseEvidence;
  currentLeaseStatus?: string;
  readActiveReservations: () => Promise<PersistedReservation[]>;
}): Promise<{
  candidateReservation?: HostBackedReservation;
  poolPolicy: ResolvedNonprodPoolPolicy;
}> {
  const localReservation = input.environmentKey === "local-integration-ci"
    && input.slotManifestVersion === 1
    ? input.sharedPoolPolicy?.hostReservation
    : undefined;
  const candidateReservation = input.environmentKey === "host-heavy-resource"
    ? input.explicitReservation
    : localReservation;
  if (!candidateReservation) {
    return { poolPolicy: input.sharedPoolPolicy! };
  }

  // A current holder already owns its reservation. Re-admitting it against
  // memory that its own process consumed would double-charge the same lease.
  if (input.currentLeaseStatus === "active") {
    if (input.sharedPoolPolicy) {
      return { candidateReservation, poolPolicy: input.sharedPoolPolicy };
    }
    return {
      candidateReservation,
      poolPolicy: {
        policyVersion: 1,
        source: "host-resource-profile",
        requestedCapacity: 1,
        manifestCapacity: 1,
        hostSafeCapacity: 1,
        effectiveCapacity: 1,
        slotKeys: ["slot-0"],
        rollbackReason: null,
        config: null,
        admissionStatus: "admitted",
        disposition: "proceed",
      },
    };
  }

  const active = activeReservations(await input.readActiveReservations());
  const localHost: LocalCiHostPressure | undefined =
    input.sharedPoolPolicy?.decidedHostPressure;
  const hostResource = input.explicitHostResource ?? {
    totalMemoryBytes: localHost?.totalMemoryBytes ?? Number.MAX_SAFE_INTEGER,
    availableMemoryBytes: localHost?.availableMemoryBytes ?? Number.NaN,
    inferenceResident: active.some(({ resourceClass }) => resourceClass === "inference"),
  };
  const hostPolicy = resolveHostResourcePoolPolicy({
    ...candidateReservation,
    hostResource,
    activeReservations: active,
    expectedMemoryAuthority: input.environmentKey === "local-integration-ci"
      ? "server-derived"
      : "caller",
  });
  if (input.environmentKey === "host-heavy-resource") {
    return { candidateReservation, poolPolicy: hostPolicy };
  }
  return {
    candidateReservation,
    poolPolicy: hostPolicy.effectiveCapacity === 0
      ? {
        ...input.sharedPoolPolicy!,
        hostSafeCapacity: 0,
        effectiveCapacity: 0,
        slotKeys: [],
        rollbackReason: hostPolicy.rollbackReason,
      }
      : input.sharedPoolPolicy!,
  };
}
