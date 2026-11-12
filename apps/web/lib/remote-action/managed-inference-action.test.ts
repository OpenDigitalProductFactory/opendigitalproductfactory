import { expect, it } from "vitest";
import { buildManagedInferenceOffer } from "./managed-inference-action";

function fixture() {
  const hash = "a".repeat(64), source = "a".repeat(40), now = new Date("2026-10-28T22:00:00Z");
  return { now, operation: "activate" as const, providerDigest: hash, activeAction: false,
    nodes: [{ id: "row", nodeId: "edge-test", platform: "darwin", installMode: "native", trustState: "trusted", customerAccountId: null, customerSiteId: null, lastSeenAt: now,
      scopePolicy: { actionTypes: ["inventory.collect"] }, capabilityRows: [{ capability: "action.execute", mode: "enabled", reportedAt: now,
        evidence: { managedInference: { schemaVersion: 1, controllerVersion: "1", sourceSha: source, controllerManifestSha256: hash, stagingStatus: "observed",
          selection: { mode: "docker" }, stagedProfiles: [{ hostNodeId: "edge-test", physicalDevice: "Apple M5 Max", sourceSha: source,
            profileSha256: hash, runtimeManifestSha256: hash, qualificationReportSha256: hash, baselineEngineSha256: hash }] } } }] }],
    leases: [{ leaseId: "NPEL-test", ownerSessionId: "session", branchName: "codex/native", ownerPid: 10, ownerProcessIdentity: "mac:10",
      environmentKey: "host-heavy-resource", resourceClass: "inference", status: "active", activeKey: "host-heavy-resource:slot-0", releasedAt: null,
      phase: "running", expiresAt: new Date(+now + 60000), ports: [] }],
    workrooms: [{ executorRef: "session", headBranch: "codex/native", headSha: source }],
  };
}
it("offers only a staged host-bound profile with its own admitted source owner's processing window", () => {
  const f = fixture(); const offer = buildManagedInferenceOffer(f);
  expect(offer.available).toBe(true);
  if (!offer.available) return;
  expect(offer.needsNodeGrant).toBe(true);
  expect(offer.parameters).toMatchObject({ leaseId: "NPEL-test", operation: "activate", sourceSha: "a".repeat(40) });
  f.leases[0].expiresAt = new Date(+f.now + 90000);
  expect(buildManagedInferenceOffer(f)).toMatchObject({ token: offer.token });
});
it.each(["another-host", "another-owner", "expired", "disabled", "uncertain", "busy"])("does not offer %s", kind => {
  const f = fixture();
  if (kind === "another-host") f.nodes[0].capabilityRows[0].evidence.managedInference.stagedProfiles[0].hostNodeId = "foreign";
  if (kind === "another-owner") f.leases[0].ownerSessionId = "foreign";
  if (kind === "expired") f.leases[0].expiresAt = f.now;
  if (kind === "disabled") f.nodes[0].capabilityRows[0].mode = "disabled";
  if (kind === "uncertain") f.nodes[0].capabilityRows[0].evidence.managedInference.selection.mode = "uncertain";
  if (kind === "busy") f.activeAction = true;
  expect(buildManagedInferenceOffer(f).available).toBe(false);
});

it("discloses the exact host permission grant during rollback as well as activation", () => {
  const f = fixture(); const profile = f.nodes[0].capabilityRows[0].evidence.managedInference.stagedProfiles[0];
  Object.assign(f.nodes[0].capabilityRows[0].evidence.managedInference.selection, { ...profile, mode: "native" });
  const offer = buildManagedInferenceOffer({ ...f, operation: "rollback" });
  expect(offer.available).toBe(true);
  if (offer.available) { expect(offer.needsNodeGrant).toBe(true); expect(offer.impact).toContain("Also allow this host agent"); }
});
