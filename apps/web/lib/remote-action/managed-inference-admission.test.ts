import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeEdgeActionEnvelope, type SignedEdgeActionEnvelope } from "@dpf/db/edge-action-envelope";
import type { EdgeActionEnvelope } from "@dpf/db/edge-action-envelope";
import { issueManagedInferenceAdmission, type ManagedInferenceAdmissionSnapshot } from "./managed-inference-admission";

const now = new Date("2026-10-28T22:00:00Z");
const digest = "a".repeat(64);
function fixture() {
  const envelope: SignedEdgeActionEnvelope = {
    version: "dpf.edge-action/1", signingKeyId: "key", signature: "original-signature",
    actionType: "inference.runtime.transition", actionKey: "ra_native_1", nodeId: "edge-mac",
    nonce: "nonce", issuedAt: new Date(+now - 1000).toISOString(), expiresAt: new Date(+now + 60000).toISOString(),
    parameters: { version: 1, operation: "activate", sourceSha: "a".repeat(40), profileSha256: digest,
      runtimeManifestSha256: digest, qualificationReportSha256: digest, baselineEngineSha256: digest, leaseId: "NPEL-test" },
  };
  const snapshot: ManagedInferenceAdmissionSnapshot = {
    envelope, status: "running", approvalState: "approved", riskClass: "high", approvedByPrincipalId: "human",
    node: { nodeId: "edge-mac", trustState: "trusted", internal: true, enabled: true, allowedActionTypes: [envelope.actionType],
      controllerSourceSha: "a".repeat(40), controllerManifestSha256: digest },
    change: { id: "change-1", status: "approved", approvedAt: now, approvedById: "user-1" },
    lease: { leaseId: "NPEL-test", environmentKey: "host-heavy-resource", resourceClass: "inference", status: "active",
      activeKey: "host-heavy-resource:slot-0", releasedAt: null, expiresAt: new Date(+now + 12000), phase: "running",
      ownerSessionId: "session-1", branchName: "codex/test", ownerPid: 123, ownerProcessIdentity: "mac:123", ports: [] },
    quiescence: { runId: "QR-test", status: "swapping", trigger: "manual", triggerRefId: "inference-runtime:ra_native_1",
      targetVersion: "a".repeat(40), targetBundleHash: digest, swapStartedAt: now },
    admission: { ownerSessionId: "session-1", branchName: "codex/test", ownerPid: 123, ownerProcessIdentity: "mac:123",
      quiescenceRunId: "QR-test", controllerManifestSha256: digest, providerDigest: digest },
    currentProviderDigest: digest,
    globalFence: { level: "swapping", runId: "QR-test" },
  };
  const signer = { signingKeyId: "key", sign: vi.fn((value: EdgeActionEnvelope) => ({ ...value, signature: value.actionType.endsWith(".admission") ? "admission-signature" : envelope.signature })) };
  return { envelope, snapshot, signer };
}

describe("managed inference admission", () => {
  it("binds to the original claimed action and actual remaining host lease without renewing it", () => {
    const f = fixture();
    const proof = issueManagedInferenceAdmission({ ...f, now, nonce: "proof-nonce" });
    expect(proof.expiresAt).toBe(f.snapshot.lease!.expiresAt.toISOString());
    expect(proof.parameters).toMatchObject({ ready: true, leaseId: "NPEL-test", quiescenceRunId: "QR-test",
      requestDigest: createHash("sha256").update(canonicalizeEdgeActionEnvelope(f.envelope)).digest("hex") });
    expect(f.snapshot.lease!.expiresAt).toEqual(new Date(+now + 12000));
  });
  it.each([
    ["different action", f => { f.envelope = { ...f.envelope, nonce: "another" }; }],
    ["expired lease", f => { f.snapshot.lease!.expiresAt = now; }],
    ["unclaimed action", f => { f.snapshot.status = "queued"; }],
    ["revoked host", f => { f.snapshot.node.trustState = "revoked"; }],
    ["missing exact grant", f => { f.snapshot.node.allowedActionTypes = []; }],
    ["disabled action channel", f => { f.snapshot.node.enabled = false; }],
    ["customer host", f => { f.snapshot.node.internal = false; }],
    ["unapproved change", f => { f.snapshot.change!.status = "cancelled"; }],
    ["local CI lease", f => { f.snapshot.lease!.environmentKey = "local-integration-ci"; }],
    ["wrong resource", f => { f.snapshot.lease!.resourceClass = "vitest"; }],
    ["wrong process", f => { f.snapshot.lease!.ownerProcessIdentity = "replacement"; }],
    ["wrong source", f => { f.snapshot.node.controllerSourceSha = "b".repeat(40); }],
    ["changed provider", f => { f.snapshot.currentProviderDigest = "b".repeat(64); }],
    ["unrelated drain", f => { f.snapshot.quiescence!.triggerRefId = "self-upgrade:other"; }],
    ["drain unfinished", f => { f.snapshot.quiescence!.status = "draining"; }],
    ["global drain already cleared", f => { f.snapshot.globalFence = { level: "normal", runId: null }; }],
    ["global drain belongs to another action", f => { f.snapshot.globalFence = { level: "swapping", runId: "QR-other" }; }],
    ["foreign port lease", f => { f.snapshot.lease!.ports = [3000]; }],
  ] as Array<[string, (f: ReturnType<typeof fixture>) => void]>)("refuses %s before issuing authority", (_name, mutate) => {
    const f = fixture(); mutate(f);
    expect(() => issueManagedInferenceAdmission({ ...f, now, nonce: "proof" })).toThrow();
    expect(f.signer.sign.mock.calls.some(([value]) => value.actionType.endsWith(".admission"))).toBe(false);
  });
  it("caps a fresh proof at thirty seconds and the original action expiry", () => {
    const f = fixture(); f.snapshot.lease!.expiresAt = new Date(+now + 120000);
    expect(issueManagedInferenceAdmission({ ...f, now, nonce: "proof" }).expiresAt).toBe(new Date(+now + 30000).toISOString());
  });
  it("uses the actual ready-to-swap caller window while the coordinator retains its draining fence", () => {
    const f = fixture(); f.snapshot.quiescence!.status = "ready-to-swap";
    f.snapshot.globalFence.level = "draining";
    expect(issueManagedInferenceAdmission({ ...f, now, nonce: "proof" }).parameters).toMatchObject({ ready: true });
  });
});
