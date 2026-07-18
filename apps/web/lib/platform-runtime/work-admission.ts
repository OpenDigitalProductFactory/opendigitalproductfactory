import type { RuntimeWorkGuard } from "./work-attribution";

const ACTIVE_TRANSITION_STATUSES = ["pending", "applying", "host_applied", "compensating"] as const;

type AdmissionTx = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  platformCapability: { findMany(args: unknown): Promise<Array<{ capabilityId: string; state: string; manifest: unknown }>> };
  runtimeCapabilityTransition: { findFirst(args: unknown): Promise<{ previousKeys: string[]; desiredKeys: string[] } | null> };
};

function guardsFromManifest(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const runtime = (manifest as { runtime?: unknown }).runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return [];
  const guards = (runtime as { workGuards?: unknown }).workGuards;
  return Array.isArray(guards) ? guards.filter((guard): guard is string => typeof guard === "string") : [];
}

/**
 * Admission half of the transition/drain protocol. Call inside the same DB
 * transaction that creates the guarded row. The shared transaction lock makes
 * this check mutually exclusive with transition creation, closing the gap
 * between the coordinator's drain count and a producer's insert.
 */
export async function admitRuntimeGuardedWork(tx: AdmissionTx, guard: RuntimeWorkGuard): Promise<void> {
  // BI-8BA6AC56: acquire the lock via $executeRaw, NOT $queryRaw. pg_advisory_xact_lock
  // returns `void`, and Prisma 7.8's driver adapter throws UnsupportedNativeDataType
  // (P2010) trying to deserialize a void column from $queryRaw — which crashed every
  // Build Studio promote/start (this is the admission gate). $executeRaw runs the
  // statement without deserializing a result set (matches care-appointment-repository).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runtime-capability-transition'))`;
  const capabilities = await tx.platformCapability.findMany({
    where: { capabilityId: { startsWith: "runtime:" } },
    select: { capabilityId: true, state: true, manifest: true },
  });
  const matching = capabilities.filter((row) => guardsFromManifest(row.manifest).includes(guard));
  const transition = await tx.runtimeCapabilityTransition.findFirst({
    where: { status: { in: [...ACTIVE_TRANSITION_STATUSES] } },
    orderBy: { createdAt: "asc" },
    select: { previousKeys: true, desiredKeys: true },
  });
  if (!transition) return;
  const desired = new Set(transition.desiredKeys);
  const draining = matching.find((row) => transition.previousKeys.includes(row.capabilityId) && !desired.has(row.capabilityId));
  if (draining) throw new Error(`runtime_capability_work_draining:${draining.capabilityId}`);
}
