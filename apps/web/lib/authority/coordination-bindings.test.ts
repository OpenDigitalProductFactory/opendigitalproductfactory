// Coordination authority is granted, not inferred (BI-E0728215, DI-F8C8042FBB5D).

import { describe, expect, it } from "vitest";

import { coordinationBindingId, planCoordinationBindings } from "./coordination-bindings";
import { COORDINATION_SCOPE_TYPE } from "@/lib/work-management/coordinator-eligibility";

const shape = (key: string, driver: string, approver = "role:owner") => ({
  key,
  stages: [
    { key: "do", accountablePrincipalRef: driver, advance: { kind: "status-change", condition: "c" } },
    {
      key: "decide",
      accountablePrincipalRef: approver,
      advance: { kind: "governed-decision", condition: "c", decisionScope: "wwmd" },
    },
  ],
});

describe("planCoordinationBindings", () => {
  it("grants the shape's driver coordination over that shape", () => {
    const [plan] = planCoordinationBindings({ a: shape("payables-watch", "agent:finance-controller") } as never);
    expect(plan?.resourceRef).toBe("payables-watch");
    expect(plan?.agentId).toBe("finance-controller");
    expect(plan?.scopeType).toBe(COORDINATION_SCOPE_TYPE);
    expect(plan?.status).toBe("active");
  });

  it("never grants coordination to the room's own approver", () => {
    // The ladder excludes governed-decision stages, so seeding cannot introduce
    // coordinator_approver_overlap — the deviation that would replace one refusal
    // with another.
    const plans = planCoordinationBindings({ a: shape("payables-watch", "agent:finance-controller") } as never);
    expect(plans.every((p) => p.agentId !== "owner")).toBe(true);
  });

  it("plans nothing for a shape whose executing stages disagree", () => {
    const ambiguous = {
      key: "split",
      stages: [
        { key: "a", accountablePrincipalRef: "agent:one", advance: { kind: "status-change", condition: "c" } },
        { key: "b", accountablePrincipalRef: "agent:two", advance: { kind: "status-change", condition: "c" } },
      ],
    };
    expect(planCoordinationBindings({ a: ambiguous } as never)).toEqual([]);
  });

  it("plans nothing for a human or role driver — they need no AI authority binding", () => {
    expect(planCoordinationBindings({ a: shape("x", "role:security-owner") } as never)).toEqual([]);
    expect(planCoordinationBindings({ a: shape("y", "person:HR-1") } as never)).toEqual([]);
  });

  it("uses a stable, derivable binding id so re-seeding updates rather than duplicates", () => {
    const [plan] = planCoordinationBindings({ a: shape("payables-watch", "agent:finance-controller") } as never);
    expect(plan?.bindingId).toBe(coordinationBindingId("payables-watch", "finance-controller"));
    expect(plan?.bindingId).toBe("AB-WORKROOM-PAYABLES-WATCH-FINANCE-CONTROLLER");
  });

  it("covers every standing shape on the real registry", () => {
    // The observable: a fresh install seeds coordination for the rooms it ships.
    const plans = planCoordinationBindings();
    expect(plans.length).toBeGreaterThanOrEqual(12);
    expect(new Set(plans.map((p) => p.resourceRef)).size).toBe(plans.length);
  });
});
