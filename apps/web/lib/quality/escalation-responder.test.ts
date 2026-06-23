import { describe, expect, it, vi } from "vitest";
import {
  buildEscalationDecisionRequest,
  escalationOptionLabel,
  escalationConsultStatusLabel,
  ESCALATION_DECISION_OPTIONS,
  runEscalationResponderSweep,
  toStoredResponderDecision,
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

describe("toStoredResponderDecision", () => {
  it("projects only the display-only slice of a decision result", () => {
    expect(
      toStoredResponderDecision({
        status: "needs-human",
        operatorActionLabel: "Ask for human decision",
        reasonSummary: "Genuine product call.",
      }),
    ).toEqual({
      status: "needs-human",
      operatorActionLabel: "Ask for human decision",
      reasonSummary: "Genuine product call.",
    });
  });
});

describe("runEscalationResponderSweep", () => {
  const candidate = {
    reportId: "PIR-ESC01",
    title: "Build Studio needs a human",
    description: "Missing input validation.",
    selfFixClass: "needs-human",
    featureBuildId: "fb-1",
  };

  const decisionResult = {
    status: "recommended" as const,
    recommendation: { optionId: "resume", confidence: "high", margin: 0.4 },
    reasonSummary: "Resolvable by injecting the validation requirement.",
    operatorActionLabel: "Resume the build",
    auditSummary: "Governed decision recommended resume.",
  };

  it("consults each held escalation and stores the recommendation", async () => {
    const stored: Array<{ reportId: string; decision: unknown }> = [];
    const consult = vi.fn().mockResolvedValue(decisionResult);

    const result = await runEscalationResponderSweep({
      getCandidates: async () => [candidate],
      consult,
      store: async (reportId, decision) => {
        stored.push({ reportId, decision });
      },
    });

    expect(result).toEqual({ consulted: 1, failed: 0 });
    expect(consult).toHaveBeenCalledOnce();
    expect(stored).toEqual([
      {
        reportId: "PIR-ESC01",
        decision: {
          status: "recommended",
          operatorActionLabel: "Resume the build",
          reasonSummary: "Resolvable by injecting the validation requirement.",
        },
      },
    ]);
  });

  it("is best-effort: a failed consult is counted, not stored; others still run", async () => {
    const stored: string[] = [];
    const consult = vi
      .fn()
      .mockRejectedValueOnce(new Error("kernel down"))
      .mockResolvedValueOnce(decisionResult);

    const result = await runEscalationResponderSweep({
      getCandidates: async () => [candidate, { ...candidate, reportId: "PIR-ESC02" }],
      consult,
      store: async (reportId) => {
        stored.push(reportId);
      },
    });

    expect(result).toEqual({ consulted: 1, failed: 1 });
    expect(stored).toEqual(["PIR-ESC02"]);
  });

  it("does nothing when there are no held escalations", async () => {
    const consult = vi.fn();
    const result = await runEscalationResponderSweep({
      getCandidates: async () => [],
      consult,
      store: async () => {},
    });
    expect(result).toEqual({ consulted: 0, failed: 0 });
    expect(consult).not.toHaveBeenCalled();
  });
});
