import { describe, expect, it } from "vitest";

import {
  deriveWorkforceConcerns,
  severityForUnassignedSla,
  type WorkforceActivityInput,
} from "./workforce-activity";

function input(overrides?: Partial<WorkforceActivityInput>): WorkforceActivityInput {
  return {
    roles: [],
    pendingApprovals: [],
    pendingHandoffs: [],
    ...overrides,
  };
}

describe("severityForUnassignedSla (BI-D80A1C3E)", () => {
  it("escalates tighter SLAs", () => {
    expect(severityForUnassignedSla(4)).toBe("high");
    expect(severityForUnassignedSla(1)).toBe("high");
    expect(severityForUnassignedSla(5)).toBe("medium");
    expect(severityForUnassignedSla(24)).toBe("medium");
    expect(severityForUnassignedSla(25)).toBe("low");
    expect(severityForUnassignedSla(72)).toBe("low");
  });
});

describe("deriveWorkforceConcerns (BI-D80A1C3E)", () => {
  it("flags an unassigned role that carries an SLA", () => {
    const concerns = deriveWorkforceConcerns(
      input({
        roles: [
          { roleId: "HR-200", name: "Operations Manager", slaHours: 4, assignedCount: 0 },
        ],
      }),
    );
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatchObject({
      kind: "unassigned-role-sla",
      id: "role:HR-200",
      severity: "high",
      slaHours: 4,
    });
    expect(concerns[0].title).toContain("Operations Manager");
  });

  it("does NOT flag an assigned role, even with an SLA", () => {
    const concerns = deriveWorkforceConcerns(
      input({
        roles: [{ roleId: "HR-000", name: "Founder", slaHours: 4, assignedCount: 1 }],
      }),
    );
    expect(concerns).toHaveLength(0);
  });

  it("does NOT flag an unassigned role with no SLA", () => {
    const concerns = deriveWorkforceConcerns(
      input({
        roles: [
          { roleId: "HR-500", name: "Advisor", slaHours: 0, assignedCount: 0 },
          { roleId: "HR-501", name: "Observer", slaHours: null, assignedCount: 0 },
        ],
      }),
    );
    expect(concerns).toHaveLength(0);
  });

  it("flags builds awaiting a human approval gate", () => {
    const concerns = deriveWorkforceConcerns(
      input({
        pendingApprovals: [
          { buildId: "BLD-1", title: "Checkout redesign", phase: "review", ownerLabel: "build-specialist" },
        ],
      }),
    );
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatchObject({
      kind: "pending-approval",
      id: "approval:BLD-1",
      severity: "medium",
      slaHours: null,
    });
  });

  it("flags handoffs that carried open issues, and ignores clean handoffs", () => {
    const concerns = deriveWorkforceConcerns(
      input({
        pendingHandoffs: [
          { buildId: "BLD-2", title: "Invoicing", fromPhase: "build", toPhase: "review", openIssueCount: 2 },
          { buildId: "BLD-3", title: "Clean", fromPhase: "plan", toPhase: "build", openIssueCount: 0 },
        ],
      }),
    );
    expect(concerns).toHaveLength(1);
    expect(concerns[0]).toMatchObject({ kind: "pending-handoff", id: "handoff:BLD-2" });
    expect(concerns[0].detail).toContain("2 open issues");
  });

  it("singularizes a single open issue", () => {
    const concerns = deriveWorkforceConcerns(
      input({
        pendingHandoffs: [
          { buildId: "BLD-4", title: "One", fromPhase: "build", toPhase: "review", openIssueCount: 1 },
        ],
      }),
    );
    expect(concerns[0].detail).toContain("1 open issue ");
    expect(concerns[0].detail).not.toContain("1 open issues");
  });

  it("orders by severity, then tighter SLA, then kind, then id", () => {
    const concerns = deriveWorkforceConcerns(
      input({
        roles: [
          { roleId: "HR-A", name: "Low SLA role", slaHours: 72, assignedCount: 0 }, // low
          { roleId: "HR-B", name: "Ops Manager", slaHours: 4, assignedCount: 0 }, // high
          { roleId: "HR-C", name: "Support Lead", slaHours: 8, assignedCount: 0 }, // medium
          { roleId: "HR-D", name: "Tighter medium", slaHours: 6, assignedCount: 0 }, // medium
        ],
        pendingApprovals: [
          { buildId: "BLD-9", title: "Ship it", phase: "ship", ownerLabel: "coo" }, // medium
        ],
      }),
    );

    // high first
    expect(concerns[0].id).toBe("role:HR-B");
    // then mediums ordered by tighter SLA (6 < 8), then null-SLA approval last among mediums
    const mediumIds = concerns.filter((c) => c.severity === "medium").map((c) => c.id);
    expect(mediumIds).toEqual(["role:HR-D", "role:HR-C", "approval:BLD-9"]);
    // low last
    expect(concerns[concerns.length - 1].id).toBe("role:HR-A");
  });

  it("returns an empty list when nothing needs the operator", () => {
    expect(deriveWorkforceConcerns(input())).toEqual([]);
  });
});
