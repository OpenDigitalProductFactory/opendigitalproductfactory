import type { RuntimeWorkGuard } from "./work-attribution";
import catalog from "../../../../scripts/capability-service-catalog.generated.json";
import { validateRuntimeServiceImagePlan } from "./transition-protocol";

const ACTIVE_TRANSITION_STATUSES = ["pending", "applying", "host_applied", "compensating"] as const;

type AdmissionTx = {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  platformCapability: { findMany(args: unknown): Promise<Array<{ capabilityId: string; state: string; manifest: unknown }>> };
  runtimeCapabilityTransition: { findMany(args: unknown): Promise<Array<{ previousKeys: string[]; desiredKeys: string[]; status: string; envelope: unknown }>> };
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
  const transitions = await tx.runtimeCapabilityTransition.findMany({
    where: { OR: [
      { status: { in: [...ACTIVE_TRANSITION_STATUSES] } },
      { status: "rollback_failed", failure: { path: ["recoveryRequired"], equals: true } },
    ] },
    orderBy: { createdAt: "asc" },
    select: { previousKeys: true, desiredKeys: true, status: true, envelope: true },
  });
  const imageOwnerFor = (services: Set<string>) => catalog.capabilities.find(owner =>
    owner.services.some(service => services.has(service.service))
    && (owner.workGuards.includes(guard) || matching.some(row => row.capabilityId === owner.capabilityId)));
  for (const transition of transitions) {
    if ((ACTIVE_TRANSITION_STATUSES as readonly string[]).includes(transition.status)) {
      const desired = new Set(transition.desiredKeys);
      const draining = matching.find(row => transition.previousKeys.includes(row.capabilityId) && !desired.has(row.capabilityId));
      if (draining) throw new Error(`runtime_capability_work_draining:${draining.capabilityId}`);
    }
    const envelope = transition.envelope;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
      || ((envelope as { version?: unknown }).version !== 3 && !("imagePlan" in envelope))) continue;
    let services: Set<string>;
    try {
      services = new Set(validateRuntimeServiceImagePlan(envelope).services.map((entry: { service: string }) => entry.service));
    } catch {
      // The existing v3 validator admits only this browser recipe. Unknown
      // image metadata cannot erase its guard, or freeze unrelated producers.
      const owner = imageOwnerFor(new Set(["browser-use"]));
      if (owner) throw new Error(`runtime_capability_work_scope_unproven:${owner.capabilityId}`);
      continue;
    }
    const owner = imageOwnerFor(services);
    if (owner) throw new Error(`runtime_capability_work_draining:${owner.capabilityId}`);
  }
}
