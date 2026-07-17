import { describe, expect, it } from "vitest";
import {
  authorizeStaffingAction,
  requiresHumanApproval,
  type StaffingDelegation,
} from "./authority";
import { prepareStaffingProposal, STAFFING_PUBLISH_ACTION } from "./prepare-proposal";
import type { ValidatedOption } from "../solver/validate-after-solve";

// EP-WORKFORCE-OPS / BI-4AD09A35 Phase 4 — coworker authority boundary +
// proposal preparation (spec §11, §2.2, founder decision 2).

const NOW = new Date("2026-08-01T12:00:00Z");

function grant(overrides: Partial<StaffingDelegation> = {}): StaffingDelegation {
  return {
    granteeAgentId: "staffing-coworker",
    status: "active",
    validFrom: new Date("2026-07-01T00:00:00Z"),
    expiresAt: new Date("2026-09-01T00:00:00Z"),
    maxUses: null,
    useCount: 0,
    scope: { actions: ["publish_schedule"], organizationId: "org-1" },
    ...overrides,
  };
}

describe("authority boundary", () => {
  it("lets the coworker prepare/refresh proposals unattended (Phase 1)", () => {
    for (const action of ["prepare_proposal", "refresh_proposal"] as const) {
      const v = authorizeStaffingAction({
        action,
        actor: { kind: "agent", agentId: "staffing-coworker" },
        organizationId: "org-1",
        now: NOW,
      });
      expect(v.allowed).toBe(true);
      expect(requiresHumanApproval(action)).toBe(false);
    }
  });

  it("forbids the coworker from publishing without a delegation", () => {
    const v = authorizeStaffingAction({
      action: "publish_schedule",
      actor: { kind: "agent", agentId: "staffing-coworker" },
      organizationId: "org-1",
      now: NOW,
      delegation: null,
    });
    expect(v.allowed).toBe(false);
  });

  it("lets the coworker publish under a valid, scoped delegation", () => {
    const v = authorizeStaffingAction({
      action: "publish_schedule",
      actor: { kind: "agent", agentId: "staffing-coworker" },
      organizationId: "org-1",
      now: NOW,
      delegation: grant(),
    });
    expect(v.allowed).toBe(true);
  });

  it("rejects an expired, revoked, exhausted, or org-mismatched delegation", () => {
    const base = {
      action: "publish_schedule" as const,
      actor: { kind: "agent" as const, agentId: "staffing-coworker" },
      organizationId: "org-1",
      now: NOW,
    };
    expect(authorizeStaffingAction({ ...base, delegation: grant({ expiresAt: new Date("2026-07-15T00:00:00Z") }) }).allowed).toBe(false);
    expect(authorizeStaffingAction({ ...base, delegation: grant({ status: "revoked" }) }).allowed).toBe(false);
    expect(authorizeStaffingAction({ ...base, delegation: grant({ maxUses: 3, useCount: 3 }) }).allowed).toBe(false);
    expect(authorizeStaffingAction({ ...base, delegation: grant({ scope: { actions: ["publish_schedule"], organizationId: "org-2" } }) }).allowed).toBe(false);
  });

  it("never lets an agent decide leave or approve an exception, even with a grant", () => {
    for (const action of ["decide_leave", "approve_exception"] as const) {
      const v = authorizeStaffingAction({
        action,
        actor: { kind: "agent", agentId: "staffing-coworker" },
        organizationId: "org-1",
        now: NOW,
        delegation: grant({ scope: { actions: [action], organizationId: "org-1" } }),
      });
      expect(v.allowed).toBe(false);
    }
  });

  it("lets a human publish only with the staffing.publish capability (decision 2)", () => {
    const capable = authorizeStaffingAction({
      action: "publish_schedule",
      actor: { kind: "human", userId: "owner-1", capabilities: ["staffing.publish"] },
      organizationId: "org-1",
      now: NOW,
    });
    const notCapable = authorizeStaffingAction({
      action: "publish_schedule",
      actor: { kind: "human", userId: "coord-2", capabilities: [] },
      organizationId: "org-1",
      now: NOW,
    });
    expect(capable.allowed).toBe(true);
    expect(notCapable.allowed).toBe(false);
  });

  it("enforces delegation location scope", () => {
    const v = authorizeStaffingAction({
      action: "publish_schedule",
      actor: { kind: "agent", agentId: "staffing-coworker" },
      organizationId: "org-1",
      locationId: "loc-B",
      now: NOW,
      delegation: grant({ scope: { actions: ["publish_schedule"], organizationId: "org-1", locationIds: ["loc-A"] } }),
    });
    expect(v.allowed).toBe(false);
  });
});

describe("proposal preparation", () => {
  const vopt = (publishable: boolean, score: number, unfilled: number, premium: number): ValidatedOption => ({
    option: {
      assignments: Array.from({ length: score }, (_, i) => ({ shiftId: `s${i}`, employeeProfileId: `e${i}` })),
      score,
      unfilledShiftIds: Array.from({ length: unfilled }, (_, i) => `u${i}`),
      hardViolationCount: publishable ? 0 : 1,
    },
    evaluation: {
      feasible: publishable,
      violations: [],
      premiums: premium ? [{ ruleId: "ot", predicateType: "max_hours_premium", subjectRef: "e0", units: premium, message: "" }] : [],
      requiresPolicyReview: false,
    },
    publishable,
  });

  it("recommends the publishable option with fewest unfilled shifts, never auto-publishes", () => {
    const payload = prepareStaffingProposal({
      organizationId: "org-1",
      proposalRunId: "run-1",
      validatedOptions: [vopt(true, 5, 2, 3), vopt(true, 4, 0, 1), vopt(false, 9, 0, 0)],
    });
    expect(payload.actionType).toBe(STAFFING_PUBLISH_ACTION);
    expect(payload.autoPublish).toBe(false);
    expect(payload.parameters.recommendedOptionIndex).toBe(1); // fewest unfilled
    expect(payload.parameters.noFeasibleSchedule).toBe(false);
    expect(payload.parameters.options[2].publishable).toBe(false);
  });

  it("returns an honest no-feasible-schedule proposal when nothing is publishable", () => {
    const payload = prepareStaffingProposal({
      organizationId: "org-1",
      proposalRunId: "run-1",
      validatedOptions: [vopt(false, 3, 4, 0)],
    });
    expect(payload.parameters.noFeasibleSchedule).toBe(true);
    expect(payload.parameters.recommendedOptionIndex).toBeNull();
    expect(payload.autoPublish).toBe(false);
  });
});
