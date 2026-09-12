import { describe, expect, it } from "vitest";

import {
  describeEscalationRule,
  isDamagingAction,
  resolveEscalation,
  type EscalationInput,
  type EscalationSteering,
} from "./escalation-gate";

function input(overrides: {
  sideEffect?: boolean;
  executionMode?: "proposal" | "immediate";
  consequence?: EscalationInput["action"]["consequence"];
  workCaseConsequential?: boolean;
  sensitivity?: EscalationInput["dataPolicy"]["sensitivity"];
  operatorRequiresApproval?: boolean;
  steering?: EscalationSteering;
} = {}): EscalationInput {
  return {
    action: {
      sideEffect: overrides.sideEffect ?? true,
      executionMode: overrides.executionMode ?? "immediate",
      consequence: overrides.consequence ?? null,
      ...(overrides.workCaseConsequential !== undefined
        ? { workCaseConsequential: overrides.workCaseConsequential }
        : {}),
    },
    dataPolicy: { sensitivity: overrides.sensitivity ?? "internal" },
    // The default is the coworker the gate exists for: one whose operator
    // configuration DOES require approval for ordinary side effects.
    operatorRequiresApproval: overrides.operatorRequiresApproval ?? true,
    steering: overrides.steering ?? "none",
  };
}

const STEERINGS: Exclude<EscalationSteering, "none">[] = [
  "independent-reviewer",
  "room-authority",
  "wwmd",
];

describe("resolveEscalation — the operator's standing configuration is untouched", () => {
  it("lets a graduated coworker act alone, damaging or not, steered or not", () => {
    for (const consequence of [null, "outward"] as const) {
      for (const steering of [...STEERINGS, "none" as const]) {
        const decision = resolveEscalation(
          input({ operatorRequiresApproval: false, consequence, steering }),
        );
        expect(decision.verdict).toBe("automated");
        expect(decision.reasonCode).toBe("operator-graduated-coworker");
      }
    }
  });
});

describe("resolveEscalation — damaging reaches a human", () => {
  it.each(["outward", "irreversible", "authority"] as const)(
    "escalates a declared %s consequence even when steering is available",
    (consequence) => {
      for (const steering of STEERINGS) {
        const decision = resolveEscalation(input({ consequence, steering }));
        expect(decision.verdict).toBe("human");
        expect(decision.reasonCode).toBe("damaging-consequence");
        expect(decision.damaging).toBe(true);
      }
    },
  );

  it("escalates restricted data even with no declared consequence", () => {
    const decision = resolveEscalation(
      input({ sensitivity: "restricted", steering: "independent-reviewer" }),
    );
    expect(decision.verdict).toBe("human");
    expect(decision.reasonCode).toBe("damaging-sensitivity");
  });

  it("escalates an ordinary mutation a Work Case declared consequential", () => {
    const decision = resolveEscalation(
      input({ workCaseConsequential: true, steering: "room-authority" }),
    );
    expect(decision.verdict).toBe("human");
    expect(decision.reasonCode).toBe("damaging-work-case");
  });

  it("never lets a coworker's steering decide damage — the safety property", () => {
    for (const steering of [...STEERINGS, "none" as const]) {
      expect(resolveEscalation(input({ consequence: "outward", steering })).verdict).toBe("human");
    }
  });

  it("adds no escalation the retired tier-only rule did not already make", () => {
    // The retired rule escalated every side effect for a coworker whose policy
    // required approval. So every `human` here must be one of those.
    for (const consequence of [null, "outward", "irreversible", "authority"] as const) {
      for (const steering of [...STEERINGS, "none" as const]) {
        const decision = resolveEscalation(input({ consequence, steering }));
        if (decision.verdict === "human") expect(input({ consequence }).action.sideEffect).toBe(true);
      }
    }
  });
});

describe("resolveEscalation — non-damaging", () => {
  it.each(STEERINGS)("decides automatically when %s steers it", (steering) => {
    const decision = resolveEscalation(input({ steering }));
    expect(decision.verdict).toBe("automated");
    expect(decision.damaging).toBe(false);
    expect(decision.reasonCode).toBe(`steered-by-${steering}`);
  });

  it("reaches a human when nothing can steer a side effect", () => {
    const decision = resolveEscalation(input({ steering: "none" }));
    expect(decision.verdict).toBe("human");
    expect(decision.reasonCode).toBe("unsteered-side-effect");
  });

  it("never escalates a read, steered or not", () => {
    for (const steering of [...STEERINGS, "none" as const]) {
      const decision = resolveEscalation(input({ sideEffect: false, steering }));
      expect(decision.verdict).toBe("automated");
      expect(decision.reasonCode).toBe("routine-read");
    }
  });

  it("keeps a declared proposal tool a proposal", () => {
    const decision = resolveEscalation(
      input({ executionMode: "proposal", steering: "independent-reviewer" }),
    );
    expect(decision.verdict).toBe("human");
    expect(decision.reasonCode).toBe("declared-proposal");
  });
});

describe("resolveEscalation — the defect it exists to close (BI-6B3DA9DD)", () => {
  // record_initiative_evidence: sideEffect, immediate, NO declared consequence,
  // internal sensitivity. AGT-WS-PORTFOLIO ships at hitlTierDefault 1, which
  // made deriveCoworkerApprovalPolicy return "all" and minted a human envelope
  // for a platform receipt that decides nothing damaging.
  const researchReceipt = input({
    sideEffect: true,
    executionMode: "immediate",
    consequence: null,
    sensitivity: "internal",
  });

  it("does not escalate a governance receipt written by an independent reviewer", () => {
    const decision = resolveEscalation({ ...researchReceipt, steering: "independent-reviewer" });
    expect(decision.verdict).toBe("automated");
    expect(decision.damaging).toBe(false);
  });

  it("still escalates the same receipt when no independent reviewer is steering it", () => {
    const decision = resolveEscalation({ ...researchReceipt, steering: "none" });
    expect(decision.verdict).toBe("human");
    expect(decision.reasonCode).toBe("unsteered-side-effect");
  });

  it("does not consult a trust tier at all — the input has no such field", () => {
    expect(Object.keys(researchReceipt.action)).not.toContain("approvalPolicy");
    expect(JSON.stringify(researchReceipt)).not.toMatch(/hitl/i);
  });
});

describe("isDamagingAction", () => {
  it("is true on any single ground and false on none", () => {
    expect(isDamagingAction(input({ consequence: "outward" }))).toBe(true);
    expect(isDamagingAction(input({ sensitivity: "restricted" }))).toBe(true);
    expect(isDamagingAction(input({ workCaseConsequential: true }))).toBe(true);
    expect(isDamagingAction(input({ sensitivity: "confidential" }))).toBe(false);
  });
});

describe("describeEscalationRule", () => {
  it("states the two-condition rule the gate runs on", () => {
    const text = describeEscalationRule().join(" ");
    expect(text).toContain("damaging");
    expect(text).toContain("nothing recorded can steer it");
    expect(text).toContain("does not decide damage");
    expect(text).toContain("never widens that");
    expect(text).toContain("trust tier");
  });
});
