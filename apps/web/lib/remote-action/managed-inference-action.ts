import { createHash } from "node:crypto";
import { MANAGED_INFERENCE_ACTION_TYPE, parseManagedInferenceTransitionParameters, type ManagedInferenceTransitionParameters } from "@dpf/db/remote-action-dispatch";
import { isRecord } from "@/lib/shared/coerce";
import type { ManagedInferenceAdmissionSnapshot } from "./managed-inference-admission";
export { managedInferenceReportSettlement } from "./managed-inference-request";

type Lease = NonNullable<ManagedInferenceAdmissionSnapshot["lease"]>;
export const MANAGED_INFERENCE_UNSETTLED_WHERE = {
  actionType: MANAGED_INFERENCE_ACTION_TYPE,
  OR: [
    { status: { in: ["queued", "claimed", "running"] } },
    { status: "timed-out", dispatchNonce: { not: null } },
    { status: "failed", dispatchNonce: { not: null }, NOT: { AND: [
      { evidence: { path: ["settlement"], equals: "confirmed" } },
      { OR: [{ evidence: { path: ["nativeStatus"], equals: "failed-restored" } }, { evidence: { path: ["nativeStatus"], equals: "not-started" } }] },
    ] } },
  ],
};
export type NativeHostOfferRow = {
  id: string; nodeId: string; platform: string; installMode: string; trustState: string;
  customerAccountId: string | null; customerSiteId: string | null; lastSeenAt: Date | null; scopePolicy: unknown;
  capabilityRows: Array<{ capability: string; mode: string; evidence: unknown; reportedAt: Date }>;
};
export type ManagedInferenceOffer = { available: false; message: string } | {
  available: true; token: string; operation: "activate" | "rollback"; nodeId: string; edgeNodeId: string;
  needsNodeGrant: boolean; controllerManifestSha256: string; parameters: ManagedInferenceTransitionParameters;
  lease: Lease; providerDigest: string; impact: string;
};

export function buildManagedInferenceOffer(input: {
  nodes: NativeHostOfferRow[]; leases: Lease[]; workrooms: Array<{ executorRef: string | null; headBranch: string | null; headSha: string | null }>;
  operation: "activate" | "rollback"; providerDigest: string; activeAction: boolean; now: Date;
}): ManagedInferenceOffer {
  const unavailable = (message: string): ManagedInferenceOffer => ({ available: false, message });
  if (input.activeAction) return unavailable("An engine change is already in progress. Its outcome must be resolved first.");
  if (!/^[a-f0-9]{64}$/.test(input.providerDigest)) return unavailable("The existing local model settings could not be confirmed.");
  const candidates: Array<Omit<Extract<ManagedInferenceOffer, { available: true }>, "token" | "impact">> = [];
  for (const node of input.nodes) {
    if (node.platform !== "darwin" || node.installMode !== "native" || node.trustState !== "trusted"
      || node.customerAccountId !== null || node.customerSiteId !== null || !node.lastSeenAt
      || +input.now - +node.lastSeenAt > 120000) continue;
    const cap = node.capabilityRows.find(row => row.capability === "action.execute" && row.mode === "enabled"
      && +input.now - +row.reportedAt <= 120000);
    const runtime = isRecord(cap?.evidence) && isRecord(cap.evidence.managedInference) ? cap.evidence.managedInference : null;
    if (!runtime || runtime.schemaVersion !== 1 || runtime.controllerVersion !== "1" || runtime.stagingStatus !== "observed"
      || typeof runtime.controllerManifestSha256 !== "string" || !/^[a-f0-9]{64}$/.test(runtime.controllerManifestSha256)
      || typeof runtime.sourceSha !== "string" || !/^[a-f0-9]{40}$/.test(runtime.sourceSha)
      || !Array.isArray(runtime.stagedProfiles) || !isRecord(runtime.selection)) continue;
    const selection = runtime.selection;
    if (selection.mode !== (input.operation === "activate" ? "docker" : "native")) continue;
    const leases = input.leases.filter(lease => lease.environmentKey === "host-heavy-resource" && lease.resourceClass === "inference"
      && lease.status === "active" && lease.phase === "running" && lease.activeKey?.startsWith("host-heavy-resource:")
      && !lease.releasedAt && lease.expiresAt > input.now && lease.ports.length === 0 && lease.ownerPid && lease.ownerProcessIdentity
      && input.workrooms.some(room => room.executorRef === lease.ownerSessionId && room.headBranch === lease.branchName && room.headSha === runtime.sourceSha));
    if (leases.length !== 1) continue;
    const lease = leases[0];
    for (const profile of runtime.stagedProfiles) {
      if (!isRecord(profile) || profile.hostNodeId !== node.nodeId || profile.physicalDevice !== "Apple M5 Max") continue;
      const fields = ["sourceSha", "profileSha256", "runtimeManifestSha256", "qualificationReportSha256", "baselineEngineSha256"] as const;
      if (input.operation === "activate" ? profile.sourceSha !== runtime.sourceSha : fields.some(key => profile[key] !== selection[key])) continue;
      const parameters = parseManagedInferenceTransitionParameters({ version: 1, operation: input.operation, leaseId: lease.leaseId,
        ...Object.fromEntries(fields.map(key => [key, profile[key]])) });
      if (!parameters) continue;
      const scope = isRecord(node.scopePolicy) ? node.scopePolicy : {};
      candidates.push({ available: true, operation: input.operation, nodeId: node.nodeId, edgeNodeId: node.id,
        needsNodeGrant: !Array.isArray(scope.actionTypes) || !scope.actionTypes.includes(MANAGED_INFERENCE_ACTION_TYPE),
        controllerManifestSha256: runtime.controllerManifestSha256, parameters, lease, providerDigest: input.providerDigest });
    }
  }
  if (candidates.length !== 1) return unavailable(candidates.length > 1
    ? "More than one qualified engine is ready. Choose the intended host before proceeding."
    : "The managed engine needs a verified host installation and its own reserved processing window before it can be switched.");
  const c = candidates[0];
  const token = createHash("sha256").update(JSON.stringify({ operation: c.operation, nodeId: c.nodeId,
    controllerManifestSha256: c.controllerManifestSha256, parameters: c.parameters, providerDigest: c.providerDigest,
    ownerSessionId: c.lease.ownerSessionId, branchName: c.lease.branchName, ownerPid: c.lease.ownerPid,
    ownerProcessIdentity: c.lease.ownerProcessIdentity, needsNodeGrant: c.needsNodeGrant })).digest("hex");
  const impact = c.operation === "activate"
    ? "Pause new local work, switch this Mac to the tested engine, and verify it before accepting requests. Keep the current models and settings. Restore Docker if the switch fails."
    : "Pause new local work, stop the managed engine, and restore Docker with the recorded model settings. Verify restoration before accepting requests.";
  return { ...c, token, impact: impact + (c.needsNodeGrant ? " Also allow this host agent to perform this managed engine procedure." : "") };
}
