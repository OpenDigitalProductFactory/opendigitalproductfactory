import { describe, expect, it } from "vitest";
import {
  buildEscalationDecisionRequest,
  escalationOptionLabel,
  escalationConsultStatusLabel,
  ESCALATION_DECISION_OPTIONS,
} from "./escalation-responder";

describe("buildEscalationDecisionRequest", () => {
  const base = {
    reportId: "PIR-ESC01",
    title: 'Build Studio needs a human: "X" stuck at plan review',
    description: "Missing input validation on the import endpoint.",
    selfFixClass: "needs-human",
    featureBuildId: "fb-cuid-1",
  };

  it("routes to WWMD (source=claude → external_coding_agent / founder kernel)", () => {
    expect(buildEscalationDecisionRequest(base).source).toBe("claude");
  });

  it("offers the three governed dispositions", () => {
    const req = buildEscalationDecisionRequest(base);
    expect(req.options.map((o) => o.id)).toEqual(["resume", "defer", "escalate-human"]);
  });

  it("carries the build id into trace context and the blocker into the question", () => {
    const req = buildEscalationDecisionRequest(base);
    expect(req.buildId).toBe("fb-cuid-1");
    expect(req.question).toContain("Missing input validation");
    expect(req.question).toContain("self-fix class: needs-human");
  });

  it("falls back to the title when there is no description, and omits buildId when unlinked", () => {
    const req = buildEscalationDecisionRequest({
      ...base,
      description: null,
      selfFixClass: null,
      featureBuildId: null,
    });
    expect(req.buildId).toBeUndefined();
    expect(req.question).toContain(base.title);
    expect(req.question).not.toContain("self-fix class");
  });

  it("truncates a very long blocker", () => {
    const req = buildEscalationDecisionRequest({ ...base, description: "x".repeat(5000) });
    // 1500-char blocker cap keeps the prompt bounded.
    expect(req.question.length).toBeLessThan(1900);
  });
});

describe("escalationOptionLabel", () => {
  it("labels each option id, with a safe fallback", () => {
    expect(escalationOptionLabel("resume")).toBe("Resume the build");
    expect(escalationOptionLabel("escalate-human")).toBe("Escalate to a human");
    expect(escalationOptionLabel(null)).toBe("Review");
    expect(escalationOptionLabel("bogus")).toBe("Review");
  });

  it("every option exposes an operator label", () => {
    for (const o of ESCALATION_DECISION_OPTIONS) {
      expect(escalationOptionLabel(o.id)).toBe(o.operatorLabel);
    }
  });
});

describe("escalationConsultStatusLabel", () => {
  it("maps each decision status to an operator label", () => {
    expect(escalationConsultStatusLabel("recommended")).toBe("Kernel recommends");
    expect(escalationConsultStatusLabel("needs-human")).toBe("Needs human review");
    expect(escalationConsultStatusLabel("blocked")).toBe("Blocked by a commandment");
    expect(escalationConsultStatusLabel("captured-gap")).toBe("No governed decision");
    expect(escalationConsultStatusLabel("whatever")).toBe("Consulted");
  });
});
