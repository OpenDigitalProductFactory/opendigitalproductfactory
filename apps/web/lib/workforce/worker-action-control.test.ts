import { describe, expect, it } from "vitest";

import type { WorkerClassification } from "@dpf/db";

import type { RegulatoryAutonomyPolicyRecord } from "../autonomy/regulatory-ceiling";

import {
  GATED_WORKER_ACTIONS,
  WORKER_ACTIVITY_CLASSES,
  checkWorkerAction,
  describeWorkerActionRefusal,
  type GatedWorkerAction,
  type WorkerActionDecision,
} from "./worker-action-control";

function refusal(
  decision: WorkerActionDecision,
): Extract<WorkerActionDecision, { permitted: false }> {
  if (decision.permitted) throw new Error("expected a refusal");
  return decision;
}

/** A policy row that requires human control for worker direction in one jurisdiction. */
function narrowingPolicy(jurisdiction: string): RegulatoryAutonomyPolicyRecord {
  return {
    policyId: `POL-${jurisdiction}`,
    status: "active",
    jurisdiction,
    jurisdictionBasis: "employing",
    activityClass: "worker-direction",
    maxAutonomyLevel: "propose",
    humanControlRequired: true,
    industry: null,
  };
}

const ALL_CLASSIFICATIONS: WorkerClassification[] = [
  "employee",
  "contractor_direct",
  "contractor_agency",
  "temp_agency_worker",
  "eor_employee",
  "volunteer",
  "intern",
  "board_member",
];

describe("checkWorkerAction — unresolved inputs refuse", () => {
  it("refuses when no classification is recorded, and does not assume employee", () => {
    const decision = refusal(
      checkWorkerAction({ action: "direct-work", classification: null, jurisdiction: "us" }),
    );

    expect(decision.reason).toBe("classification-unresolved");
    expect(decision.classification).toBeNull();
    expect(decision.lawfulAlternative).toMatch(/determination/i);
  });

  it("refuses when no jurisdiction resolves", () => {
    const decision = refusal(
      checkWorkerAction({ action: "direct-work", classification: "employee", jurisdiction: null }),
    );

    expect(decision.reason).toBe("jurisdiction-unresolved");
    expect(decision.jurisdiction).toBeNull();
  });

  it("refuses every gated action for an unresolved worker", () => {
    for (const action of GATED_WORKER_ACTIONS) {
      const decision = checkWorkerAction({ action, classification: null, jurisdiction: null });
      expect(decision.permitted).toBe(false);
    }
  });
});

describe("checkWorkerAction — the universal classification spine", () => {
  it("permits an employee the full directable set", () => {
    for (const action of GATED_WORKER_ACTIONS) {
      const decision = checkWorkerAction({ action, classification: "employee", jurisdiction: "us" });
      expect(decision.permitted).toBe(true);
    }
  });

  it("refuses to direct, schedule, review or train a directly-engaged contractor", () => {
    for (const action of GATED_WORKER_ACTIONS) {
      const decision = refusal(
        checkWorkerAction({ action, classification: "contractor_direct", jurisdiction: "us" }),
      );
      expect(decision.reason).toBe("classification-forbids");
    }
  });

  it("refuses to direct a volunteer — an unpaid worker directed like an employee is a wage claim", () => {
    const decision = refusal(
      checkWorkerAction({ action: "schedule-shift", classification: "volunteer", jurisdiction: "us" }),
    );

    expect(decision.reason).toBe("classification-forbids");
    expect(decision.lawfulAlternative).toMatch(/availability/i);
  });

  it("permits directing an EOR employee, who the client may direct day to day", () => {
    // The EOR carries employer obligations precisely so the client CAN direct
    // the work. Refusing here would be wrong in the other direction.
    expect(
      checkWorkerAction({ action: "direct-work", classification: "eor_employee", jurisdiction: "uk" })
        .permitted,
    ).toBe(true);
  });

  it("refuses review enrolment for classifications outside review cycles", () => {
    for (const classification of ["contractor_direct", "volunteer", "board_member"] as const) {
      const decision = refusal(
        checkWorkerAction({ action: "enrol-in-review-cycle", classification, jurisdiction: "us" }),
      );
      expect(decision.reason).toBe("classification-forbids");
    }
  });

  it("reaches a decision for every classification and action pair — none is unhandled", () => {
    for (const classification of ALL_CLASSIFICATIONS) {
      for (const action of GATED_WORKER_ACTIONS) {
        const decision = checkWorkerAction({ action, classification, jurisdiction: "us" });
        expect(typeof decision.permitted).toBe("boolean");
        expect(WORKER_ACTIVITY_CLASSES).toContain(decision.activityClass);
      }
    }
  });
});

