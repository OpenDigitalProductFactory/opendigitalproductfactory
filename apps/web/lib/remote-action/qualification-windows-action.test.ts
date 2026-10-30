import { describe, expect, it } from "vitest";

import { createQualificationExperimentAdmission, qualificationBindingDigest } from "@/lib/backlog/initiative-readiness/qualification-research-admission";

import { planQualificationWindowsAction, type QualificationWindowsNode } from "./qualification-windows-action";

const NOW = new Date("2026-10-30T02:00:00.000Z");
process.env.AUTH_SECRET = "qualification-action-test-secret";
const binding = {
  schemaVersion: 1 as const, phase: "verify" as const, itemId: "BI-QUAL", workroomId: "WC-QUAL",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", baseSha: "a".repeat(40), headSha: "b".repeat(40),
  protocol: { path: "docs/protocol.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
  installationId: "did_dev", accountablePrincipalRef: "principal-1", protocolReviewReceiptId: "receipt-protocol",
  shapeKey: "change-consequential", shapeVersion: "1", stageKey: "reproduce", policyVersion: 1 as const,
  executorMode: "native-edge" as const, requiredPlatform: "win32" as const,
  targetProductionPaths: ["scripts/lib/local-ci-gate-state.mjs"], targetProductionBlobIds: ["d".repeat(40)],
  permittedTools: ["read_source_at_version", "read_codebase_manifest", "record_workroom_evidence"],
  allowedPaths: ["scripts/lib/local-ci-gate-state.test.mjs"], issuedAt: "2026-10-30T01:55:00.000Z",
  expiresAt: "2026-10-30T02:25:00.000Z", maxStarts: 1 as const, maxDurationMs: 900_000,
  candidate: { headSha: "b".repeat(40), diffDigest: `sha256:${"e".repeat(64)}`, testBlobIds: ["f".repeat(40)],
    productionBytesUnchanged: true as const, reviewReceiptId: "receipt-review" },
};
const token = createQualificationExperimentAdmission(binding);
const state = { schemaVersion: 1 as const, status: "issued" as const, token,
  bindingDigest: qualificationBindingDigest(binding), startCount: 0 as const, issuedAt: binding.issuedAt };
const node: QualificationWindowsNode = { id: "node-row", nodeId: "edge_windows", platform: "win32", status: "active",
  trustState: "trusted", customerAccountId: null, customerSiteId: null, lastSeenAt: NOW,
  scopePolicy: { actionTypes: ["qualification.windows.verify-v1"] }, capabilityRows: [{ capability: "action.execute",
    mode: "enabled", reportedAt: NOW, evidence: { qualificationWindows: { schemaVersion: 1, procedureId: "windows-handle-replacement-v1" } } }] };

describe("planQualificationWindowsAction", () => {
  it("derives the closed action solely from the signed binding and one fresh trusted node", () => {
    const result = planQualificationWindowsAction({ capsuleId: "WC-QUAL",
      workspaceState: { qualificationExperimentAdmission: state }, nodes: [node], now: NOW });
    expect(result).toMatchObject({ ok: true, plan: { edgeNodeRowId: "node-row", parameters: {
      backlogItemId: "BI-QUAL", productionBlobs: [{ path: "scripts/lib/local-ci-gate-state.mjs", blobSha: "d".repeat(40) }],
      testBlobs: [{ path: "scripts/lib/local-ci-gate-state.test.mjs", blobSha: "f".repeat(40) }], edgeNodeId: "edge_windows" } } });
  });

  it("fails closed when more than one node could execute the same admission", () => {
    expect(planQualificationWindowsAction({ capsuleId: "WC-QUAL", workspaceState: { qualificationExperimentAdmission: state },
      nodes: [node, { ...node, id: "node-2", nodeId: "edge_windows_2" }], now: NOW })).toEqual({ ok: false, reason: "qualification-node-ambiguous" });
  });

  it("refuses stale capability evidence", () => {
    const stale = { ...node, capabilityRows: [{ ...node.capabilityRows[0]!, reportedAt: new Date(NOW.getTime() - 120_001) }] };
    expect(planQualificationWindowsAction({ capsuleId: "WC-QUAL", workspaceState: { qualificationExperimentAdmission: state },
      nodes: [stale], now: NOW })).toEqual({ ok: false, reason: "qualification-node-unavailable" });
  });
});
