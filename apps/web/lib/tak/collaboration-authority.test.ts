import { describe, expect, it } from "vitest";
import { isHandoffPermitted } from "./collaboration-authority";

describe("isHandoffPermitted", () => {
  it("permits a target listed in delegatesTo", () => {
    expect(
      isHandoffPermitted({ delegatesTo: ["AGT-110", "AGT-111"], escalatesTo: null, targetIds: ["AGT-111"] }),
    ).toBe(true);
  });

  it("permits the escalatesTo target", () => {
    expect(
      isHandoffPermitted({ delegatesTo: [], escalatesTo: "AGT-ORCH-000", targetIds: ["AGT-ORCH-000"] }),
    ).toBe(true);
  });

  it("matches on either the agentId or the slug in targetIds", () => {
    expect(
      isHandoffPermitted({ delegatesTo: ["ea-architect"], escalatesTo: null, targetIds: ["AGT-WS-EA", "ea-architect"] }),
    ).toBe(true);
  });

  it("denies a target not in delegatesTo or escalatesTo", () => {
    expect(
      isHandoffPermitted({ delegatesTo: ["AGT-110"], escalatesTo: "AGT-ORCH-000", targetIds: ["AGT-999"] }),
    ).toBe(false);
  });

  it("fails closed when no delegation authority is declared", () => {
    expect(
      isHandoffPermitted({ delegatesTo: [], escalatesTo: null, targetIds: ["AGT-111"] }),
    ).toBe(false);
  });
});

describe("standing coordinator (BI-80ADD3A8)", () => {
  const COORD = ["AGT-ORCH-000", "coo"];

  it("permits escalating to the COO from an agent whose chain points elsewhere — the 64-of-71 case", () => {
    // Registry reality: a management tree where most agents escalate to a
    // mid-chain lead (HR-300, AGT-ORCH-300, ...), not the COO. Coordination
    // must be reachable exactly when the caller's own chain has no answer.
    expect(isHandoffPermitted({
      delegatesTo: [],
      escalatesTo: "HR-300",
      targetIds: ["AGT-ORCH-000", "coo"],
      standingCoordinatorIds: COORD,
    })).toBe(true);
  });

  it("permits the coordinator even for an agent with NO declared authority", () => {
    expect(isHandoffPermitted({
      delegatesTo: [],
      escalatesTo: null,
      targetIds: ["coo"],
      standingCoordinatorIds: COORD,
    })).toBe(true);
  });

  it("widens TARGETS only — a non-coordinator target is still denied", () => {
    expect(isHandoffPermitted({
      delegatesTo: [],
      escalatesTo: null,
      targetIds: ["AGT-902"],
      standingCoordinatorIds: COORD,
    })).toBe(false);
  });

  it("changes nothing when the coordinator set is not supplied — legacy callers keep fail-closed semantics", () => {
    expect(isHandoffPermitted({
      delegatesTo: [],
      escalatesTo: "HR-300",
      targetIds: ["AGT-ORCH-000"],
    })).toBe(false);
  });
});
