import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { readImageVersion } from "@/lib/platform/image-version";
import catalogSeed from "../../../../scripts/capability-service-catalog.generated.json";
import { isPromoterAvailable, resolvePromoterArtifact, runPromoter, runRuntimeCapabilityProtocolProbe } from "@/lib/self-upgrade/promoter";
import { countAttributedWork, createPrismaWorkAttributionStore } from "./work-attribution";
import { computeCapabilityStateVersion, coordinateRuntimeCapabilityTransition, createPrismaRuntimeTransitionReceipts } from "./transition-coordinator";
import type { RuntimeTransitionReceipt } from "./transition-protocol";

type CatalogEntry = { capabilityId: string; dependencies: string[]; services: Array<{ service: string; profiles: string[]; dependsOn: string[]; targetClassification?: string; healthSemantics?: string }> };
const catalog = catalogSeed as { catalogHash: string; capabilities: CatalogEntry[] };

export function requiredRuntimeServicesAreHealthy(
  requiredServices: readonly string[],
  observedServices: readonly string[],
  observedHealth?: Readonly<Record<string, string>>,
): boolean {
  const requirements = new Map(catalog.capabilities.flatMap((entry) => entry.services).map((service) => [service.service, service.healthSemantics]));
  return requiredServices.every((service) => {
    if (!observedServices.includes(service)) return false;
    return requirements.get(service) !== "compose-healthcheck" || observedHealth?.[service] === "healthy";
  });
}

function resolveProjection(keys: readonly string[], states: Readonly<Record<string, string>>) {
  const byId = new Map(catalog.capabilities.map((entry) => [entry.capabilityId, entry]));
  const enabled = new Set<string>();
  const add = (id: string) => { const entry = byId.get(id); if (!entry) throw new Error(`unknown_runtime_capability:${id}`); if (enabled.has(id)) return; entry.dependencies.forEach(add); enabled.add(id); };
  keys.forEach(add);
  const enabledKeys = [...enabled].sort();
  if (JSON.stringify(enabledKeys) !== JSON.stringify([...keys].sort())) throw new Error("runtime_capability_dependency_closure_required");
  const services = catalog.capabilities.filter((entry) => enabled.has(entry.capabilityId)).flatMap((entry) => entry.services).filter((service) => service.targetClassification !== "ephemeral-lifecycle");
  return { catalogHash: catalog.catalogHash, stateHash: computeCapabilityStateVersion(catalog.catalogHash, states), enabledKeys, composeProfiles: [...new Set(services.flatMap((service) => service.profiles))].sort(), requiredServices: [...new Set(services.map((service) => service.service))].sort() };
}

const receiptPath = (id: string) => `/dpf-state/runtime-capability-transitions/${id}.json`;
async function readReceipt(id: string): Promise<RuntimeTransitionReceipt> {
  return JSON.parse(await readFile(receiptPath(id), "utf8")) as RuntimeTransitionReceipt;
}

async function activeRuntimeTransitionIds(): Promise<string[]> {
  const active = await prisma.runtimeCapabilityTransition.findMany({ where: { status: { in: ["pending", "applying", "host_applied", "compensating"] } }, select: { transitionId: true } });
  return active.map((row) => row.transitionId).sort();
}

async function reconcileAuthority(promoterParams: { hostInstallPath: string; stateDirHostPath: string; targetSha: string; backupPath: string; healthUrl: string }) {
  const result = await runPromoter({ ...promoterParams, runtimeTransitionAuthorityOperation: "reconcile", runtimeTransitionActiveIds: await activeRuntimeTransitionIds(), containerName: "dpf-promoter-authority-reconcile", timeoutMs: 60_000 });
  return result.exitCode === 0;
}

