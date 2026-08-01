import { describe, expect, it } from "vitest";
import {
  describeUnresolvedRouting,
  resolveAccountableApprover,
  type ApproverRow,
} from "./approval-routing";
import type { WorkforceStatus } from "./workforce-types";

function row(id: string, managerEmployeeId: string | null, status: WorkforceStatus = "active"): ApproverRow {
  return { id, managerEmployeeId, status };
}

describe("resolveAccountableApprover", () => {
  it("returns the direct manager when they can act", () => {
    const rows = [row("ic", "mgr"), row("mgr", "ceo"), row("ceo", null)];

    const result = resolveAccountableApprover(rows, "ic");

    expect(result).toMatchObject({ resolved: true, approverEmployeeId: "mgr", onBehalfOf: null });
  });

  // Operator decision: fail loudly, never invent a fallback approver.
  it("fails loudly when the employee has no manager", () => {
    const result = resolveAccountableApprover([row("solo", null)], "solo");

    expect(result).toMatchObject({ resolved: false, reason: "no-manager-set" });
  });

  it("fails loudly when every manager up the chain is unable to act", () => {
    const rows = [row("ic", "mgr"), row("mgr", "ceo", "offboarding"), row("ceo", null, "inactive")];

    const result = resolveAccountableApprover(rows, "ic");

    expect(result).toMatchObject({ resolved: false, reason: "chain-exhausted", stoppedAt: "ceo" });
    if (result.resolved) throw new Error("unreachable");
    expect(result.path.map((h) => h.reason)).toEqual(["offboarding", "inactive"]);
  });

  it("never invents an approver — an exhausted chain resolves to nobody", () => {
    const rows = [row("ic", "mgr"), row("mgr", null, "suspended")];

    const result = resolveAccountableApprover(rows, "ic");

    expect(result.resolved).toBe(false);
    expect(result).not.toHaveProperty("approverEmployeeId");
  });

  describe("statuses that cannot act", () => {
    it.each<WorkforceStatus>(["inactive", "offboarding", "suspended", "leave", "offer", "onboarding"])(
      "skips a manager who is %s",
      (status) => {
        const rows = [row("ic", "mgr"), row("mgr", "ceo", status), row("ceo", null)];

        const result = resolveAccountableApprover(rows, "ic");

        expect(result).toMatchObject({ resolved: true, approverEmployeeId: "ceo" });
      },
    );
  });

  // Operator decision: skip on-leave managers so work moves — but the skip is transient, so
  // the approval stays attributable to them rather than becoming the deputy's decision.
  describe("on-leave attribution", () => {
    it("routes past an on-leave manager and records who it belongs to", () => {
      const rows = [row("ic", "mgr"), row("mgr", "ceo", "leave"), row("ceo", null)];

      const result = resolveAccountableApprover(rows, "ic");

      expect(result).toMatchObject({
        resolved: true,
        approverEmployeeId: "ceo",
        onBehalfOf: "mgr",
      });
    });

    it("attributes to the FIRST absent manager when several are away", () => {
      const rows = [
        row("ic", "m1"),
        row("m1", "m2", "leave"),
        row("m2", "ceo", "leave"),
        row("ceo", null),
      ];

      const result = resolveAccountableApprover(rows, "ic");

      expect(result).toMatchObject({ approverEmployeeId: "ceo", onBehalfOf: "m1" });
    });

    it("does not attribute on behalf of a permanent departure", () => {
      const rows = [row("ic", "mgr"), row("mgr", "ceo", "inactive"), row("ceo", null)];

      const result = resolveAccountableApprover(rows, "ic");

      expect(result).toMatchObject({ approverEmployeeId: "ceo", onBehalfOf: null });
    });
  });

  // A loop must terminate the walk rather than hang — but it does not automatically block
  // approval. In a mutual A<->B loop, B really is A's manager and really can act; refusing
  // would strand the work for a data problem the chart already surfaces as "Reporting loop
  // detected". The loop only decides the outcome when nobody in it can act.
  describe("reporting loops", () => {
    it("terminates on a loop and still resolves when a member can act", () => {
      const rows = [row("a", "b"), row("b", "a")];

      const result = resolveAccountableApprover(rows, "a");

      expect(result).toMatchObject({ resolved: true, approverEmployeeId: "b" });
    });

    it("reports the loop when nobody in it can act", () => {
      const rows = [row("a", "b"), row("b", "a", "inactive")];

      const result = resolveAccountableApprover(rows, "a");

      expect(result).toMatchObject({ resolved: false, reason: "reporting-loop" });
    });

    it("does not let a loop ABOVE a working manager block approval", () => {
      // ic -> mgr (fine) -> ceo -> mgr (loop above the relevant approver)
      const rows = [row("ic", "mgr"), row("mgr", "ceo"), row("ceo", "mgr")];

      const result = resolveAccountableApprover(rows, "ic");

      expect(result).toMatchObject({ resolved: true, approverEmployeeId: "mgr" });
    });
  });

  it("records the full path it walked", () => {
    const rows = [row("ic", "m1"), row("m1", "m2", "leave"), row("m2", null)];

    const result = resolveAccountableApprover(rows, "ic");
    if (!result.resolved) throw new Error("expected resolution");

    expect(result.path).toEqual([
      { employeeProfileId: "m1", skipped: true, reason: "on-leave" },
      { employeeProfileId: "m2", skipped: false },
    ]);
  });

  it("reports a missing employee rather than guessing", () => {
    expect(resolveAccountableApprover([], "ghost")).toMatchObject({
      resolved: false,
      reason: "employee-not-found",
    });
  });

  it("ignores a manager id that is not in the supplied set", () => {
    const result = resolveAccountableApprover([row("ic", "not-here")], "ic");

    expect(result).toMatchObject({ resolved: false, reason: "chain-exhausted" });
  });
});

describe("describeUnresolvedRouting", () => {
  const nameOf = (id: string) => ({ ic: "Kofi Wolfe" })[id] ?? id;

  it("names the person and the fix when no manager is set", () => {
    const routing = resolveAccountableApprover([row("ic", null)], "ic");
    if (routing.resolved) throw new Error("unreachable");

    expect(describeUnresolvedRouting(routing, nameOf, "ic")).toBe(
      "Kofi Wolfe has no manager set, so there is nobody to approve this. Set their manager on the org chart.",
    );
  });

  it("explains an exhausted chain without jargon", () => {
    const routing = resolveAccountableApprover(
      [row("ic", "mgr"), row("mgr", null, "inactive")],
      "ic",
    );
    if (routing.resolved) throw new Error("unreachable");

    expect(describeUnresolvedRouting(routing, nameOf, "ic")).toContain("Nobody above Kofi Wolfe");
  });

  it("points a reporting loop back at the org chart", () => {
    const routing = resolveAccountableApprover(
      [row("ic", "b"), row("b", "ic", "inactive")],
      "ic",
    );
    if (routing.resolved) throw new Error("unreachable");

    expect(describeUnresolvedRouting(routing, nameOf, "ic")).toContain("reporting loop");
  });
});
