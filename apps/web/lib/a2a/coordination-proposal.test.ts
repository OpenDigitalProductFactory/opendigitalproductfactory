import { describe, expect, it } from "vitest";

import {
  classifyConsequence,
  isCoordinationActionKind,
  planLocalApplication,
  requiresHumanGate,
  validateCoordinationProposal,
  type CoordinationAction,
  type CoordinationProposal,
} from "./coordination-proposal";

const LOCAL = "inst_local";
const PEER = "inst_peer";

function action(overrides: Partial<CoordinationAction> = {}): CoordinationAction {
  return {
    kind: "link-to-epic",
    targetInstallationId: LOCAL,
    targetRefs: ["BI-1"],
    rationale: "same theme",
    ...overrides,
  };
}

function proposal(overrides: Partial<CoordinationProposal> = {}): CoordinationProposal {
  return {
    proposalId: "COORD-1",
    proposingGaid: "gaid:priv:dpf.local:planner",
    reasoning: "these overlap",
    actions: [action()],
    ...overrides,
  };
}

describe("classifyConsequence + requiresHumanGate (the coded boundary)", () => {
  it("classifies each kind deterministically", () => {
    expect(classifyConsequence({ kind: "merge-backlog-items" })).toBe("irreversible");
    expect(classifyConsequence({ kind: "retire-backlog-item" })).toBe("consequential");
    expect(classifyConsequence({ kind: "delegate-task" })).toBe("consequential");
    expect(classifyConsequence({ kind: "link-to-epic" })).toBe("reversible");
  });
  it("gates consequential and irreversible actions, not reversible ones", () => {
    expect(requiresHumanGate({ kind: "merge-backlog-items" })).toBe(true);
    expect(requiresHumanGate({ kind: "retire-backlog-item" })).toBe(true);
    expect(requiresHumanGate({ kind: "delegate-task" })).toBe(true);
    expect(requiresHumanGate({ kind: "link-to-epic" })).toBe(false);
  });
});

describe("planLocalApplication — sovereignty filter", () => {
  it("enacts ONLY actions this install owns; foreign actions are counted, never enacted", () => {
    const p = proposal({ actions: [
      action({ kind: "link-to-epic", targetInstallationId: LOCAL, targetRefs: ["BI-1"] }),
      action({ kind: "merge-backlog-items", targetInstallationId: PEER, targetRefs: ["BI-PEER-A", "BI-PEER-B"], primaryRef: "BI-PEER-A" }),
      action({ kind: "retire-backlog-item", targetInstallationId: LOCAL, targetRefs: ["BI-2"] }),
    ] });

    const plan = planLocalApplication(p, LOCAL);

    expect(plan.steps.map((s) => s.action.targetRefs[0])).toEqual(["BI-1", "BI-2"]); // only LOCAL
    expect(plan.foreignActionCount).toBe(1); // the PEER merge — never enacted here
    expect(plan.steps.every((s) => s.action.targetInstallationId === LOCAL)).toBe(true);
  });

  it("flags the plan for human approval when any owned step is consequential", () => {
    const p = proposal({ actions: [
      action({ kind: "link-to-epic", targetInstallationId: LOCAL }),
      action({ kind: "retire-backlog-item", targetInstallationId: LOCAL, targetRefs: ["BI-9"] }),
    ] });
    const plan = planLocalApplication(p, LOCAL);
    expect(plan.needsHumanApproval).toBe(true);
    expect(plan.steps.find((s) => s.action.kind === "retire-backlog-item")?.requiresGate).toBe(true);
    expect(plan.steps.find((s) => s.action.kind === "link-to-epic")?.requiresGate).toBe(false);
  });

  it("needs no approval when every owned step is reversible", () => {
    const plan = planLocalApplication(proposal(), LOCAL);
    expect(plan.needsHumanApproval).toBe(false);
  });

  it("enacts nothing when the install owns none of the actions", () => {
    const p = proposal({ actions: [action({ targetInstallationId: PEER })] });
    const plan = planLocalApplication(p, LOCAL);
    expect(plan.steps).toHaveLength(0);
    expect(plan.foreignActionCount).toBe(1);
    expect(plan.needsHumanApproval).toBe(false);
  });
});

describe("validateCoordinationProposal — the coded contract the AI must satisfy", () => {
  it("accepts a well-formed proposal", () => {
    expect(validateCoordinationProposal(proposal())).toEqual([]);
  });
  it("rejects a non-object", () => {
    expect(validateCoordinationProposal(null)).toEqual(["proposal:not-an-object"]);
  });
  it("flags missing top-level fields", () => {
    const v = validateCoordinationProposal({ actions: [] });
    expect(v).toContain("proposal:missing-id");
    expect(v).toContain("proposal:missing-proposing-gaid");
    expect(v).toContain("proposal:missing-reasoning");
    expect(v).toContain("proposal:no-actions");
  });
  it("flags a malformed action by index", () => {
    const v = validateCoordinationProposal(proposal({ actions: [
      { kind: "not-a-kind", targetInstallationId: "", targetRefs: [], rationale: "" } as unknown as CoordinationAction,
    ] }));
    expect(v).toContain("action:0:invalid-kind");
    expect(v).toContain("action:0:missing-target-installation");
    expect(v).toContain("action:0:missing-target-refs");
    expect(v).toContain("action:0:missing-rationale");
  });
});

describe("isCoordinationActionKind", () => {
  it("guards the closed set", () => {
    expect(isCoordinationActionKind("merge-backlog-items")).toBe(true);
    expect(isCoordinationActionKind("delete-everything")).toBe(false);
    expect(isCoordinationActionKind(3)).toBe(false);
  });
});