export async function rotateProductionRuntimeTransitionSecret() {
  const hostInstallPath = process.env.DPF_HOST_INSTALL_PATH, stateDirHostPath = process.env.DPF_STATE_DIR_HOST;
  if (!hostInstallPath || !stateDirHostPath) throw new Error("runtime_transition_host_configuration_missing");
  const params = { hostInstallPath, stateDirHostPath, targetSha: process.env.DEPLOYED_SHA ?? "runtime-capability-transition", backupPath: "/backups/runtime-capability-transition", healthUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/health` };
  if (!(await reconcileAuthority(params))) return { status: "transition_in_progress" as const };
  const result = await runPromoter({ ...params, runtimeTransitionAuthorityOperation: "rotate-secret", containerName: "dpf-promoter-runtime-secret-rotation", timeoutMs: 60_000 });
  if (result.exitCode !== 0) return { status: "failed" as const };
  return { status: "rotated" as const };
}

/** The portal image carries the same source closure used to build its promoter.
 * Expected bytes come from that packaged closure, never the host install or a
 * caller-supplied digest. This probe has no host mounts or launch authority. */
async function inspectPackagedReconciliationProtocol() {
  const image = await readImageVersion();
  if (!image || image.source !== "git-sha" || !/^[a-f0-9]{40}$/.test(image.raw)) throw new Error("runtime_protocol_server_identity_missing");
  const sourceSha = image.raw;
  if (process.env.DEPLOYED_SHA && process.env.DEPLOYED_SHA !== sourceSha) throw new Error("runtime_protocol_server_identity_mismatch");
  const [actuator, signer] = await Promise.all([
    readFile("/promoter/scripts/apply-runtime-capability-transition.mjs"),
    readFile("/promoter/scripts/lib/transition-signing.mjs"),
  ]);
  const expected = { sourceSha, actuatorSha256: createHash("sha256").update(actuator).digest("hex"), signerSha256: createHash("sha256").update(signer).digest("hex") };
  const artifact = await resolvePromoterArtifact({ targetSha: sourceSha });
  const info = await runRuntimeCapabilityProtocolProbe({ artifact, expected, containerName: `dpf-runtime-protocol-${randomUUID()}` });
  if (!info.signingVersions.includes(2) || !info.applyVersions.includes(2) || !info.reconciliationVersions.includes(2)) throw new Error("runtime_reconciliation_protocol_unsupported");
  return info;
}

export async function executeProductionRuntimeCapabilityTransition(input: { transitionId: string; desiredKeys: string[]; requestedById: string; mode?: "transition" | "reconciliation" }) {
  input = { ...input, desiredKeys: [...input.desiredKeys] };
  if (input.mode === "reconciliation") {
    try { await inspectPackagedReconciliationProtocol(); } catch { /* Missing or incompatible packaged evidence cannot authorize an apply. */ }
    // Server reconciliation is not implemented yet. In particular, host support
    // cannot authorize falling back to the ordinary consistent-baseline saga.
    return { status: "failed" as const, failure: "runtime_reconciliation_protocol_unavailable" as const };
  }
  const rows = await prisma.platformCapability.findMany({ where: { capabilityId: { startsWith: "runtime:" } }, select: { capabilityId: true, state: true, manifest: true } });
  const previousStates = Object.fromEntries(rows.map((row) => [row.capabilityId, row.state]));
  const previousKeys = rows.filter((row) => row.state === "active").map((row) => row.capabilityId).sort();
  const desiredSet = new Set(input.desiredKeys);
  const desiredStates = Object.fromEntries(rows.map((row) => [row.capabilityId, desiredSet.has(row.capabilityId) ? "active" : "disabled"]));
  const previousProjection = resolveProjection(previousKeys, previousStates);
  const desiredProjection = resolveProjection(input.desiredKeys, desiredStates);
  const disabling = rows.filter((row) => row.state === "active" && !desiredSet.has(row.capabilityId));
  const guards = [...new Set(disabling.flatMap((row) => {
    const runtime = row.manifest && typeof row.manifest === "object" && !Array.isArray(row.manifest) ? (row.manifest as { runtime?: { workGuards?: unknown } }).runtime : undefined;
    return Array.isArray(runtime?.workGuards) ? runtime.workGuards.filter((guard): guard is string => typeof guard === "string") : [];
  }))];
  const recheckAttributedWork = async () => (await countAttributedWork(guards, createPrismaWorkAttributionStore(prisma))).blockingCounts;
  const protocolSecret = (await readFile("/dpf-state/runtime-transition.secret", "utf8")).trim();
  const hostInstallPath = process.env.DPF_HOST_INSTALL_PATH, stateDirHostPath = process.env.DPF_STATE_DIR_HOST, protocolSecretFileHostPath = process.env.DPF_RUNTIME_TRANSITION_SECRET_FILE_HOST;
  if (!hostInstallPath || !stateDirHostPath || !protocolSecretFileHostPath) throw new Error("runtime_transition_host_configuration_missing");
  const promoterParams = { hostInstallPath, stateDirHostPath, runtimeCapabilitySecretFileHostPath: protocolSecretFileHostPath, targetSha: process.env.DEPLOYED_SHA ?? "runtime-capability-transition", backupPath: "/backups/runtime-capability-transition", healthUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/health`, composeFiles: (process.env.DPF_SELF_UPGRADE_COMPOSE_FILES ?? "docker-compose.yml").split(/\s+/).filter(Boolean), composeProject: process.env.COMPOSE_PROJECT_NAME ?? "dpf" };
  if (!(await reconcileAuthority(promoterParams))) return { status: "transition_in_progress" as const };
  const reserve = await runPromoter({ ...promoterParams, runtimeCapabilityTransitionId: input.transitionId, runtimeTransitionAuthorityOperation: "reserve", containerName: `dpf-promoter-authority-${input.transitionId}`, timeoutMs: 60_000 });
  if (reserve.exitCode !== 0) return { status: "transition_in_progress" as const };
  const authorityToken = (() => { try { const parsed = JSON.parse(reserve.stdout) as { ownershipToken?: unknown }; return typeof parsed.ownershipToken === "string" ? parsed.ownershipToken : null; } catch { return null; } })();
  if (!authorityToken) throw new Error("runtime_transition_authority_token_missing");
  try {
    return await coordinateRuntimeCapabilityTransition({ transitionId: input.transitionId, catalogHash: catalog.catalogHash, previousKeys, desiredKeys: desiredProjection.enabledKeys, previousStates, desiredStates, requestedById: input.requestedById }, {
    receipts: createPrismaRuntimeTransitionReceipts(prisma as never), isPromoterAvailable, runPromoter, protocolSecret, protocolSecretFileHostPath, recheckAttributedWork, readHostReceipt: readReceipt,
    resolveProjection: async (keys) => keys.join("\0") === previousKeys.join("\0") ? previousProjection : desiredProjection,
    verifyRequiredHealth: async (desired, observed, observedHealth) => {
      const projection = desired.join("\0") === previousKeys.join("\0") ? previousProjection : desiredProjection;
      return requiredRuntimeServicesAreHealthy(projection.requiredServices, observed, observedHealth);
    },
      promoterParams,
    });
  } finally {
    const release = await runPromoter({ ...promoterParams, runtimeCapabilityTransitionId: input.transitionId, runtimeTransitionAuthorityOperation: "release", runtimeTransitionAuthorityToken: authorityToken, containerName: `dpf-promoter-authority-release-${input.transitionId}`, timeoutMs: 60_000 });
    if (release.exitCode !== 0) throw new Error("runtime_transition_authority_release_failed");
  }
}
