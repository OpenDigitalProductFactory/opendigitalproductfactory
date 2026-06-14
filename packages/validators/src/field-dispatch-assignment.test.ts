import { describe, expect, it } from "vitest";

import {
  type AssignmentCandidate,
  type AssignmentJob,
  rankAssignments,
  recommendAssignment,
  scoreAssignment,
} from "./field-dispatch-assignment";

const tech = (id: string, over: Partial<AssignmentCandidate> = {}): AssignmentCandidate => ({
  resourceId: id,
  skills: ["hvac"],
  available: true,
  proximityScore: 0.5,
  loadFactor: 0,
  valueFit: 0.5,
  ...over,
});

describe("scoreAssignment — eligibility is a hard gate", () => {
  it("is ineligible when unavailable", () => {
    const s = scoreAssignment({}, tech("T1", { available: false }));
    expect(s.eligible).toBe(false);
    expect(s.score).toBe(0);
    expect(s.reasons).toContain("unavailable");
  });

  it("is ineligible when missing a required skill", () => {
    const s = scoreAssignment({ requiredSkills: ["hvac", "epa-608"] }, tech("T1", { skills: ["hvac"] }));
    expect(s.eligible).toBe(false);
    expect(s.reasons[0]).toMatch(/missing required skill/);
  });

  it("is eligible when available and fully qualified", () => {
    const s = scoreAssignment({ requiredSkills: ["hvac"] }, tech("T1"));
    expect(s.eligible).toBe(true);
    expect(s.score).toBeGreaterThan(0);
  });
});

describe("rankAssignments — proximity, load, value, urgency", () => {
  it("ranks the closer technician higher (routine)", () => {
    const job: AssignmentJob = { requiredSkills: ["hvac"], urgency: "routine" };
    const ranked = rankAssignments(job, [tech("FAR", { proximityScore: 0.2 }), tech("NEAR", { proximityScore: 0.9 })]);
    expect(ranked[0].resourceId).toBe("NEAR");
  });

  it("puts the best value-fit on a high-value job when proximity is equal (the catch-up)", () => {
    const job: AssignmentJob = { requiredSkills: ["hvac"], urgency: "routine", valueWeight: 1 };
    const ranked = rankAssignments(job, [tech("JUNIOR", { valueFit: 0.2 }), tech("SENIOR", { valueFit: 0.95 })]);
    expect(ranked[0].resourceId).toBe("SENIOR");
  });

  it("an emergency prioritizes proximity over value-fit", () => {
    const job: AssignmentJob = { requiredSkills: ["hvac"], urgency: "emergency", valueWeight: 1 };
    const ranked = rankAssignments(job, [
      tech("FAR_SENIOR", { proximityScore: 0.1, valueFit: 0.95 }),
      tech("CLOSE", { proximityScore: 0.95, valueFit: 0.2 }),
    ]);
    expect(ranked[0].resourceId).toBe("CLOSE");
  });

  it("orders ineligible candidates last", () => {
    const job: AssignmentJob = { requiredSkills: ["hvac"] };
    const ranked = rankAssignments(job, [tech("BUSY", { available: false }), tech("OK")]);
    expect(ranked[0].resourceId).toBe("OK");
    expect(ranked[ranked.length - 1].eligible).toBe(false);
  });
});

describe("recommendAssignment", () => {
  it("recommends the top eligible, confidence 1 when only one is eligible", () => {
    const rec = recommendAssignment({ requiredSkills: ["hvac"] }, [tech("OK"), tech("BUSY", { available: false })]);
    expect(rec.recommended?.resourceId).toBe("OK");
    expect(rec.confidence).toBe(1);
  });

  it("returns null + zero confidence when no one is eligible", () => {
    const rec = recommendAssignment({ requiredSkills: ["welding"] }, [tech("T1"), tech("T2")]);
    expect(rec.recommended).toBeNull();
    expect(rec.confidence).toBe(0);
  });

  it("confidence is the positive margin between the top two eligible", () => {
    const rec = recommendAssignment({ requiredSkills: ["hvac"], urgency: "routine" }, [
      tech("A", { proximityScore: 0.9 }),
      tech("B", { proximityScore: 0.85 }),
    ]);
    expect(rec.confidence).toBeGreaterThan(0);
    expect(rec.confidence).toBeLessThan(1);
  });
});
