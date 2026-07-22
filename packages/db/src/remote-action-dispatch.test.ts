import { describe, expect, it } from "vitest";

import {
  canTransitionDispatch,
  claimableActionsForNode,
  isClaimableByNode,
  isReadonlyDispatchActionType,
  nodeScopeMatchesAction,
  type ClaimingNodeView,
  type DispatchableActionView,
} from "./remote-action-dispatch";

function action(over: Partial<DispatchableActionView> = {}): DispatchableActionView {
  return {
    actionKey: "ra_1",
    actionType: "diagnostics.collect",
    riskClass: "read-only",
    approvalState: "approved",
    status: "queued",
    customerAccountId: null,
    customerSiteId: null,
    edgeNodeId: null,
    ...over,
  };
}

function node(over: Partial<ClaimingNodeView> = {}): ClaimingNodeView {
  return {
    edgeNodeId: "node_1",
    nodeId: "edge_external_1",
    trustState: "trusted",
    customerAccountId: null,
    customerSiteId: null,
    actionExecuteEnabled: true,
    allowedActionTypes: ["diagnostics.collect", "inventory.collect"],
    ...over,
  };
}

describe("isReadonlyDispatchActionType", () => {
  it("admits only the read-only verbs", () => {
    expect(isReadonlyDispatchActionType("diagnostics.collect")).toBe(true);
    expect(isReadonlyDispatchActionType("inventory.collect")).toBe(true);
    expect(isReadonlyDispatchActionType("service.restart")).toBe(false);
    expect(isReadonlyDispatchActionType("patch.apply")).toBe(false);
  });
});

describe("isClaimableByNode — scenario 1: INTERNAL (own estate)", () => {
  it("an internal node claims an internal-scoped read-only action", () => {
    expect(isClaimableByNode(action(), node())).toEqual({ claimable: true });
  });
});

describe("isClaimableByNode — scenario 2: IT-MSP CUSTOMER (scoped)", () => {
  const custNode = node({ customerAccountId: "cust1", customerSiteId: "siteA" });

  it("a customer-scoped node claims its own customer's action", () => {
    const a = action({ customerAccountId: "cust1", customerSiteId: "siteA" });
    expect(isClaimableByNode(a, custNode)).toEqual({ claimable: true });
  });

  it("REJECTS another customer's action (tenant isolation)", () => {
    const a = action({ customerAccountId: "cust2", customerSiteId: "siteA" });
    expect(isClaimableByNode(a, custNode)).toEqual({ claimable: false, reason: "out-of-estate-scope" });
  });

  it("REJECTS a different site within the same customer", () => {
    const a = action({ customerAccountId: "cust1", customerSiteId: "siteB" });
    expect(isClaimableByNode(a, custNode).claimable).toBe(false);
  });

  it("a customer node does NOT claim an internal (null-scope) action", () => {
    expect(isClaimableByNode(action({ customerAccountId: null }), custNode).claimable).toBe(false);
  });

  it("an internal node does NOT claim a customer-scoped action", () => {
    expect(isClaimableByNode(action({ customerAccountId: "cust1" }), node()).claimable).toBe(false);
  });
});

describe("isClaimableByNode — scenario 2b: Topology-B federation origin", () => {
  it("an approved federated action is claimed by the customer's OWN in-scope node (originLinkId governs approval, not execution)", () => {
    // The action came across a link but the customer already approved it (P1);
    // its execution runs on the customer's own node like any in-scope action.
    const a = action({ customerAccountId: "cust1" });
    const custNode = node({ customerAccountId: "cust1" });
    expect(isClaimableByNode(a, custNode)).toEqual({ claimable: true });
  });
});

describe("isClaimableByNode — the gates", () => {
  it("a mutating action is gated to P3 even when otherwise eligible", () => {
    expect(isClaimableByNode(action({ riskClass: "medium" }), node())).toEqual({
      claimable: false,
      reason: "mutating-action-gated-to-P3",
    });
  });

  it("a mislabeled-read-only mutating verb is still rejected by the allow-list", () => {
    // riskClass says read-only but the verb is a mutation → defense in depth.
    expect(isClaimableByNode(action({ actionType: "service.restart" }), node()).reason).toMatch(/allowlist/);
  });

  it("an unapproved action cannot be claimed", () => {
    expect(isClaimableByNode(action({ approvalState: "proposed" }), node()).claimable).toBe(false);
  });

  it("a non-queued action cannot be claimed", () => {
    expect(isClaimableByNode(action({ status: "claimed" }), node()).claimable).toBe(false);
  });

  it("a node without the action.execute capability cannot claim", () => {
    expect(isClaimableByNode(action(), node({ actionExecuteEnabled: false }))).toEqual({
      claimable: false,
      reason: "action-execute-capability-disabled",
    });
  });

  it("rejects a globally read-only action that is not in this node's explicit allowlist", () => {
    expect(
      isClaimableByNode(
        action({ actionType: "inventory.collect" }),
        node({ allowedActionTypes: ["diagnostics.collect"] }),
      ),
    ).toEqual({ claimable: false, reason: "actionType-not-allowed-for-node (inventory.collect)" });
  });

  it("an untrusted node cannot claim", () => {
    expect(isClaimableByNode(action(), node({ trustState: "quarantined" })).claimable).toBe(false);
  });

  it("a pre-bound action is claimable only by its bound node", () => {
    expect(nodeScopeMatchesAction(node({ edgeNodeId: "node_2" }), action({ edgeNodeId: "node_1" }))).toBe(false);
    expect(nodeScopeMatchesAction(node({ edgeNodeId: "node_1" }), action({ edgeNodeId: "node_1" }))).toBe(true);
  });
});

describe("claimableActionsForNode", () => {
  it("filters a mixed queue to only the in-scope, approved, read-only actions", () => {
    const custNode = node({ customerAccountId: "cust1" });
    const queue = [
      action({ actionKey: "ok", customerAccountId: "cust1" }),
      action({ actionKey: "other-cust", customerAccountId: "cust2" }),
      action({ actionKey: "mutating", customerAccountId: "cust1", riskClass: "medium" }),
      action({ actionKey: "unapproved", customerAccountId: "cust1", approvalState: "proposed" }),
    ];
    expect(claimableActionsForNode(custNode, queue).map((a) => a.actionKey)).toEqual(["ok"]);
  });
});

describe("canTransitionDispatch", () => {
  it("allows the legal lifecycle and refuses skips / terminal exits", () => {
    expect(canTransitionDispatch("queued", "claimed")).toBe(true);
    expect(canTransitionDispatch("claimed", "running")).toBe(true);
    expect(canTransitionDispatch("running", "succeeded")).toBe(true);
    expect(canTransitionDispatch("queued", "succeeded")).toBe(false); // no skipping
    expect(canTransitionDispatch("succeeded", "running")).toBe(false); // terminal
  });
});