describe("AC-ELA-012 — the same action, permitted in one jurisdiction and refused in another", () => {
  // The only test that proves jurisdiction is actually READ rather than
  // decoratively stored. Same classification, same action, same policy set —
  // only the worker's jurisdiction differs.
  const policies = [narrowingPolicy("uk")];

  it("permits directing an employee in us", () => {
    const decision = checkWorkerAction({
      action: "direct-work",
      classification: "employee",
      jurisdiction: "us",
      policies,
    });

    expect(decision.permitted).toBe(true);
  });

  it("refuses the identical action for an employee in uk", () => {
    const decision = refusal(
      checkWorkerAction({
        action: "direct-work",
        classification: "employee",
        jurisdiction: "uk",
        policies,
      }),
    );

    expect(decision.reason).toBe("jurisdiction-narrows");
    expect(decision.jurisdiction).toBe("uk");
  });

  it("narrows only — a jurisdiction policy can never permit what the classification forbids", () => {
    // A permissive row for the contractor's jurisdiction must not unlock
    // direction. Narrowing removes; it never grants.
    const permissive: RegulatoryAutonomyPolicyRecord = {
      policyId: "POL-permissive",
      status: "active",
      jurisdiction: "us",
      jurisdictionBasis: "employing",
      activityClass: "worker-direction",
      maxAutonomyLevel: "autopilot",
      humanControlRequired: false,
      industry: null,
    };

    const decision = refusal(
      checkWorkerAction({
        action: "direct-work",
        classification: "contractor_direct",
        jurisdiction: "us",
        policies: [permissive],
      }),
    );

    expect(decision.reason).toBe("classification-forbids");
  });

  it("an inactive or expired policy row does not narrow", () => {
    const retired: RegulatoryAutonomyPolicyRecord = {
      ...narrowingPolicy("uk"),
      status: "retired",
    };

    expect(
      checkWorkerAction({
        action: "direct-work",
        classification: "employee",
        jurisdiction: "uk",
        policies: [retired],
      }).permitted,
    ).toBe(true);
  });

  it("no policy content at all does not refuse lawful employee work", () => {
    // While jurisdictional rule content is unauthored, every lookup defaults.
    // A control that refused here would block lawful work everywhere and get
    // switched off, which is how a gate dies.
    for (const jurisdiction of ["global", "us", "eu", "uk"] as const) {
      expect(
        checkWorkerAction({
          action: "direct-work",
          classification: "employee",
          jurisdiction,
          policies: [],
        }).permitted,
      ).toBe(true);
    }
  });
});

describe("AC-ELA-011 — a refusal names all four things and never degrades", () => {
  it("names the classification, the jurisdiction, the rule and the lawful alternative", () => {
    const decision = refusal(
      checkWorkerAction({
        action: "assign-mandatory-training",
        classification: "contractor_direct",
        jurisdiction: "us",
      }),
    );

    expect(decision.classification).toBe("contractor_direct");
    expect(decision.jurisdiction).toBe("us");
    expect(decision.rule.length).toBeGreaterThan(0);
    expect(decision.lawfulAlternative.length).toBeGreaterThan(0);

    const message = describeWorkerActionRefusal(decision, "Dana Okafor");
    expect(message).toContain("Dana Okafor");
    expect(message).toContain("contractor_direct");
    expect(message).toContain("us");
    expect(message).toContain("statement-of-work");
  });

  it("every possible refusal carries a non-empty lawful alternative", () => {
    const cases: Array<{ action: GatedWorkerAction; classification: WorkerClassification | null }> = [
      { action: "direct-work", classification: null },
      ...GATED_WORKER_ACTIONS.flatMap((action) =>
        ALL_CLASSIFICATIONS.map((classification) => ({ action, classification })),
      ),
    ];

    for (const { action, classification } of cases) {
      const decision = checkWorkerAction({ action, classification, jurisdiction: "us" });
      if (decision.permitted) continue;
      expect(decision.lawfulAlternative.trim().length).toBeGreaterThan(0);
      expect(decision.rule.trim().length).toBeGreaterThan(0);
      // A refusal must never read as a shrug.
      expect(decision.lawfulAlternative).not.toMatch(/contact (an )?admin|not allowed|denied/i);
    }
  });

  it("has no advisory mode and no override — a refusal is a stop", () => {
    // The one-graph architecture is only sound because this gate is enforced at
    // the point of action. If an override parameter ever appears, the trade
    // against the two-system market answer is void.
    const decision = checkWorkerAction({
      action: "direct-work",
      classification: "volunteer",
      jurisdiction: "us",
    });

    expect(decision.permitted).toBe(false);
    expect(Object.keys(decision)).not.toContain("warning");
    expect(Object.keys(decision)).not.toContain("override");
  });
});

describe("the action registry itself", () => {
  it("maps every gated action to a declared activity class", () => {
    for (const action of GATED_WORKER_ACTIONS) {
      const decision = checkWorkerAction({ action, classification: "employee", jurisdiction: "us" });
      expect(WORKER_ACTIVITY_CLASSES).toContain(decision.activityClass);
    }
  });

  it("routes provisioning to its own activity class, not to worker-direction", () => {
    const decision = checkWorkerAction({
      action: "provision-access",
      classification: "employee",
      jurisdiction: "us",
    });

    expect(decision.activityClass).toBe("worker-provisioning");
  });
});
