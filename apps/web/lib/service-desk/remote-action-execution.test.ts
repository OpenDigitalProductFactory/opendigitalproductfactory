import { describe, expect, it, vi } from "vitest";

import { materializeRemoteActionsForProposal, type RemoteActionDb } from "./remote-action-execution";

function db() {
  const create = vi.fn().mockResolvedValue({ actionKey: "ra_x" });
  return { db: { remoteAction: { create } } as unknown as RemoteActionDb, create };
}

const baseInput = {
  proposalId: "prop_1",
  federationLinkId: "link_1",
  edgeNodeId: "node_1",
  approverPrincipalId: "principal_customer",
  requestedByPrincipalId: "principal_msp",
  actions: [
    { actionType: "collect-service-diagnostics", riskClass: "read-only", rationale: "look" },
    { actionType: "restart-service", riskClass: "medium", rationale: "bounce" },
    { actionType: "wipe", riskClass: "destructive", rationale: "no" },
  ],
};

describe("materializeRemoteActionsForProposal", () => {
  it("materializes dispatchable actions, withholds refused, and returns an evidence ref", async () => {
    const { db: d, create } = db();
    const res = await materializeRemoteActionsForProposal(d, baseInput);
    // 2 dispatchable (read-only + medium); destructive refused under conservative.
    expect(res.created).toBe(2);
    expect(res.refusedCount).toBe(1);
    expect(res.evidenceRef).toBe("remoteactions:2:proposal:prop_1");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("records provenance + sovereignty fields and only approves the read-only action", async () => {
    const { db: d, create } = db();
    await materializeRemoteActionsForProposal(d, baseInput);
    const rows = create.mock.calls.map((c) => (c[0] as { data: Record<string, unknown> }).data);

    const diag = rows.find((r) => r.actionType === "diagnostics.collect")!;
    expect(diag.approvalState).toBe("approved");
    expect(diag.approvedByPrincipalId).toBe("principal_customer");
    expect(diag.status).toBe("queued");
    expect(diag.originProposalRef).toBe("prop_1");
    expect(diag.originLinkId).toBe("link_1");
    expect(diag.requestedByPrincipalId).toBe("principal_msp");

    const restart = rows.find((r) => r.actionType === "service.restart")!;
    // mutating action is NOT approved by the proposal click — awaits per-action approval.
    expect(restart.approvalState).toBe("proposed");
    expect(restart.approvedByPrincipalId).toBeNull();
    expect(restart.status).toBe("queued");
  });

  it("a widened band approves the mutating action too", async () => {
    const { db: d, create } = db();
    await materializeRemoteActionsForProposal(d, {
      ...baseInput,
      band: { autoApproveCeiling: "medium", humanApprovalCeiling: "high" },
    });
    const restart = create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((r) => r.actionType === "service.restart")!;
    expect(restart.approvalState).toBe("approved");
  });
});
