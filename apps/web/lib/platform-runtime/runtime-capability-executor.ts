import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@dpf/db";
import { readImageVersion } from "@/lib/platform/image-version";
import { parseReleaseInstallContext } from "@/lib/self-upgrade/release-target";
import { RELEASE_IMAGE_TAG } from "@/lib/self-upgrade/registry-release";
import catalogSeed from "../../../../scripts/capability-service-catalog.generated.json";
import { isPromoterAvailable, resolvePromoterArtifact, runPromoter, runRuntimeCapabilityProtocolProbe } from "@/lib/self-upgrade/promoter";
import { countAttributedWork, createPrismaWorkAttributionStore } from "./work-attribution";
import { computeCapabilityStateVersion, coordinateRuntimeCapabilityTransition, createPrismaRuntimeTransitionReceipts } from "./transition-coordinator";
import { canonicalTransitionPayload, prepareRuntimeReconciliationIntent, type RuntimeReconciliationIntent, type RuntimeTransitionReceipt } from "./transition-protocol";
import { computeCapabilityStateVersion as computeHostStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";
import { runtimeTransitionHostContext, runtimeTransitionHostPlatform } from "./runtime-transition-host-context";

type CatalogEntry = { capabilityId: string; dependencies: string[]; services: Array<{ service: string; profiles: string[]; dependsOn: string[]; targetClassification?: string; healthSemantics?: string; hostPlatforms: string[] }> };
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

function resolveProjection(keys: readonly string[], states: Readonly<Record<string, string>>, hostPlatform?: string) {
  const byId = new Map(catalog.capabilities.map((entry) => [entry.capabilityId, entry]));
  const enabled = new Set<string>();
  const add = (id: string) => { const entry = byId.get(id); if (!entry) throw new Error(`unknown_runtime_capability:${id}`); if (enabled.has(id)) return; entry.dependencies.forEach(add); enabled.add(id); };
  keys.forEach(add);
  const enabledKeys = [...enabled].sort();
  if (JSON.stringify(enabledKeys) !== JSON.stringify([...keys].sort())) throw new Error("runtime_capability_dependency_closure_required");
  const services = catalog.capabilities.filter((entry) => enabled.has(entry.capabilityId)).flatMap((entry) => entry.services).filter((service) => service.targetClassification !== "ephemeral-lifecycle" && (!hostPlatform || service.hostPlatforms.includes(hostPlatform)));
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
async function inspectPackagedReconciliationProtocol(observedHostSnapshot?: RuntimeReconciliationIntent["observedHost"]) {
  const image = await readImageVersion();
  if (!image || image.source !== "git-sha" || !/^[a-f0-9]{40}$/.test(image.raw)) throw new Error("runtime_protocol_server_identity_missing");
  const sourceSha = image.raw;
  if (process.env.DEPLOYED_SHA && process.env.DEPLOYED_SHA !== sourceSha) throw new Error("runtime_protocol_server_identity_mismatch");
  const [actuator, signer] = await Promise.all([
    readFile("/promoter/scripts/apply-runtime-capability-transition.mjs"),
    readFile("/promoter/scripts/lib/transition-signing.mjs"),
  ]);
  const expected = { sourceSha, actuatorSha256: createHash("sha256").update(actuator).digest("hex"), signerSha256: createHash("sha256").update(signer).digest("hex") };
  // Consumer installs carry published promoter images, not a source-built
  // dpf-promoter:<sha>. Resolve the installed immutable release, never its
  // moving discovery channel; the existing artifact validator still binds the
  // source revision and packaged protocol bytes before any host authority.
  const installMode = observedHostSnapshot && "installMode" in observedHostSnapshot ? observedHostSnapshot.installMode : null;
  const releaseInstall = installMode === "consumer" || installMode === "customer";
  const release = releaseInstall ? parseReleaseInstallContext({ state: observedHostSnapshot, markerMode: null, env: process.env }) : null;
  if (releaseInstall && (!release || !RELEASE_IMAGE_TAG.test(release.imageTag) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(release.ghcrOwner))) {
    throw new Error("runtime_protocol_release_identity_missing");
  }
  const reference = release ? `ghcr.io/${release.ghcrOwner.toLowerCase()}/dpf-promoter:${release.imageTag}` : null;
  const artifact = await resolvePromoterArtifact({ targetSha: sourceSha,
    ...(reference ? { promoterImage: reference, candidateReference: reference } : {}) });
  const info = await runRuntimeCapabilityProtocolProbe({ artifact, expected, containerName: `dpf-runtime-protocol-${randomUUID()}`, ...(observedHostSnapshot ? { observedHostSnapshot } : {}) });
  if (!info.signingVersions.includes(2) || !info.applyVersions.includes(2) || !info.reconciliationVersions.includes(2)) throw new Error("runtime_reconciliation_protocol_unsupported");
  return { info, artifact };
}

/** Observe both authorities without proposing defaults or reserving apply rights. */
export async function readProductionRuntimeCapabilityReconciliationPreview() {
  const [hostBytes, rows] = await Promise.all([
    readFile("/dpf-state/install-state.json", "utf8"),
    prisma.platformCapability.findMany({ where: { capabilityId: { startsWith: "runtime:" } }, select: { capabilityId: true, state: true } }),
  ]);
  const observedHost = JSON.parse(hostBytes) as RuntimeReconciliationIntent["observedHost"];
  const observedDatabaseStates = Object.fromEntries(rows.map(row => [row.capabilityId, row.state]));
  const prepared = prepareRuntimeReconciliationIntent({ observedHost, observedDatabaseStates,
    desiredHostEnabledKeys: observedHost.enabledRuntimeCapabilities, desiredDatabaseStates: observedDatabaseStates, touchedKeys: [] },
  { catalogHash: catalog.catalogHash, capabilityIds: catalog.capabilities.map(entry => entry.capabilityId) });
  const protocol = await inspectPackagedReconciliationProtocol(prepared.observedHost);
  return { observedHost: prepared.observedHost, observedDatabaseStates: prepared.observedDatabaseStates,
    residualDriftKeys: prepared.residualDriftKeys,
    capabilities: catalog.capabilities.map(entry => ({ capabilityId: entry.capabilityId, dependencies: entry.dependencies })),
    protocolIdentity: { ...protocol.info, promoterDigest: protocol.artifact.digest } };
}

export async function executeProductionRuntimeCapabilityTransition(input: { transitionId: string; desiredKeys: string[]; requestedById: string; mode?: "transition" | "reconciliation"; reconciliation?: RuntimeReconciliationIntent }) {
  input = { ...input, desiredKeys: [...input.desiredKeys], ...(input.reconciliation ? { reconciliation: structuredClone(input.reconciliation) } : {}) };
  let prepared: ReturnType<typeof prepareRuntimeReconciliationIntent> | undefined;
  let protocol: Awaited<ReturnType<typeof inspectPackagedReconciliationProtocol>> | undefined;
  if (input.mode === "reconciliation") {
    try {
      if (input.reconciliation) {
        prepared = prepareRuntimeReconciliationIntent(input.reconciliation, { catalogHash: catalog.catalogHash, capabilityIds: catalog.capabilities.map(entry => entry.capabilityId) });
        const actualHost = JSON.parse(await readFile("/dpf-state/install-state.json", "utf8")) as unknown;
        const identity = (host: unknown) => canonicalTransitionPayload({ version: 2, kind: "runtime-capability-transition", host });
        if (identity(actualHost) !== identity(prepared.observedHost)) return { status: "failed" as const, failure: "runtime_reconciliation_host_stale" as const };
        if (JSON.stringify([...input.desiredKeys].sort()) !== JSON.stringify(prepared.desiredHostEnabledKeys)) return { status: "failed" as const, failure: "runtime_reconciliation_request_mismatch" as const };
      }
      protocol = await inspectPackagedReconciliationProtocol(prepared?.observedHost);
    } catch { return { status: "failed" as const, failure: "runtime_reconciliation_protocol_unavailable" as const }; }
    // A host advertisement alone cannot authorize an implicit correction.
    if (!prepared) return { status: "failed" as const, failure: "runtime_reconciliation_protocol_unavailable" as const };
  } else if (input.reconciliation) {
    return { status: "failed" as const, failure: "runtime_reconciliation_request_mismatch" as const };
  }
  const rows = await prisma.platformCapability.findMany({ where: { capabilityId: { startsWith: "runtime:" } }, select: { capabilityId: true, state: true, manifest: true } });
  const previousStates = Object.fromEntries(rows.map((row) => [row.capabilityId, row.state]));
  if (prepared && (Object.keys(previousStates).length !== Object.keys(prepared.observedDatabaseStates).length || Object.keys(previousStates).some(key => previousStates[key] !== prepared.observedDatabaseStates[key]))) {
    return { status: "failed" as const, failure: "runtime_reconciliation_database_stale" as const };
  }
  const previousKeys = prepared ? [...prepared.observedHost.enabledRuntimeCapabilities] : rows.filter((row) => row.state === "active").map((row) => row.capabilityId).sort();
  const desiredSet = new Set(input.desiredKeys);
  const desiredStates = prepared ? { ...prepared.desiredDatabaseStates } : Object.fromEntries(rows.map((row) => [row.capabilityId, desiredSet.has(row.capabilityId) ? "active" : "disabled"]));
  const hostStates = (keys: readonly string[]) => Object.fromEntries(catalog.capabilities.map(entry => [entry.capabilityId, keys.includes(entry.capabilityId) ? "active" : "disabled"]));
  const hostPlatform = prepared ? runtimeTransitionHostPlatform(prepared.observedHost) : undefined;
  const previousProjection = resolveProjection(previousKeys, prepared ? hostStates(previousKeys) : previousStates, hostPlatform);
  const desiredProjection = resolveProjection(input.desiredKeys, prepared ? hostStates(input.desiredKeys) : desiredStates, hostPlatform);
  if (prepared) {
    previousProjection.stateHash = prepared.observedHost.capabilityStateVersion;
    desiredProjection.stateHash = computeHostStateVersion(catalog.catalogHash, input.desiredKeys, catalog.capabilities.map(entry => entry.capabilityId));
  }
  const disabling = rows.filter((row) => (row.state === "active" && desiredStates[row.capabilityId] !== "active") || (previousKeys.includes(row.capabilityId) && !desiredSet.has(row.capabilityId)));
  const guards = [...new Set(disabling.flatMap((row) => {
    const runtime = row.manifest && typeof row.manifest === "object" && !Array.isArray(row.manifest) ? (row.manifest as { runtime?: { workGuards?: unknown } }).runtime : undefined;
    return Array.isArray(runtime?.workGuards) ? runtime.workGuards.filter((guard): guard is string => typeof guard === "string") : [];
  }))];
  const recheckAttributedWork = async () => (await countAttributedWork(guards, createPrismaWorkAttributionStore(prisma))).blockingCounts;
  const protocolSecret = (await readFile("/dpf-state/runtime-transition.secret", "utf8")).trim();
  const hostInstallPath = process.env.DPF_HOST_INSTALL_PATH, stateDirHostPath = process.env.DPF_STATE_DIR_HOST, protocolSecretFileHostPath = process.env.DPF_RUNTIME_TRANSITION_SECRET_FILE_HOST;
  if (!hostInstallPath || !stateDirHostPath || !protocolSecretFileHostPath) throw new Error("runtime_transition_host_configuration_missing");
  const promoterParams = { ...runtimeTransitionHostContext(prepared?.observedHost), runtimeCapabilitySecretFileHostPath: protocolSecretFileHostPath, targetSha: protocol?.artifact.sourceSha ?? process.env.DEPLOYED_SHA ?? "runtime-capability-transition", ...(protocol ? { promoterImage: protocol.artifact.digest } : {}), backupPath: "/backups/runtime-capability-transition", healthUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/health` };
  if (!(await reconcileAuthority(promoterParams))) return { status: "transition_in_progress" as const };
  const reserve = await runPromoter({ ...promoterParams, runtimeCapabilityTransitionId: input.transitionId, runtimeTransitionAuthorityOperation: "reserve", containerName: `dpf-promoter-authority-${input.transitionId}`, timeoutMs: 60_000 });
  if (reserve.exitCode !== 0) return { status: "transition_in_progress" as const };
  const authorityToken = (() => { try { const parsed = JSON.parse(reserve.stdout) as { ownershipToken?: unknown }; return typeof parsed.ownershipToken === "string" ? parsed.ownershipToken : null; } catch { return null; } })();
  if (!authorityToken) throw new Error("runtime_transition_authority_token_missing");
  try {
    return await coordinateRuntimeCapabilityTransition({ transitionId: input.transitionId, catalogHash: catalog.catalogHash, previousKeys, desiredKeys: desiredProjection.enabledKeys, previousStates, desiredStates, requestedById: input.requestedById, ...(prepared ? { reconciliation: prepared } : {}) }, {
    ...(prepared && protocol ? { reconciliationProtocol: protocol.info, reconciliationPromoterDigest: protocol.artifact.digest, catalogCapabilityIds: catalog.capabilities.map(entry => entry.capabilityId) } : {}),
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
