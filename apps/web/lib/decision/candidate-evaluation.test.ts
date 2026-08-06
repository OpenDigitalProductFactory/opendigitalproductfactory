import { describe, it, expect } from "vitest";
import {
  screenCandidateAxes,
  hiringAutonomyPolicy,
  buildMonitoringObservation,
  computeAdverseImpact,
  type MonitoringObservation,
} from "./candidate-evaluation";

describe("candidate-evaluation guardrails", () => {
  it("admits a clean, job-analysis-grounded axis set", () => {
    const screen = screenCandidateAxes({
      axes: [
        { key: "skill_match", description: "matches required competencies", jobAnalysisRef: "JA-1" },
        { key: "relevant_experience", description: "years in the role's core duties", jobAnalysisRef: "JA-1" },
      ],
      requireJobAnalysis: true,
    });
    expect(screen.admissible).toBe(true);
    expect(screen.errors).toEqual([]);
  });

  it("blocks a protected characteristic used as a scoring axis", () => {
    const screen = screenCandidateAxes({
      axes: [{ key: "age", description: "how old the candidate is" }],
    });
    expect(screen.admissible).toBe(false);
    expect(screen.protectedAxes).toContain("age");
  });

  it("blocks jurisdiction-added protected classes", () => {
    const screen = screenCandidateAxes({
      axes: [{ key: "caste", description: "social group" }],
      additionalProtected: ["caste"],
    });
    expect(screen.admissible).toBe(false);
    expect(screen.protectedAxes).toContain("caste");
  });

  it("detects a proxy axis (graduation year → age)", () => {
    const screen = screenCandidateAxes({
      axes: [{ key: "graduation_year", description: "year the candidate graduated" }],
    });
    expect(screen.admissible).toBe(false);
    expect(screen.proxyFlags.some((f) => f.encodes === "age")).toBe(true);
  });

  it("detects a location proxy (distance/zip → race)", () => {
    const screen = screenCandidateAxes({
      axes: [{ key: "commute_distance", description: "distance from the office by zip" }],
    });
    expect(screen.proxyFlags.some((f) => f.encodes === "race")).toBe(true);
  });

  it("flags a job-analysis-derived axis missing its reference", () => {
    const screen = screenCandidateAxes({
      axes: [{ key: "skill_match", description: "competency match" }],
      requireJobAnalysis: true,
    });
    expect(screen.admissible).toBe(false);
    expect(screen.axesMissingJobAnalysis).toContain("skill_match");
  });

  it("hiring autonomy is capped at propose with human control required (recommendation, not verdict)", () => {
    const policy = hiringAutonomyPolicy("US-NY");
    expect(policy.maxAutonomyLevel).toBe("propose");
    expect(policy.humanControlRequired).toBe(true);
    expect(policy.outputKind).toBe("recommendation");
  });
});

describe("adverse-impact (four-fifths) over the monitoring-only rail", () => {
  function obs(protectedClass: MonitoringObservation["protectedClass"], classValue: string, outcome: "advanced" | "rejected"): MonitoringObservation {
    return buildMonitoringObservation({
      evaluationRef: "eval-1",
      jurisdiction: "US-NY",
      protectedClass,
      classValue,
      selectionOutcome: outcome,
    });
  }

  it("flags a four-fifths violation (selection ratio < 0.8)", () => {
    // group X: 8/10 advanced (0.8). group Y: 2/10 advanced (0.2). ratio 0.25 < 0.8.
    const observations: MonitoringObservation[] = [
      ...Array.from({ length: 8 }, () => obs("sex", "X", "advanced")),
      ...Array.from({ length: 2 }, () => obs("sex", "X", "rejected")),
      ...Array.from({ length: 2 }, () => obs("sex", "Y", "advanced")),
      ...Array.from({ length: 8 }, () => obs("sex", "Y", "rejected")),
    ];
    const ratios = computeAdverseImpact(observations);
    const y = ratios.find((r) => r.classValue === "Y");
    expect(y?.adverseImpact).toBe(true);
    expect(y?.ratioToTop).toBeCloseTo(0.25, 5);
  });

  it("does not flag when selection rates are within four-fifths", () => {
    const observations: MonitoringObservation[] = [
      ...Array.from({ length: 9 }, () => obs("sex", "X", "advanced")),
      ...Array.from({ length: 1 }, () => obs("sex", "X", "rejected")),
      ...Array.from({ length: 8 }, () => obs("sex", "Y", "advanced")),
      ...Array.from({ length: 2 }, () => obs("sex", "Y", "rejected")),
    ];
    const ratios = computeAdverseImpact(observations);
    expect(ratios.every((r) => r.adverseImpact === false)).toBe(true);
  });

  it("monitoring observation defaults to no-consent and hiring activity", () => {
    const o = buildMonitoringObservation({
      evaluationRef: "e",
      jurisdiction: "US-NY",
      protectedClass: "race",
      classValue: "A",
    });
    expect(o.activityClass).toBe("hiring");
    expect(o.consentBasis).toBe("none");
    expect(o.selectionOutcome).toBeNull();
  });
});
